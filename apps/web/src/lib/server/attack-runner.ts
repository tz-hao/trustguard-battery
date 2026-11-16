import { createPrivateKey, randomInt, randomUUID, sign } from 'node:crypto';
import {
  callBackendApi,
  canonicalJson,
  getActorPrivateKeyPem,
  getDemoSourceSigningKeyPem,
  getPublicIdentity,
  sha256Hex,
} from './api-client';
import type { BatteryAssetView } from '../types';

export type AttackId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8';

export type InterceptionLayer =
  | 'PEER_ENDORSEMENT_REJECTED'
  | 'CHAINCODE_REJECTED'
  | 'API_INTEGRITY_REJECTED'
  | 'API_POLICY_GATE_REJECTED'
  | 'CHAINCODE_QUERY_REJECTED';

export interface AttackTimelineStep {
  step: string;
  status: 'pass' | 'blocked' | 'skipped';
  detail: string;
}

export interface AttackTelemetry {
  interceptionLayer: InterceptionLayer;
  interceptionLabel: string;
  attackEntry: string;
  reachedFabric: boolean;
  endorsed: boolean;
  submitted: boolean;
  writtenToBlock: boolean;
  timeline: AttackTimelineStep[];
}

export interface AttackExecutionResult {
  id: AttackId;
  title: string;
  targetDescription: string;
  actorUsed: { name: string; mspId: string; role: string; fingerprintPrefix: string };
  requestSummary: { method: string; route: string; payloadPreview: Record<string, unknown> };
  responseSummary: { httpStatus: number; stage: string; errorCode: string; rawBody: unknown };
  blocked: boolean;
  stateUnchanged: boolean;
  beforeDigest: string;
  afterDigest: string;
  checkedAt: string;
  notes: string;
  telemetry: AttackTelemetry;
}

const ATTACK_CATALOG: Record<AttackId, { title: string; targetDescription: string }> = {
  A1: {
    title: 'A1 · 越权冒充检测员签发质检',
    targetDescription: '使用 PACK 组织制造角色证书向 Peer 发起 SubmitInspection 提案，验证链码 MSP/角色硬性拒绝。',
  },
  A2: {
    title: 'A2 · 含不合格电芯的 PACK 强行申请放行',
    targetDescription: '对包含 QC_REJECTED 电芯的电池包调用 POST /release/requests，验证 QUALITY_GATE 阻断。',
  },
  A3: {
    title: 'A3 · 篡改检测报告正文但保留原摘要',
    targetDescription: '修改报告明文内容后使用原 plaintextHash 与签名上传，验证 REPORT_HASH_MISMATCH 完整性拦截。',
  },
  A4: {
    title: 'A4 · 转出方单方伪造接收方确认交接',
    targetDescription: '转出方 pack-custodian 试图自行提交 ConfirmTransfer，验证双签授权与 FORBIDDEN 阻断。',
  },
  A5: {
    title: 'A5 · 已报废电池违规回流普通交接',
    targetDescription: '对已确认报废（PROCESSED）的电池包发起普通转移，验证终态不可回流约束。',
  },
  A6: {
    title: 'A6 · 发布弱化审批门槛的策略',
    targetDescription: '生成仅单方 PackOrgMSP 审批的候选策略，验证隔离推演失败且强制阻断提交。',
  },
  A7: {
    title: 'A7 · 非法 23/25 位及错误材料位编码解析',
    targetDescription: '提交长度不符或第 5 位含非法材料字母 I 的编码，验证 GB/T 34014 字段校验拒绝。',
  },
  A8: {
    title: 'A8 · 非授权企业篡改在用电池报废时间',
    targetDescription: '使用电芯制造方身份对在用 PACK 提交 scrap-confirmations，验证 FORBIDDEN 阻断。',
  },
};

