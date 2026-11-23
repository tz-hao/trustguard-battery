import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import { AuditService } from './audit.js';
import { canonicalJson, sha256 } from './config.js';
import { DeepSeekProvider, loadAiConfig, aiError, AI_PROMPT_VERSION, type AiConfig, type Evidence } from './deepseek.js';
import { AiStore, type AnalysisStore, type AiRow } from './ai-store.js';
import type { Asset, AuthenticatedActor } from './types.js';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
export const aiRequestSchema = z.object({
  requestId: id, assetId: id, task: z.enum(['risk_explanation', 'trace_question']),
  question: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.task === 'trace_question' && !data.question) ctx.addIssue({ code: 'custom', path: ['question'], message: 'question required' });
  if (data.task === 'risk_explanation' && data.question !== undefined) ctx.addIssue({ code: 'custom', path: ['question'], message: 'question only allowed for trace_question' });
  if (data.question && /-----BEGIN|\bBearer\s|\bsk-[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|private[_ -]?key)\s*[:=]/i.test(data.question))
    ctx.addIssue({ code: 'custom', path: ['question'], message: 'credentials are not accepted' });
});
const roles = new Set(['manufacturer', 'operator', 'custodian', 'inspector', 'auditor', 'approver', 'release']);
const riskSchema = z.object({ level: z.enum(['LOW','HIGH']), evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.string().max(40), expiresAt: z.string().max(40), modelVersion: z.string().max(100),
  review: z.object({ missingMeasurements: z.number().int().nonnegative(), qualityRules: z.array(z.string().max(100)).max(100), operationRules: z.array(z.string().max(100)).max(100) }).optional(),
});
interface Context {
  evidence: Evidence[]; references: { evidenceId: string; kind: string; resourceId: string; txId?: string }[];
  asset: Asset; snapshotHash: string; policyVersion: number;
}

