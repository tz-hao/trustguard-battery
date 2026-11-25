import { HttpException } from '@nestjs/common';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { InternalClient } from './internal-client.js';
import { projectBattery } from './projection.js';
import { safeErrorCode } from './transactions.js';
import type { Asset, AuthenticatedActor, BusinessIdentity, Organization } from './types.js';

const orgLabels: Record<Organization, string> = {
  CellOrgMSP: '电芯制造企业 (CellOrg)',
  PackOrgMSP: 'PACK 装配企业 (PackOrg)',
  LabOrgMSP: '第三方检测机构 (LabOrg)',
  RecycleOrgMSP: '退役回收企业 (RecycleOrg)',
};

export function isActivePendingRelease(
  release: { state?: unknown; expiresAt?: unknown; risk?: { expiresAt?: unknown } | null },
  now = Date.now(),
): boolean {
  if (release.state !== 'PENDING') return false;
  if (typeof release.expiresAt === 'string' && Date.parse(release.expiresAt) <= now) return false;
  if (typeof release.risk?.expiresAt === 'string' && Date.parse(release.risk.expiresAt) <= now) return false;
  return true;
}

export function isActivePendingTransfer(
  transfer: { state?: unknown; expiresAt?: unknown },
  now = Date.now(),
): boolean {
  if (typeof transfer.state !== 'string' || !['CREATED', 'SENT', 'ACCEPTED'].includes(transfer.state)) return false;
  if (typeof transfer.expiresAt === 'string' && Date.parse(transfer.expiresAt) <= now) return false;
  return true;
}

export class OverviewService {
  constructor(
    private readonly db: Database,
    private readonly fabric: FabricService,
    private readonly internal: InternalClient,
    private readonly identities: BusinessIdentity[],
    private readonly channel: string,
  ) {}

  private riskUrl() {
    return process.env.TRUSTGUARD_RISK_URL ?? 'https://localhost:18000';
  }

  private async makerMap(): Promise<Map<string, { name: string; simulation: boolean; sourceHash: string }>> {
    const { rows } = await this.db.pool.query<{ state_key: string; body: { code: string; name: string; simulation: boolean; sourceHash: string } }>(
      "SELECT state_key, body FROM state_index WHERE state_key LIKE 'maker:%'",
    );
    const map = new Map<string, { name: string; simulation: boolean; sourceHash: string }>();
    for (const row of rows) map.set(row.body.code, row.body);
    return map;
  }

  private safeOrganizations() {
    const grouped = new Map<Organization, { mspId: Organization; label: string; gatewayEndpoint: string; roles: { name: string; role: string }[] }>();
    for (const identity of this.identities) {
      const existing = grouped.get(identity.mspId);
      if (existing) {
        existing.roles.push({ name: identity.name, role: identity.role });
      } else {
        grouped.set(identity.mspId, {
          mspId: identity.mspId,
          label: orgLabels[identity.mspId],
          gatewayEndpoint: identity.gatewayEndpoint,
          roles: [{ name: identity.name, role: identity.role }],
        });
      }
    }
    return [...grouped.values()];
  }