function uid(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function fetchAssetSnapshot(actorName: string, assetId: string): Promise<Record<string, unknown>> {
  const res = await callBackendApi<Record<string, unknown>>(actorName, 'GET', `/assets/${assetId}`);
  if (res.status !== 200) throw new Error(`Failed to read asset ${assetId}: ${res.status}`);
  return res.data;
}

async function cmd(actorName: string, resource: string, data: Record<string, unknown>) {
  const requestId = uid('lab');
  const res = await callBackendApi<{ completed?: boolean; stage?: string; errorCode?: string; code?: string; txId?: string }>(
    actorName,
    'POST',
    `/commands/${resource}`,
    { requestId, data },
  );
  return { requestId, res };
}

function gen24Code(kind: 'CELL' | 'MODULE' | 'PACK', chemistry: 'B' | 'E'): string {
  const prefix = kind === 'CELL' ? 'SMA' : 'DMA';
  const typeCh = kind === 'CELL' ? 'C' : kind === 'MODULE' ? 'M' : 'P';
  const serial = String(randomInt(1000000, 9999999));
  return `${prefix}${typeCh}${chemistry}010000001E11${serial}`;
}

async function ensureDemoAssets(assets: BatteryAssetView[]) {
  const anyCell = assets.find(a => a.type === 'CELL');
  const livePack = assets.find(a => a.type === 'PACK' && a.state === 'IN_USE') ?? assets.find(a => a.type === 'PACK');
  const scrappedPack = assets.find(a => a.type === 'PACK' && a.state === 'PROCESSED' && a.scrapped);
  return { anyCell, livePack, scrappedPack };
}

async function ensureA2RejectedPack(assets: BatteryAssetView[]): Promise<string> {
  // Check if there's already an ASSEMBLED pack containing a QC_REJECTED or NOT_TESTED cell
  const existing = assets.find(a => a.type === 'PACK' && a.state === 'ASSEMBLED' && a.id.startsWith('lab-a2-'));
  if (existing) {
    const snap = await callBackendApi<{ assets: BatteryAssetView[] }>('pack-viewer', 'GET', `/assets/${existing.id}/snapshot`);
    if (snap.status === 200 && snap.data.assets.some(a => a.quality !== 'QC_PASSED')) {
      return existing.id;
    }
  }
  const tag = uid('lab-a2');
  const matId = `${tag}-mat`;
  const batchId = `${tag}-batch`;
  const cellId = `${tag}-cell`;
  const modId = `${tag}-mod`;
  const packId = `${tag}-pack`;

  const lotRes = await cmd('cell-manufacturer', 'material-lots', {
    id: matId,
    ownerMSP: 'CellOrgMSP',
    sourceHash: sha256Hex('lab simulated material lot'),
    simulation: true,
  });
  if (!lotRes.res.data.completed) throw new Error(`A2 setup material-lot failed: ${JSON.stringify(lotRes.res.data)}`);

  const batchRes = await cmd('cell-manufacturer', 'batches', {
    id: batchId,
    makerMSP: 'CellOrgMSP',
    materialLotIds: [matId],
    simulation: true,
  });
  if (!batchRes.res.data.completed) throw new Error(`A2 setup batch failed: ${JSON.stringify(batchRes.res.data)}`);

  const mHash = sha256Hex('lab simulated manufacture');
  const sHash = sha256Hex('lab simulated spec');
  for (const item of [
    { who: 'cell-manufacturer', id: cellId, kind: 'CELL' as const, batchId },
    { who: 'pack-manufacturer', id: modId, kind: 'MODULE' as const, batchId: '' },
    { who: 'pack-manufacturer', id: packId, kind: 'PACK' as const, batchId: '' },
  ]) {
    const r = await cmd(item.who, 'assets', {
      id: item.id,
      code: gen24Code(item.kind, 'E'),
      batchId: item.batchId,
      model: 'sim-3000',
      manufacturedAt: '2024-01-01',
      manufactureSourceHash: mHash,
      designLifeMonths: 96,
      specSourceHash: sHash,
    });
    if (!r.res.data.completed) throw new Error(`A2 setup asset ${item.id} failed: ${JSON.stringify(r.res.data)}`);
  }

  await cmd('cell-manufacturer', 'assembly-authorizations', {
    childId: cellId,
    parentId: modId,
    evidenceHash: sha256Hex('lab supply permission'),
  });
  await cmd('pack-assembler', 'assembly', {
    parentId: modId,
    children: [cellId],
    revision: 1,
    evidenceHash: sha256Hex('lab cell bind'),
  });
  await cmd('pack-assembler', 'assembly', {
    parentId: packId,
    children: [modId],
    revision: 1,
    evidenceHash: sha256Hex('lab module bind'),
  });

  // Upload & submit QC_REJECTED inspection for cell, QC_PASSED for module and pack
  const labKey = createPrivateKey(getActorPrivateKeyPem('lab-inspector'));
  for (const target of [
    { assetId: cellId, result: 'QC_REJECTED' },
    { assetId: modId, result: 'QC_PASSED' },
    { assetId: packId, result: 'QC_PASSED' },
  ]) {
    const reportId = uid('lab-rep');
    const plaintext = Buffer.from(JSON.stringify({ simulation: true, assetId: target.assetId, result: target.result, version: 1 }));
    const plaintextHash = sha256Hex(plaintext);
    const binding = { id: reportId, assetId: target.assetId, version: 1, plaintextHash };
    const sourceSignature = sign('sha256', Buffer.from(canonicalJson(binding)), labKey).toString('base64');
    const up = await callBackendApi<{ sourceHash: string }>('lab-inspector', 'POST', '/reports', {
      requestId: reportId,
      ...binding,
      sourceSignature,
      contentBase64: plaintext.toString('base64'),
    });
    if (up.status !== 201) throw new Error(`A2 setup report failed: ${JSON.stringify(up.data)}`);
    const ins = await cmd('lab-inspector', 'inspections', {
      id: reportId,
      assetId: target.assetId,
      version: 1,
      result: target.result,
      reportHash: plaintextHash,
      sourceHash: up.data.sourceHash,
    });
    if (!ins.res.data.completed) throw new Error(`A2 setup inspection failed: ${JSON.stringify(ins.res.data)}`);
  }

  // Also upload measurement for cell so risk service has data
  const csv = `asset_id,batch_id,chemistry,model,condition,capacity_mah,resistance_uohm,voltage_mv,temperature_c,simulation\n${cellId},${batchId},TERNARY,sim-3000,25C-1C,3000,1500,3700,25,true\n`;
  const contentBuf = Buffer.from(csv, 'utf8');
  const issuedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sourceKey = createPrivateKey(getDemoSourceSigningKeyPem());
  const sigPayload = JSON.stringify({ sourceId: 'lab-source', batchId, payloadHash: sha256Hex(contentBuf), issuedAt });
  const signature = sign(null, Buffer.from(sigPayload), sourceKey).toString('base64');
  await callBackendApi('lab-inspector', 'POST', '/imports/measurements', {
    requestId: uid('lab-csv'),
    sourceId: 'lab-source',
    batchId,
    issuedAt,
    signature,
    contentBase64: contentBuf.toString('base64'),
  });

  return packId;
}

async function ensureA4SentTransfer(): Promise<{ transferId: string; packId: string; receiptHash: string }> {
  const trList = await callBackendApi<{ transfers: { id: string; packId: string; state: string; fromMSP: string; receiptHash: string }[] }>(
    'pack-viewer',
    'GET',
    '/overview/transfers',
  );
  const existing = trList.data.transfers.find(t => t.state === 'SENT' && t.fromMSP === 'PackOrgMSP');
  if (existing) return { transferId: existing.id, packId: existing.packId, receiptHash: existing.receiptHash };

  const assetList = await callBackendApi<{ assets: BatteryAssetView[] }>('pack-viewer', 'GET', '/overview/assets');
  let targetPack = assetList.data.assets.find(
    a => a.type === 'PACK' && a.holderMSP === 'PackOrgMSP' && a.state === 'RETIRED',
  );
  if (!targetPack) {
    // Provision an isolated retired pack for A4
    const tag = uid('lab-a4');
    const matId = `${tag}-mat`;
    const batchId = `${tag}-batch`;
    const cellId = `${tag}-cell`;
    const modId = `${tag}-mod`;
    const packId = `${tag}-pack`;
    await cmd('cell-manufacturer', 'material-lots', { id: matId, ownerMSP: 'CellOrgMSP', sourceHash: sha256Hex('a4 mat'), simulation: true });
    await cmd('cell-manufacturer', 'batches', { id: batchId, makerMSP: 'CellOrgMSP', materialLotIds: [matId], simulation: true });
    const mHash = sha256Hex('a4 mfg');
    const sHash = sha256Hex('a4 spec');
    await cmd('cell-manufacturer', 'assets', { id: cellId, code: gen24Code('CELL', 'B'), batchId, model: 'sim-3000', manufacturedAt: '2024-01-01', manufactureSourceHash: mHash, designLifeMonths: 96, specSourceHash: sHash });
    await cmd('pack-manufacturer', 'assets', { id: modId, code: gen24Code('MODULE', 'B'), batchId: '', model: 'sim-3000', manufacturedAt: '2024-01-01', manufactureSourceHash: mHash, designLifeMonths: 96, specSourceHash: sHash });
    await cmd('pack-manufacturer', 'assets', { id: packId, code: gen24Code('PACK', 'B'), batchId: '', model: 'sim-3000', manufacturedAt: '2024-01-01', manufactureSourceHash: mHash, designLifeMonths: 96, specSourceHash: sHash });
    await cmd('cell-manufacturer', 'assembly-authorizations', { childId: cellId, parentId: modId, evidenceHash: sha256Hex('a4 supply') });
    await cmd('pack-assembler', 'assembly', { parentId: modId, children: [cellId], revision: 1, evidenceHash: sha256Hex('a4 bind1') });
    await cmd('pack-assembler', 'assembly', { parentId: packId, children: [modId], revision: 1, evidenceHash: sha256Hex('a4 bind2') });

    const labKey = createPrivateKey(getActorPrivateKeyPem('lab-inspector'));
    for (const id of [cellId, modId, packId]) {
      const reportId = uid('a4-rep');
      const plaintext = Buffer.from(JSON.stringify({ simulation: true, assetId: id, result: 'QC_PASSED', version: 1 }));
      const plaintextHash = sha256Hex(plaintext);
      const binding = { id: reportId, assetId: id, version: 1, plaintextHash };
      const sourceSignature = sign('sha256', Buffer.from(canonicalJson(binding)), labKey).toString('base64');
      const up = await callBackendApi<{ sourceHash: string }>('lab-inspector', 'POST', '/reports', {
        requestId: reportId,
        ...binding,
        sourceSignature,
        contentBase64: plaintext.toString('base64'),
      });
      await cmd('lab-inspector', 'inspections', { id: reportId, assetId: id, version: 1, result: 'QC_PASSED', reportHash: plaintextHash, sourceHash: up.data.sourceHash });
    }
    const csv = `asset_id,batch_id,chemistry,model,condition,capacity_mah,resistance_uohm,voltage_mv,temperature_c,simulation\n${cellId},${batchId},LFP,sim-3000,25C-1C,3000,1500,3300,25,true\n`;
    const contentBuf = Buffer.from(csv, 'utf8');
    const issuedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const sourceKey = createPrivateKey(getDemoSourceSigningKeyPem());
    const signature = sign(null, Buffer.from(JSON.stringify({ sourceId: 'lab-source', batchId, payloadHash: sha256Hex(contentBuf), issuedAt })), sourceKey).toString('base64');
    await callBackendApi('lab-inspector', 'POST', '/imports/measurements', {
      requestId: uid('a4-csv'), sourceId: 'lab-source', batchId, issuedAt, signature, contentBase64: contentBuf.toString('base64'),
    });
    const relId = uid('a4-rel');
    await callBackendApi('pack-release', 'POST', '/release/requests', { requestId: uid('a4-relreq'), id: relId, packId });
    for (const approver of ['cell-approver', 'lab-approver', 'pack-approver']) {
      await cmd(approver, 'release-approvals', { id: relId });
    }
    const relState = await callBackendApi<{ releases: { id: string; requiredOrgs: string[] }[] }>('pack-release', 'GET', '/overview/releases');
    const relObj = relState.data.releases.find(r => r.id === relId);
    if (relObj?.requiredOrgs.includes('RecycleOrgMSP')) {
      await cmd('recycle-approver', 'release-approvals', { id: relId });
    }
    await cmd('pack-release', 'release-finalizations', { id: relId });
    await cmd('pack-operator', 'retirements', { assetId: packId, at: '2026-11-01T00:00:00Z', evidenceHash: sha256Hex('a4 retire') });
    targetPack = { id: packId } as BatteryAssetView;
  }

  const transferId = uid('a4-tr');
  const receiptHash = sha256Hex('a4 simulated dual custody receipt');
  const exp = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const tr = await cmd('pack-custodian', 'transfers', {
    id: transferId,
    packId: targetPack.id,
    toMSP: 'RecycleOrgMSP',
    receiptHash,
    expiresAt: exp,
  });
  if (!tr.res.data.completed) throw new Error(`A4 setup transfer failed: ${JSON.stringify(tr.res.data)}`);
  return { transferId, packId: targetPack.id, receiptHash };
}

export async function runAttackScenario(attackId: AttackId): Promise<AttackExecutionResult> {
  const overview = await callBackendApi<{ assets: BatteryAssetView[] }>('cell-viewer', 'GET', '/overview/assets');
  if (overview.status !== 200) throw new Error('Unable to query assets from backend');
  const { anyCell, livePack, scrappedPack } = await ensureDemoAssets(overview.data.assets);
  const meta = ATTACK_CATALOG[attackId];
  const now = new Date().toISOString();

  if (attackId === 'A1') {
    if (!anyCell) throw new Error('No cell asset found for A1');
    const before = await fetchAssetSnapshot('cell-viewer', anyCell.id);
    const reqId = uid('a1');
    const payload = {
      requestId: reqId,
      data: {
        id: uid('spoof-ins'),
        assetId: anyCell.id,
        version: Number(before.inspectionVersion ?? 0) + 1,
        result: 'QC_PASSED',
        reportHash: sha256Hex('spoofed report'),
        sourceHash: sha256Hex('spoofed source'),
      },
    };
    const res = await callBackendApi<{ stage: string; errorCode: string; submittedToOrderer: boolean }>(
      'pack-manufacturer',
      'POST',
      '/lab/endorse-probe',
      payload,
    );
    const after = await fetchAssetSnapshot('cell-viewer', anyCell.id);
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(after));
    return {
      id: 'A1',
      ...meta,
      actorUsed: getPublicIdentity('pack-manufacturer'),
      requestSummary: { method: 'POST', route: '/api/v1/lab/endorse-probe (Fabric Peer Endorse)', payloadPreview: payload },
      responseSummary: {
        httpStatus: res.status,
        stage: res.data.stage ?? 'rejected',
        errorCode: res.data.errorCode ?? 'FORBIDDEN',
        rawBody: res.data,
      },
      blocked: res.data.stage === 'rejected' && res.data.errorCode === 'FORBIDDEN',
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: `目标电芯 ${anyCell.id} 未被签发，链码在 Peer 背书阶段直接拒绝 PackOrgMSP 冒充 LabOrgMSP。`,
      telemetry: {
        interceptionLayer: 'PEER_ENDORSEMENT_REJECTED',
        interceptionLabel: 'Fabric Peer 背书拒绝（未调用 submit）',
        attackEntry: 'Fabric Gateway Peer Endorse (/api/v1/lab/endorse-probe)',
        reachedFabric: true,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 客户端证书签名', status: 'pass', detail: '使用 pack-manufacturer mTLS 身份发起请求' },
          { step: '2. 路由与结构校验', status: 'pass', detail: '跳过前端角色伪装，透传至 Peer 背书探测器' },
          { step: '3. Fabric Peer 背书仿真', status: 'blocked', detail: `链码拒绝：${res.data.errorCode ?? 'FORBIDDEN'}（PackOrgMSP 无权签发质检）` },
          { step: '4. Orderer 排序提交', status: 'skipped', detail: 'endorse-probe 严禁调用 submit()' },
          { step: '5. 区块落账写入', status: 'skipped', detail: '账本状态哈希前后完全一致' },
        ],
      },
    };
  }

  if (attackId === 'A2') {
    const packId = await ensureA2RejectedPack(overview.data.assets);
    const before = await fetchAssetSnapshot('pack-viewer', packId);
    const reqId = uid('a2');
    const relId = uid('a2-rel');
    const payload = { requestId: reqId, id: relId, packId };
    const res = await callBackendApi<{ stage?: string; errorCode?: string; code?: string }>(
      'pack-release',
      'POST',
      '/release/requests',
      payload,
    );
    const after = await fetchAssetSnapshot('pack-viewer', packId);
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(after));
    return {
      id: 'A2',
      ...meta,
      actorUsed: getPublicIdentity('pack-release'),
      requestSummary: { method: 'POST', route: '/api/v1/release/requests', payloadPreview: payload },
      responseSummary: {
        httpStatus: res.status,
        stage: res.data.stage ?? 'rejected',
        errorCode: res.data.errorCode ?? res.data.code ?? 'QUALITY_GATE',
        rawBody: res.data,
      },
      blocked: res.data.stage === 'rejected' && res.data.errorCode === 'QUALITY_GATE',
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: `含 QC_REJECTED 电芯的电池包 ${packId} 申请放行被链码 QUALITY_GATE 拦截，状态维持 ASSEMBLED。`,
      telemetry: {
        interceptionLayer: 'CHAINCODE_REJECTED',
        interceptionLabel: 'Go 链码质量门禁拒绝',
        attackEntry: 'NestJS Release API -> Fabric Chaincode RequestRelease',
        reachedFabric: true,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 身份与风险凭证生成', status: 'pass', detail: 'pack-release mTLS 认证并生成服务端风险凭证' },
          { step: '2. 链码提案构建', status: 'pass', detail: `发送 RequestRelease(packId=${packId})` },
          { step: '3. Go 链码状态机核验', status: 'blocked', detail: '检测到下游电芯为 QC_REJECTED，触发 QUALITY_GATE 拒绝' },
          { step: '4. Orderer 排序提交', status: 'skipped', detail: '背书失败，未提交至排序服务' },
          { step: '5. 区块落账写入', status: 'skipped', detail: 'PACK 保持 ASSEMBLED，零篡改' },
        ],
      },
    };
  }

  if (attackId === 'A3') {
    if (!anyCell) throw new Error('No cell asset found for A3');
    const before = await fetchAssetSnapshot('lab-inspector', anyCell.id);
    const reportId = uid('a3-tamper');
    const originalPlaintext = Buffer.from(JSON.stringify({ simulation: true, assetId: anyCell.id, result: 'QC_PASSED', version: Number(before.inspectionVersion ?? 0) + 1 }));
    const binding = {
      id: reportId,
      assetId: anyCell.id,
      version: Number(before.inspectionVersion ?? 0) + 1,
      plaintextHash: sha256Hex(originalPlaintext),
    };
    const key = createPrivateKey(getActorPrivateKeyPem('lab-inspector'));
    const sourceSignature = sign('sha256', Buffer.from(canonicalJson(binding)), key).toString('base64');
    const payload = {
      requestId: uid('a3'),
      ...binding,
      sourceSignature,
      contentBase64: Buffer.from('tampered simulation report payload').toString('base64'),
    };
    const res = await callBackendApi<{ code?: string }>('lab-inspector', 'POST', '/reports', payload);
    const after = await fetchAssetSnapshot('lab-inspector', anyCell.id);
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(after));
    return {
      id: 'A3',
      ...meta,
      actorUsed: getPublicIdentity('lab-inspector'),
      requestSummary: {
        method: 'POST',
        route: '/api/v1/reports',
        payloadPreview: { ...binding, tamperedPlaintext: 'tampered simulation report payload' },
      },
      responseSummary: {
        httpStatus: res.status,
        stage: 'rejected',
        errorCode: res.data.code ?? 'REPORT_HASH_MISMATCH',
        rawBody: res.data,
      },
      blocked: res.status === 400 && res.data.code === 'REPORT_HASH_MISMATCH',
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: `服务端比对密文前明文哈希与签名绑定摘要不匹配，拒绝写入对象存储及数据库。`,
      telemetry: {
        interceptionLayer: 'API_INTEGRITY_REJECTED',
        interceptionLabel: 'API 网关完整性核验拦截',
        attackEntry: 'NestJS Report Upload API (/api/v1/reports)',
        reachedFabric: false,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 合法检验员 mTLS 认证', status: 'pass', detail: 'lab-inspector 通过 TLS 双向认证' },
          { step: '2. 网关 SHA-256 摘要校验', status: 'blocked', detail: 'HTTP 400 REPORT_HASH_MISMATCH：正文被篡改' },
          { step: '3. MinIO AEAD 加密写入', status: 'skipped', detail: '已提前拦截，未写入密文对象' },
          { step: '4. Fabric 链码背书', status: 'skipped', detail: '未触发任何链上交易' },
          { step: '5. 区块落账写入', status: 'skipped', detail: '资产质检版本不变' },
        ],
      },
    };
  }

  if (attackId === 'A4') {
    const { transferId, packId, receiptHash } = await ensureA4SentTransfer();
    const before = await fetchAssetSnapshot('pack-viewer', packId);
    const reqId = uid('a4');
    const payload = { requestId: reqId, data: { id: transferId, receiptHash } };
    const res = await callBackendApi<{ stage?: string; errorCode?: string }>(
      'pack-custodian',
      'POST',
      '/commands/transfer-confirmations',
      payload,
    );
    const after = await fetchAssetSnapshot('pack-viewer', packId);
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(after));
    return {
      id: 'A4',
      ...meta,
      actorUsed: getPublicIdentity('pack-custodian'),
      requestSummary: { method: 'POST', route: '/api/v1/commands/transfer-confirmations', payloadPreview: payload },
      responseSummary: {
        httpStatus: res.status,
        stage: res.data.stage ?? 'rejected',
        errorCode: res.data.errorCode ?? 'FORBIDDEN',
        rawBody: res.data,
      },
      blocked: res.data.stage === 'rejected' && res.data.errorCode === 'FORBIDDEN',
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: `交接单 ${transferId} 转出方 PackOrgMSP 企图自签确认收货，被链码 FORBIDDEN 拒绝，持有方未变更。`,
      telemetry: {
        interceptionLayer: 'CHAINCODE_REJECTED',
        interceptionLabel: 'Go 链码双签接收方校验拒绝',
        attackEntry: 'NestJS Command API -> Chaincode ConfirmTransfer',
        reachedFabric: true,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 转出方 mTLS 认证', status: 'pass', detail: 'pack-custodian (PackOrgMSP) 发起确认' },
          { step: '2. 路由与请求构造', status: 'pass', detail: `构建 ConfirmTransfer(id=${transferId})` },
          { step: '3. Go 链码双签授权校验', status: 'blocked', detail: '触发 FORBIDDEN：发送方不可充当接收方自签确认' },
          { step: '4. Orderer 排序提交', status: 'skipped', detail: '背书阶段即中止' },
          { step: '5. 区块落账写入', status: 'skipped', detail: 'holderMSP 保持不变' },
        ],
      },
    };
  }

  if (attackId === 'A5') {
    if (!scrappedPack) throw new Error('No PROCESSED/scrapped pack found for A5');
    const before = await fetchAssetSnapshot('recycle-viewer', scrappedPack.id);
    const reqId = uid('a5');
    const payload = {
      requestId: reqId,
      data: {
        id: uid('a5-invalid-return'),
        packId: scrappedPack.id,
        toMSP: 'PackOrgMSP',
        receiptHash: sha256Hex('illegal return transfer'),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    };
    const res = await callBackendApi<{ stage?: string; errorCode?: string }>(
      'recycle-custodian',
      'POST',
      '/commands/transfers',
      payload,
    );
    const after = await fetchAssetSnapshot('recycle-viewer', scrappedPack.id);
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(after));
    return {
      id: 'A5',
      ...meta,
      actorUsed: getPublicIdentity('recycle-custodian'),
      requestSummary: { method: 'POST', route: '/api/v1/commands/transfers', payloadPreview: payload },
      responseSummary: {
        httpStatus: res.status,
        stage: res.data.stage ?? 'rejected',
        errorCode: res.data.errorCode ?? 'FORBIDDEN',
        rawBody: res.data,
      },
      blocked: res.data.stage === 'rejected' && res.data.errorCode === 'FORBIDDEN',
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: `已报废电池包 ${scrappedPack.id} 不允许通过普通交接通道回流至 PackOrgMSP。`,
      telemetry: {
        interceptionLayer: 'CHAINCODE_REJECTED',
        interceptionLabel: 'Go 链码生命周期终态防回流拒绝',
        attackEntry: 'NestJS Command API -> Chaincode InitiateTransfer',
        reachedFabric: true,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 回收方 mTLS 认证', status: 'pass', detail: 'recycle-custodian 对已报废 PACK 发起交接' },
          { step: '2. 交易提案构建', status: 'pass', detail: `InitiateTransfer(packId=${scrappedPack.id} -> PackOrgMSP)` },
          { step: '3. Go 链码终态状态机检查', status: 'blocked', detail: 'PACK 处于 PROCESSED 终态，拒绝回流普通流转' },
          { step: '4. Orderer 排序提交', status: 'skipped', detail: '背书失败，未提交排序' },
          { step: '5. 区块落账写入', status: 'skipped', detail: '资产维持 PROCESSED 报废态' },
        ],
      },
    };
  }

  if (attackId === 'A6') {
    const policyRes = await callBackendApi<Record<string, unknown> & { version: number }>('cell-admin', 'GET', '/policies/current');
    if (policyRes.status !== 200) throw new Error('Unable to read current policy');
    const before = policyRes.data;
    const candId = uid('a6-weak-policy');
    const candidate = { id: candId, policy: { ...before, version: before.version + 1, requiredOrgs: ['PackOrgMSP'] } };
    const preview = await callBackendApi<{ report: { passed: boolean }; testsHash: string }>(
      'cell-admin',
      'POST',
      '/policies/previews',
      candidate,
    );
    const proposePayload = { requestId: uid('a6'), data: { ...candidate, testsHash: preview.data.testsHash } };
    const denied = await callBackendApi<{ code?: string }>('cell-admin', 'POST', '/commands/policy-candidates', proposePayload);
    const afterRes = await callBackendApi<Record<string, unknown>>('cell-admin', 'GET', '/policies/current');
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(afterRes.data));
    return {
      id: 'A6',
      ...meta,
      actorUsed: getPublicIdentity('cell-admin'),
      requestSummary: { method: 'POST', route: '/api/v1/policies/previews -> /commands/policy-candidates', payloadPreview: candidate },
      responseSummary: {
        httpStatus: denied.status,
        stage: 'rejected',
        errorCode: denied.data.code ?? 'POLICY_PREVIEW_REQUIRED',
        rawBody: { previewPassed: preview.data.report?.passed, proposeResponse: denied.data },
      },
      blocked: preview.data.report?.passed === false && denied.status === 409 && denied.data.code === 'POLICY_PREVIEW_REQUIRED',
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: `弱化策略（仅 PackOrgMSP 单方审批）在隔离 Go 回归中直接失败，API 拒绝提交候选，线上策略维持 v${before.version}。`,
      telemetry: {
        interceptionLayer: 'API_POLICY_GATE_REJECTED',
        interceptionLabel: '策略沙箱预演 + API 409 前置门禁拦截',
        attackEntry: 'Policy Preview Sandbox -> /api/v1/commands/policy-candidates',
        reachedFabric: true,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 读取线上安全策略', status: 'pass', detail: `从 Fabric 读取当前生效策略 v${before.version}` },
          { step: '2. 隔离 Go 安全回归测试', status: 'blocked', detail: '弱化策略未能阻断单方放行用例，passed=false' },
          { step: '3. API 提交候选门禁检查', status: 'blocked', detail: 'HTTP 409 POLICY_PREVIEW_REQUIRED 拒绝提议候选' },
          { step: '4. Orderer 排序提交', status: 'skipped', detail: '未向 Fabric 提交任何策略变更' },
          { step: '5. 区块落账写入', status: 'skipped', detail: `线上策略哈希保持 v${before.version} 不变` },
        ],
      },
    };
  }

  if (attackId === 'A7') {
    const refPack = livePack ?? scrappedPack ?? anyCell;
    if (!refPack) throw new Error('No reference asset for A7');
    const before = await fetchAssetSnapshot('cell-viewer', refPack.id);
    const badCodes = [refPack.code.slice(1), `${refPack.code}0`, `${refPack.code.slice(0, 4)}I${refPack.code.slice(5)}`];
    const results: { code: string; status: number; body: unknown }[] = [];
    for (const c of badCodes) {
      const r = await callBackendApi('cell-viewer', 'GET', `/codes/${encodeURIComponent(c)}`);
      results.push({ code: c, status: r.status, body: r.data });
    }
    const after = await fetchAssetSnapshot('cell-viewer', refPack.id);
    const bHash = sha256Hex(canonicalJson(before));
    const aHash = sha256Hex(canonicalJson(after));
    const allRejected = results.every(r => r.status === 400);
    return {
      id: 'A7',
      ...meta,
      actorUsed: getPublicIdentity('cell-viewer'),
      requestSummary: { method: 'GET', route: '/api/v1/codes/{invalid}', payloadPreview: { badCodes } },
      responseSummary: {
        httpStatus: 400,
        stage: 'rejected',
        errorCode: 'CODE_FORMAT / CODE_CHEMISTRY',
        rawBody: results,
      },
      blocked: allRejected,
      stateUnchanged: bHash === aHash,
      beforeDigest: bHash,
      afterDigest: aHash,
      checkedAt: now,
      notes: '23位、25位及第 5 位非法字母 I 的编码均被 GB/T 34014 链码解析器明确拒绝。',
      telemetry: {
        interceptionLayer: 'CHAINCODE_QUERY_REJECTED',
        interceptionLabel: 'GB/T 34014 链码编码解析器拒绝',
        attackEntry: 'NestJS Code API -> Chaincode Query("code")',
        reachedFabric: true,
        endorsed: false,
        submitted: false,
        writtenToBlock: false,
        timeline: [
          { step: '1. 构建 3 组畸形编码', status: 'pass', detail: '23位截断码、25位超长码、第5位非法字母 I' },
          { step: '2. 转发至链码 ParseCode', status: 'pass', detail: '调用 Fabric Query("code") 执行标准规则校验' },
          { step: '3. 标准字段与字典校验', status: 'blocked', detail: '3 组全部返回 HTTP 400 (CODE_FORMAT / CODE_CHEMISTRY)' },
          { step: '4. Orderer 排序提交', status: 'skipped', detail: '只读校验不产生写交易' },
          { step: '5. 区块落账写入', status: 'skipped', detail: '链上资产索引未受影响' },
        ],
      },
    };
  }

  // A8
  const targetLive = livePack ?? scrappedPack;
  if (!targetLive) throw new Error('No pack asset found for A8');
  const before = await fetchAssetSnapshot('cell-viewer', targetLive.id);
  const reqId = uid('a8');
  const payload = {
    requestId: reqId,
    data: {
      assetId: targetLive.id,
      at: '2026-11-03T00:00:00Z',
      evidenceHash: sha256Hex('unauthorized simulated scrap confirmation'),
    },
  };
  const res = await callBackendApi<{ stage?: string; errorCode?: string }>(
    'cell-manufacturer',
    'POST',
    '/commands/scrap-confirmations',
    payload,
  );
  const after = await fetchAssetSnapshot('cell-viewer', targetLive.id);
  const bHash = sha256Hex(canonicalJson(before));
  const aHash = sha256Hex(canonicalJson(after));
  return {
    id: 'A8',
    ...meta,
    actorUsed: getPublicIdentity('cell-manufacturer'),
    requestSummary: { method: 'POST', route: '/api/v1/commands/scrap-confirmations', payloadPreview: payload },
    responseSummary: {
      httpStatus: res.status,
      stage: res.data.stage ?? 'rejected',
      errorCode: res.data.errorCode ?? 'FORBIDDEN',
      rawBody: res.data,
    },
    blocked: res.data.stage === 'rejected' && res.data.errorCode === 'FORBIDDEN',
    stateUnchanged: bHash === aHash,
    beforeDigest: bHash,
    afterDigest: aHash,
    checkedAt: now,
    notes: `普通制造企业 CellOrgMSP 试图伪造 ${targetLive.id} 的报废确认事件，被链码 FORBIDDEN 拦截。`,
    telemetry: {
      interceptionLayer: 'CHAINCODE_REJECTED',
      interceptionLabel: 'Go 链码身份与回收权限拒绝',
      attackEntry: 'NestJS Command API -> Chaincode RecordScrapConfirmation',
      reachedFabric: true,
      endorsed: false,
      submitted: false,
      writtenToBlock: false,
      timeline: [
        { step: '1. 制造企业 mTLS 认证', status: 'pass', detail: 'cell-manufacturer (CellOrgMSP) 发起请求' },
        { step: '2. 交易提案构建', status: 'pass', detail: `RecordScrapConfirmation(assetId=${targetLive.id})` },
        { step: '3. Go 链码 MSP/角色校验', status: 'blocked', detail: '触发 FORBIDDEN：仅 RecycleOrgMSP recycler 可确认报废' },
        { step: '4. Orderer 排序提交', status: 'skipped', detail: '背书失败，未提交至排序节点' },
        { step: '5. 区块落账写入', status: 'skipped', detail: '在用电池状态与 scrappedAt 保持不变' },
      ],
    },
  };
}