export class AiService {
  private readonly store: AnalysisStore;
  constructor(private readonly db: Database, private readonly fabric: FabricService, private readonly audit: Pick<AuditService,'record'>,
    private readonly provider: Pick<DeepSeekProvider,'analyze'> = new DeepSeekProvider(),
    private readonly configuration: () => AiConfig = loadAiConfig, store?: AnalysisStore) {
    this.store = store ?? new AiStore(db);
  }
  status() {
    try {
      const c = this.configuration();
      return { provider: 'deepseek', model: c.model, enabled: c.enabled, configured: Boolean(c.apiKey),
        available: c.enabled && Boolean(c.apiKey), connectivityVerified: false,
        reason: !c.enabled ? 'AI_DISABLED' : !c.apiKey ? 'AI_NOT_CONFIGURED' : null,
        tasks: ['risk_explanation','trace_question'], advisoryOnly: true, realDataAllowed: c.allowRealData,
        dailyLimit: Number(process.env.TRUSTGUARD_AI_DAILY_LIMIT) || null };
    } catch { return { provider: 'deepseek', available: false, reason: 'AI_CONFIGURATION_INVALID', connectivityVerified: false, advisoryOnly: true }; }
  }
  private async authorize(actor: AuthenticatedActor, assetId: string) {
    if (!roles.has(actor.identity.role)) throw aiError('FORBIDDEN', 403);
    const asset = await this.fabric.query<Asset>(actor.identity, 'asset', assetId);
    const laboratory = actor.identity.mspId === 'LabOrgMSP' && ['inspector','auditor'].includes(actor.identity.role);
    if (!laboratory && asset.holderMSP !== actor.identity.mspId) throw aiError('FORBIDDEN', 403);
    return asset;
  }
  private async context(actor: AuthenticatedActor, asset: Asset): Promise<Context> {
    const snapshot = asset.type === 'PACK'
      ? await this.fabric.query<{hash: string; assets: Asset[]}>(actor.identity, 'snapshot', asset.id)
      : { hash: sha256(canonicalJson(asset)), assets: [asset] };
    if (snapshot.assets.length > 100) throw aiError('AI_CONTEXT_TOO_LARGE', 413);
    const current = snapshot.assets.find(a => a.id === asset.id);
    if (!current || current.version !== asset.version || current.holderMSP !== asset.holderMSP) throw aiError('AI_EVIDENCE_CHANGED', 409);
    const policy = await this.fabric.query<{version: number}>(actor.identity, 'policy');
    const evidence: Evidence[] = [];
    const references: Context['references'] = [];
    function add(kind: string, resourceId: string, facts: Record<string, unknown>, txId?: string) {
      const evidenceId = `E${evidence.length + 1}`;
      evidence.push({ id: evidenceId, kind, facts });
      references.push({ evidenceId, kind, resourceId, ...(txId ? { txId } : {}) });
      return evidenceId;
    }
    // Only allowlisted facts leave this service. Real IDs, codes, names, raw
    // reports, signatures, transaction hashes and credentials never enter prompts.
    const aliases = new Map(snapshot.assets.map((a, index) => [a.id, `asset-${index+1}`]));
    for (const a of snapshot.assets) {
      add('asset', a.id, { alias: aliases.get(a.id), target: a.id === asset.id, type: a.type, chemistry: a.chemistry,
        state: a.state, quality: a.quality, simulation: a.simulation, version: a.version,
        inspectionVersion: a.inspectionVersion, childAliases: a.children.map(child => aliases.get(child) ?? 'outside-scope'),
        manufacturedAt: a.manufacturedAt, installedAt: a.installedAt, firstUseAt: a.firstUseAt,
        retiredAt: a.retiredAt, scrappedAt: a.scrappedAt }, a.txId);
    }
    if (asset.inspectionVersion > 0) {
      type Inspection = { id: string; assetId: string; version: number; at: string; result: string; txId: string };
      const rows = await this.fabric.query<Inspection[]>(actor.identity, 'inspections', asset.id);
      const current = rows.find(row => row.assetId === asset.id && row.version === asset.inspectionVersion);
      if (current) add('inspection', current.id, { version: current.version, at: current.at, result: current.result }, current.txId);
    }
    const risk = await this.db.pool.query<{id: string; body: unknown; snapshot_hash: string; policy_version: string}>(
      'SELECT id,body,snapshot_hash,policy_version::text FROM risk_results WHERE asset_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [asset.id]);
    if (risk.rows[0]) {
      const row = risk.rows[0], value = riskSchema.safeParse(row.body);
      if (!value.success) throw aiError('AI_EVIDENCE_INVALID', 409);
      add('risk', row.id, { level: value.data.level, modelVersion: value.data.modelVersion,
        issuedAt: value.data.issuedAt, expiresAt: value.data.expiresAt, review: value.data.review ?? null,
        stale: row.snapshot_hash !== snapshot.hash || Number(row.policy_version) !== policy.version || !Number.isFinite(Date.parse(value.data.expiresAt)) || Date.parse(value.data.expiresAt) <= Date.now(),
        source: 'STORED_RISK_RESULT_NOT_NEW_ATTESTATION' });
    } else add('missing', asset.id, { missing: 'No stored risk assessment for this asset. Do not infer low risk.' });
    add('scope', asset.id, { scope: 'Target asset and its current pack components only. No full batch recall or historical genealogy search.',
      policyVersion: policy.version, remainingLifeEstimate: null, plannedScrapAt: null, humanReviewRequired: true });
    return { evidence, references, asset, snapshotHash: snapshot.hash, policyVersion: policy.version };
  }
  private async view(actor: AuthenticatedActor, row: AiRow) {
    const asset = await this.authorize(actor, row.asset_id);
    const interrupted = row.state === 'running' && Date.now() - new Date(row.created_at).valueOf() > 120000;
    const response: Record<string, unknown> = { requestId: row.request_id, assetId: row.asset_id,
      state: interrupted ? 'interrupted' : row.state, completed: row.state === 'completed', advisoryOnly: true,
      errorCode: interrupted ? 'AI_INTERRUPTED_NO_AUTOMATIC_RETRY' : row.error_code };
    if (row.state === 'completed' && row.result) {
      const snapshotHash = asset.type === 'PACK' ? (await this.fabric.query<{hash: string}>(actor.identity,'snapshot',asset.id)).hash : sha256(canonicalJson(asset));
      const policy = await this.fabric.query<{version: number}>(actor.identity,'policy');
      response.result = row.result;
      response.stale = row.result.snapshotHash !== snapshotHash || row.result.policyVersion !== policy.version;
    }
    return response;
  }
  async get(actor: AuthenticatedActor, requestId: string) {
    const row = await this.store.get(actor.actorHash, id.parse(requestId));
    if (!row) throw aiError('NOT_FOUND', 404);
    return this.view(actor, row);
  }
  async latest(actor: AuthenticatedActor, assetId: string) {
    await this.authorize(actor, id.parse(assetId));
    const rows = await this.db.pool.query<{request_id:string}>(
      'SELECT request_id FROM ai_analyses WHERE actor_hash=$1 AND asset_id=$2 ORDER BY created_at DESC,request_id DESC LIMIT 1',
      [actor.actorHash, assetId]);
    return { latest: rows.rows.length ? await this.get(actor, rows.rows[0].request_id) : null };
  }
  async analyze(actor: AuthenticatedActor, raw: unknown) {
    const input = aiRequestSchema.parse(raw);
    const digest = sha256(canonicalJson(input));
    const asset = await this.authorize(actor, input.assetId);
    const prior = await this.store.get(actor.actorHash, input.requestId);
    if (prior) {
      if (prior.payload_hash !== digest) throw aiError('IDEMPOTENCY_CONFLICT', 409);
      return this.view(actor, prior);
    }
    const config = this.configuration();
    if (!config.enabled) throw aiError('AI_DISABLED');
    if (!config.apiKey) throw aiError('AI_NOT_CONFIGURED');
    if (!asset.simulation && !config.allowRealData) throw aiError('AI_REAL_DATA_DISABLED', 403);
    const context = await this.context(actor, asset);
    if (!config.allowRealData && context.evidence.some(e => e.kind === 'asset' && e.facts.simulation !== true)) throw aiError('AI_REAL_DATA_DISABLED', 403);
    // Recheck ownership and exact evidence before releasing any data externally.
    const recheck = await this.authorize(actor, asset.id);
    const recheckedHash = recheck.type === 'PACK' ? (await this.fabric.query<{hash: string}>(actor.identity,'snapshot',asset.id)).hash : sha256(canonicalJson(recheck));
    const recheckedPolicy = await this.fabric.query<{version: number}>(actor.identity,'policy');
    if (recheck.version !== asset.version || recheckedHash !== context.snapshotHash || recheckedPolicy.version !== context.policyVersion)
      throw aiError('AI_EVIDENCE_CHANGED', 409);
    if (!(await this.store.reserve(actor.actorHash, input.requestId, input.assetId, digest))) {
      const existing = await this.store.get(actor.actorHash, input.requestId);
      if (!existing || existing.payload_hash !== digest) throw aiError('IDEMPOTENCY_CONFLICT', 409);
      return this.view(actor, existing);
    }
    try {
      await this.audit.record(actor.actorHash, input.requestId, 'AI_ANALYSIS', 'STARTED');
      const generated = await this.provider.analyze(config, input.task, input.question, context.evidence);
      const latest = await this.authorize(actor, asset.id);
      const snapshotHash = latest.type === 'PACK' ? (await this.fabric.query<{hash: string}>(actor.identity,'snapshot',asset.id)).hash : sha256(canonicalJson(latest));
      const policy = await this.fabric.query<{version: number}>(actor.identity,'policy');
      if (latest.version !== asset.version || snapshotHash !== context.snapshotHash || policy.version !== context.policyVersion) throw aiError('AI_EVIDENCE_CHANGED', 409);
      const result = { ...generated, provider: 'deepseek', promptVersion: AI_PROMPT_VERSION, task: input.task,
        generatedAt: new Date().toISOString(), simulation: asset.simulation, advisoryOnly: true, humanReviewRequired: true,
        references: context.references, evidence: context.evidence, snapshotHash: context.snapshotHash,
        policyVersion: context.policyVersion, evidenceHash: sha256(canonicalJson(context.evidence)),
        citationValidation: 'REFERENCE_IDS_EXIST_ONLY', remainingLifeEstimate: null, plannedScrapAt: null };
      await this.audit.record(actor.actorHash, input.requestId, 'AI_ANALYSIS', 'VALIDATED:' + result.evidenceHash);
      await this.store.complete(actor.actorHash, input.requestId, result);
      return this.get(actor, input.requestId);
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const code = response && typeof response === 'object' && 'code' in response && typeof response.code === 'string' ? response.code : 'AI_DEPENDENCY_UNAVAILABLE';
      await this.store.fail(actor.actorHash, input.requestId, code);
      await this.audit.record(actor.actorHash, input.requestId, 'AI_ANALYSIS', code).catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw aiError('AI_DEPENDENCY_UNAVAILABLE');
    }
  }
}