  async dashboard(actor: AuthenticatedActor) {
    const [
      assetRows,
      makers,
      batchRows,
      releaseRows,
      transferRows,
      cursorRows,
      auditCounts,
      batchCountRows,
      rejectedTxRows,
      alertLogRows,
    ] = await Promise.all([
      this.db.pool.query<{ body: Asset; block_number: string }>('SELECT body, block_number FROM asset_index ORDER BY block_number::numeric DESC, id ASC'),
      this.makerMap(),
      this.db.pool.query<{ body: { id: string; makerMSP: string; materialLotIds: string[]; simulation: boolean } }>("SELECT body FROM state_index WHERE state_key LIKE 'batch:%' ORDER BY block_number::numeric DESC"),
      this.db.pool.query<{ body: Record<string, unknown> & { id: string; state: string } }>("SELECT body FROM state_index WHERE state_key LIKE 'release:%' ORDER BY block_number::numeric DESC"),
      this.db.pool.query<{ body: Record<string, unknown> & { id: string; state: string } }>("SELECT body FROM state_index WHERE state_key LIKE 'transfer:%' ORDER BY block_number::numeric DESC"),
      this.db.pool.query<{ next_block: string; updated_at: Date }>('SELECT next_block, updated_at FROM index_cursors WHERE channel=$1', [this.channel]),
      this.db.pool.query<{ total: number; anchored: number; pending: number }>(
        'SELECT count(*)::int AS total, count(anchored_tx_id)::int AS anchored, count(*) FILTER (WHERE anchored_tx_id IS NULL)::int AS pending FROM security_logs',
      ),
      this.db.pool.query<{ total: number }>('SELECT count(*)::int AS total FROM audit_batches'),
      this.db.pool.query<{ request_id: string; action: string; resource_id: string | null; stage: string; error_code: string | null; updated_at: Date }>(
        `SELECT request_id, command->>'action' AS action, command->'data'->>'id' AS resource_id, stage, error_code, updated_at
         FROM transaction_requests WHERE stage IN ('rejected', 'invalid') ORDER BY updated_at DESC LIMIT 15`,
      ),
      this.db.pool.query<{ id: string; request_id: string | null; action: string; outcome: string; evidence_hash: string; anchored_tx_id: string | null; created_at: Date }>(
        `SELECT id::text, request_id, action, outcome, evidence_hash, anchored_tx_id, created_at
         FROM security_logs
         WHERE outcome LIKE '%REJECT%' OR outcome LIKE '%FORBIDDEN%' OR outcome IN ('400', '403', '409', '429')
         ORDER BY id DESC LIMIT 15`,
      ),
    ]);

    const [policy, ledgerHeight, definition] = await Promise.all([
      this.fabric.query<{ version: number; requiredOrgs: string[]; highRiskOrgs: string[]; simulationOnly: boolean }>(actor.identity, 'policy'),
      this.fabric.height(actor.identity),
      this.fabric.definition(actor.identity),
    ]);

    let riskReady = false;
    try {
      const readiness = await this.internal.post<{ ready: boolean }>(this.riskUrl(), '/readiness', {});
      riskReady = Boolean(readiness.ready);
    } catch {
      riskReady = false;
    }

    const assets = assetRows.rows.map(r => r.body);
    const cellsByBatch = new Map<string, Asset[]>();
    for (const asset of assets) {
      if (asset.type === 'CELL' && asset.batchId) {
        const list = cellsByBatch.get(asset.batchId) ?? [];
        list.push(asset);
        cellsByBatch.set(asset.batchId, list);
      }
    }

    const batches = batchRows.rows.map(({ body }) => {
      const cells = cellsByBatch.get(body.id) ?? [];
      return {
        ...body,
        cellCount: cells.length,
        passedCount: cells.filter(c => c.quality === 'QC_PASSED').length,
        rejectedCount: cells.filter(c => c.quality === 'QC_REJECTED').length,
        reviewRequiredCount: cells.filter(c => c.quality === 'REVIEW_REQUIRED').length,
        notTestedCount: cells.filter(c => c.quality === 'NOT_TESTED').length,
      };
    });

    const nowMs = Date.now();
    const pendingReleases = releaseRows.rows.map(r => r.body).filter(r => isActivePendingRelease(r, nowMs));
    const pendingTransfers = transferRows.rows.map(r => r.body).filter(t => isActivePendingTransfer(t, nowMs));
    const nextBlock = BigInt(cursorRows.rows[0]?.next_block ?? '0');

    return {
      summary: {
        totalAssets: assets.length,
        cells: assets.filter(a => a.type === 'CELL').length,
        modules: assets.filter(a => a.type === 'MODULE').length,
        packs: assets.filter(a => a.type === 'PACK').length,
        passedAssets: assets.filter(a => a.quality === 'QC_PASSED').length,
        rejectedAssets: assets.filter(a => a.quality === 'QC_REJECTED').length,
        reviewRequiredAssets: assets.filter(a => a.quality === 'REVIEW_REQUIRED').length,
        notTestedAssets: assets.filter(a => a.quality === 'NOT_TESTED').length,
        pendingReleases: pendingReleases.length,
        pendingTransfers: pendingTransfers.length,
        activePolicyVersion: policy.version,
        ledgerHeight: ledgerHeight.toString(),
        indexedBlock: nextBlock > 0n ? (nextBlock - 1n).toString() : null,
        stale: nextBlock < ledgerHeight,
        indexedUpdatedAt: cursorRows.rows[0]?.updated_at?.toISOString() ?? null,
        chaincode: definition,
        riskReady,
        auditLogsTotal: auditCounts.rows[0]?.total ?? 0,
        auditAnchoredTotal: auditCounts.rows[0]?.anchored ?? 0,
        auditPendingTotal: auditCounts.rows[0]?.pending ?? 0,
        auditBatchesTotal: batchCountRows.rows[0]?.total ?? 0,
        rejectedTxCount: rejectedTxRows.rows.length,
      },
      recentAssets: assets.slice(0, 12).map(asset => ({
        ...projectBattery(asset),
        makerName: makers.get(asset.makerCode)?.name ?? asset.makerCode,
      })),
      batches,
      pendingReleases,
      pendingTransfers,
      recentRejections: rejectedTxRows.rows.map(r => ({
        requestId: r.request_id,
        action: r.action,
        resourceId: r.resource_id,
        stage: r.stage,
        errorCode: r.error_code,
        updatedAt: r.updated_at.toISOString(),
      })),
      recentAlerts: alertLogRows.rows.map(r => ({
        id: r.id,
        requestId: r.request_id,
        action: r.action,
        outcome: r.outcome,
        evidenceHash: r.evidence_hash,
        anchoredTxId: r.anchored_tx_id,
        createdAt: r.created_at.toISOString(),
      })),
      organizations: this.safeOrganizations(),
      simulationData: true,
    };
  }

  async assets(filters: { type?: string; state?: string; quality?: string; q?: string }) {
    const [assetRows, makers] = await Promise.all([
      this.db.pool.query<{ body: Asset; block_number: string }>('SELECT body, block_number FROM asset_index ORDER BY block_number::numeric DESC, id ASC'),
      this.makerMap(),
    ]);
    const needle = filters.q?.trim().toLowerCase() ?? '';
    const items = assetRows.rows
      .map(r => ({
        ...projectBattery(r.body),
        makerName: makers.get(r.body.makerCode)?.name ?? r.body.makerCode,
        blockNumber: r.block_number,
      }))
      .filter(item => {
        if (filters.type && item.type !== filters.type) return false;
        if (filters.state && item.state !== filters.state) return false;
        if (filters.quality && item.quality !== filters.quality) return false;
        if (needle) {
          const hay = `${item.id} ${item.code} ${item.model} ${item.batchId ?? ''} ${item.makerName}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });
    return { assets: items, total: items.length };
  }

  async batches() {
    const [batchRows, assetRows] = await Promise.all([
      this.db.pool.query<{ body: { id: string; makerMSP: string; materialLotIds: string[]; simulation: boolean }; block_number: string; tx_id: string }>(
        "SELECT body, block_number, tx_id FROM state_index WHERE state_key LIKE 'batch:%' ORDER BY block_number::numeric DESC",
      ),
      this.db.pool.query<{ body: Asset }>("SELECT body FROM asset_index WHERE body->>'type' = 'CELL'"),
    ]);
    const byBatch = new Map<string, Asset[]>();
    for (const row of assetRows.rows) {
      if (!row.body.batchId) continue;
      const list = byBatch.get(row.body.batchId) ?? [];
      list.push(row.body);
      byBatch.set(row.body.batchId, list);
    }
    return {
      batches: batchRows.rows.map(row => {
        const cells = byBatch.get(row.body.id) ?? [];
        return {
          ...row.body,
          blockNumber: row.block_number,
          txId: row.tx_id,
          cellCount: cells.length,
          cells: cells.map(c => ({ id: c.id, code: c.code, chemistry: c.chemistry, model: c.model, state: c.state, quality: c.quality, parentId: c.parentId ?? null })),
        };
      }),
    };
  }

  async inspections() {
    const [measurementRows, reportRows, grantRows, riskRows, inspectionRows] = await Promise.all([
      this.db.pool.query<{ source_hash: string; asset_id: string; batch_id: string; body: Record<string, unknown>; created_at: Date }>(
        'SELECT source_hash, asset_id, batch_id, body, created_at FROM measurements ORDER BY created_at DESC LIMIT 120',
      ),
      this.db.pool.query<{ id: string; asset_id: string; owner_msp: string; plaintext_hash: string; version: number; source_hash: string; created_at: Date }>(
        'SELECT id, asset_id, owner_msp, plaintext_hash, version, source_hash, created_at FROM reports ORDER BY created_at DESC LIMIT 60',
      ),
      this.db.pool.query<{ report_id: string; grantee_msp: string; expires_at: Date; revoked_at: Date | null }>(
        'SELECT report_id, grantee_msp, expires_at, revoked_at FROM report_grants',
      ),
      this.db.pool.query<{ id: string; request_id: string; asset_id: string; policy_version: string; body: Record<string, unknown>; created_at: Date }>(
        'SELECT id, request_id, asset_id, policy_version::text, body, created_at FROM risk_results ORDER BY created_at DESC LIMIT 40',
      ),
      this.db.pool.query<{ body: Record<string, unknown>; block_number: string }>(
        "SELECT body, block_number FROM state_index WHERE state_key LIKE 'inspection:%' OR state_key LIKE 'batch-report:%' ORDER BY block_number::numeric DESC LIMIT 80",
      ),
    ]);

    const grantsByReport = new Map<string, { granteeMSP: string; expiresAt: string; revokedAt: string | null }[]>();
    for (const g of grantRows.rows) {
      const list = grantsByReport.get(g.report_id) ?? [];
      list.push({ granteeMSP: g.grantee_msp, expiresAt: g.expires_at.toISOString(), revokedAt: g.revoked_at?.toISOString() ?? null });
      grantsByReport.set(g.report_id, list);
    }

    let riskReady = false;
    let qualityAnalysis: Record<string, unknown>[] = [];
    try {
      const readiness = await this.internal.post<{ ready: boolean }>(this.riskUrl(), '/readiness', {});
      riskReady = Boolean(readiness.ready);
      if (riskReady && measurementRows.rows.length > 0) {
        const analyzed = await this.internal.post<{ results: Record<string, unknown>[] }>(this.riskUrl(), '/quality/analyze', {
          measurements: measurementRows.rows.map(r => r.body),
        });
        qualityAnalysis = analyzed.results;
      }
    } catch {
      riskReady = false;
    }

    return {
      riskReady,
      measurements: measurementRows.rows.map((r, idx) => ({
        ...r.body,
        sourceHash: r.source_hash,
        createdAt: r.created_at.toISOString(),
        analysis: qualityAnalysis[idx] ?? null,
      })),
      reports: reportRows.rows.map(r => ({
        id: r.id,
        assetId: r.asset_id,
        ownerMSP: r.owner_msp,
        plaintextHash: r.plaintext_hash,
        version: r.version,
        sourceHash: r.source_hash,
        createdAt: r.created_at.toISOString(),
        grants: grantsByReport.get(r.id) ?? [],
      })),
      inspections: inspectionRows.rows.map(r => ({ ...r.body, blockNumber: r.block_number })),
      riskResults: riskRows.rows.map(r => ({
        id: r.id,
        requestId: r.request_id,
        assetId: r.asset_id,
        policyVersion: r.policy_version,
        createdAt: r.created_at.toISOString(),
        ...r.body,
      })),
    };
  }

  async transfers() {
    const [transferRows, assetRows] = await Promise.all([
      this.db.pool.query<{ body: Record<string, unknown> & { id: string; packId: string; state: string }; block_number: string; tx_id: string }>(
        "SELECT body, block_number, tx_id FROM state_index WHERE state_key LIKE 'transfer:%' ORDER BY block_number::numeric DESC",
      ),
      this.db.pool.query<{ body: Asset }>("SELECT body FROM asset_index WHERE body->>'type' = 'PACK'"),
    ]);
    const packMap = new Map(assetRows.rows.map(r => [r.body.id, projectBattery(r.body)]));
    return {
      transfers: transferRows.rows.map(r => ({
        ...r.body,
        blockNumber: r.block_number,
        txId: r.tx_id,
        pack: packMap.get(r.body.packId) ?? null,
      })),
      packs: [...packMap.values()],
    };
  }

  async releases(actor: AuthenticatedActor) {
    const [policy, releaseRows, candidateRows, previewRows, riskRows, packRows] = await Promise.all([
      this.fabric.query<Record<string, unknown>>(actor.identity, 'policy'),
      this.db.pool.query<{ body: Record<string, unknown>; block_number: string; tx_id: string; risk_review: unknown }>(
        `SELECT s.body, s.block_number, s.tx_id, r.body->'review' AS risk_review
         FROM state_index s
         LEFT JOIN risk_results r ON r.id = s.body->'risk'->>'id'
           AND r.request_id = s.body->>'id' AND r.asset_id = s.body->>'packId'
           AND r.body->>'evidenceHash' = s.body->'risk'->>'evidenceHash'
         WHERE s.state_key LIKE 'release:%' ORDER BY s.block_number::numeric DESC`,
      ),
      this.db.pool.query<{ body: Record<string, unknown>; block_number: string; tx_id: string }>(
        "SELECT body, block_number, tx_id FROM state_index WHERE state_key LIKE 'policy-candidate:%' ORDER BY block_number::numeric DESC",
      ),
      this.db.pool.query<{ id: string; policy_hash: string; base_version: string; tests_hash: string; passed: boolean; report: Record<string, unknown>; created_at: Date }>(
        'SELECT id, policy_hash, base_version::text, tests_hash, passed, report, created_at FROM policy_previews ORDER BY created_at DESC LIMIT 20',
      ),
      this.db.pool.query<{ id: string; request_id: string; asset_id: string; policy_version: string; body: Record<string, unknown>; created_at: Date }>(
        'SELECT id, request_id, asset_id, policy_version::text, body, created_at FROM risk_results ORDER BY created_at DESC LIMIT 30',
      ),
      this.db.pool.query<{ body: Asset }>("SELECT body FROM asset_index WHERE body->>'type' = 'PACK' ORDER BY block_number::numeric DESC"),
    ]);
    return {
      currentPolicy: policy,
      releases: releaseRows.rows.map(r => ({ ...r.body, blockNumber: r.block_number, txId: r.tx_id, riskReview: r.risk_review })),
      candidates: candidateRows.rows.map(r => ({ ...r.body, blockNumber: r.block_number, txId: r.tx_id })),
      previews: previewRows.rows.map(r => ({
        id: r.id,
        policyHash: r.policy_hash,
        baseVersion: r.base_version,
        testsHash: r.tests_hash,
        passed: r.passed,
        report: r.report,
        createdAt: r.created_at.toISOString(),
      })),
      riskResults: riskRows.rows.map(r => ({
        id: r.id,
        requestId: r.request_id,
        assetId: r.asset_id,
        policyVersion: r.policy_version,
        createdAt: r.created_at.toISOString(),
        ...r.body,
      })),
      packs: packRows.rows.map(r => projectBattery(r.body)),
    };
  }

  async audit(actor: AuthenticatedActor, batch?: string) {
    const [txRows, logRows, batchRows] = await Promise.all([
      this.db.pool.query<{
        request_id: string; stage: string; tx_id: string | null; block_number: string | null;
        error_code: string | null; action: string; resource_id: string | null; created_at: Date; updated_at: Date;
      }>(
        `SELECT request_id, stage, tx_id, block_number::text, error_code,
                command->>'action' AS action, command->'data'->>'id' AS resource_id, created_at, updated_at
         FROM transaction_requests ORDER BY updated_at DESC LIMIT 80`,
      ),
      this.db.pool.query<{
        id: string; actor_hash: string; request_id: string | null; action: string; outcome: string;
        evidence_hash: string; signature_version: number; audit_batch_id: string | null; anchored_tx_id: string | null; created_at: Date;
      }>(
        `SELECT id::text, actor_hash, request_id, action, outcome, evidence_hash, signature_version, audit_batch_id, anchored_tx_id, created_at
         FROM security_logs ORDER BY id DESC LIMIT 100`,
      ),
      this.db.pool.query<{ id: string; first_log_id: string; last_log_id: string; count: number; digest: string; tx_id: string | null; created_at: Date;
        signer_msp: string | null; block_number: string | null; stage: string | null }>(
        `SELECT b.id, b.first_log_id::text, b.last_log_id::text, b.count, b.digest, b.tx_id, b.created_at,
                e.body->>'actorMSP' AS signer_msp, a.block_number::text, t.stage
         FROM audit_batches b
         LEFT JOIN state_index a ON a.state_key='security-audit:' || b.id AND a.tx_id=b.tx_id AND a.body->>'digest'=b.digest
         LEFT JOIN state_index e ON e.state_key='audit:' || a.tx_id AND e.tx_id=a.tx_id AND e.body->>'action'='AnchorAudit'
         LEFT JOIN transaction_requests t ON t.request_id=b.id AND t.tx_id=a.tx_id AND t.block_number=a.block_number
         WHERE ($1::text IS NULL OR b.id=$1) ORDER BY b.created_at DESC LIMIT 30`, [batch ?? null],
      ),
    ]);

    let ledgerAudits: unknown[] = [];
    if (actor.identity.role === 'auditor') {
      ledgerAudits = await this.fabric.query<unknown[]>(actor.identity, 'audit');
    }

    return {
      transactions: txRows.rows.map(r => ({
        requestId: r.request_id,
        stage: r.stage,
        txId: r.tx_id,
        blockNumber: r.block_number,
        errorCode: r.error_code,
        action: r.action,
        resourceId: r.resource_id,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
      securityLogs: logRows.rows.map(r => ({
        id: r.id,
        actorHash: r.actor_hash,
        requestId: r.request_id,
        action: r.action,
        outcome: r.outcome,
        evidenceHash: r.evidence_hash,
        signatureVersion: r.signature_version,
        auditBatchId: r.audit_batch_id,
        anchoredTxId: r.anchored_tx_id,
        createdAt: r.created_at.toISOString(),
      })),
      auditBatches: batchRows.rows.map(r => ({
        id: r.id,
        firstLogId: r.first_log_id,
          signerMSP: r.signer_msp,
          blockNumber: r.block_number,
          stage: r.stage,
        lastLogId: r.last_log_id,
        count: r.count,
        digest: r.digest,
        txId: r.tx_id,
        createdAt: r.created_at.toISOString(),
      })),
      auditorRoleActive: actor.identity.role === 'auditor',
      ledgerAudits,
    };
  }

  async probeUnauthorizedInspectionEndorsement(actor: AuthenticatedActor, requestId: string, data: Record<string, unknown>) {
    if (actor.identity.mspId === 'LabOrgMSP' && actor.identity.role === 'inspector') {
      throw new HttpException({ code: 'PROBE_REQUIRES_UNAUTHORIZED_ACTOR' }, 400);
    }
    const proposal = await this.fabric.proposal(actor.identity, { requestId, action: 'SubmitInspection', data });
    try {
      await proposal.endorse();
      throw new HttpException({ code: 'UNEXPECTED_ENDORSEMENT_SUCCESS' }, 500);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = safeErrorCode(error);
      return {
        requestId,
        actorMSP: actor.identity.mspId,
        actorRole: actor.identity.role,
        actorName: actor.identity.name,
        stage: 'rejected',
        errorCode: code,
        submittedToOrderer: false,
      };
    }
  }
}
