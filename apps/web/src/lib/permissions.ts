import type { OrganizationMSP, PublicIdentity } from './types';

export type RoutePath =
  | '/'
  | '/identity'
  | '/inspections'
  | '/trace'
  | '/approvals'
  | '/transfers'
  | '/risk'
  | '/policies'
  | '/lab'
  | '/audit'
  | '/organizations';

export interface RouteMeta {
  href: RoutePath;
  group: string;
  label: string;
  shortDesc: string;
}

export const ALL_ROUTES: RouteMeta[] = [
  { href: '/', group: '工作台', label: '安全驾驶舱', shortDesc: '全局态势、资产分布与链上同步监控' },
  { href: '/identity', group: '电池管理', label: '电池数字身份', shortDesc: 'GB/T 34014 按码查档、批次建档与生命周期推进' },
  { href: '/inspections', group: '电池管理', label: '质量检测中心', shortDesc: '加密检测报告签发、AI 筛查与独立复检' },
  { href: '/trace', group: '电池管理', label: '电池谱系追溯', shortDesc: '批次/单电芯谱系图谱与装配供货管理' },
  { href: '/approvals', group: '企业协作', label: '联合审批中心', shortDesc: 'PACK 放行申请与多组织背书会签' },
  { href: '/transfers', group: '企业协作', label: '企业交接管理', shortDesc: '四阶段跨企业双向交接与退役回收移交' },
  { href: '/risk', group: '智能风控', label: 'AI 风险分析', shortDesc: 'Isolation Forest 异常检测与 NetworkX 合谋分析' },
  { href: '/policies', group: '智能风控', label: '安全策略管理', shortDesc: '策略隔离预演、四组织会签与版本激活' },
  { href: '/lab', group: '区块链安全', label: '安全攻防实验室', shortDesc: 'A1–A8 越权/伪造/重放攻防实链演练' },
  { href: '/audit', group: '区块链安全', label: '区块链审计中心', shortDesc: '幂等交易对账、Ed25519 日志与链上摘要锚定' },
  { href: '/organizations', group: '系统管理', label: '组织与权限管理', shortDesc: '四组织联盟拓扑与 mTLS 身份白名单治理' },
];

/**
 * 14 核心实战业务岗位（覆盖 4 家机构在完整生命周期闭环中实际参与背书的核心证书）
 * 其余 14 个证书保留为辅助/四方会签/只读观察证书，可在登录页及组织管理页展开切换。
 */
export const CORE_IDENTITY_NAMES: ReadonlySet<string> = new Set([
  // 电芯制造企业 CellOrgMSP (3)
  'cell-manufacturer',
  'cell-approver',
  'cell-admin',
  // PACK 装配企业 PackOrgMSP (6)
  'pack-manufacturer',
  'pack-assembler',
  'pack-release',
  'pack-approver',
  'pack-custodian',
  'pack-operator',
  // 第三方检测机构 LabOrgMSP (3)
  'lab-inspector',
  'lab-approver',
  'lab-auditor',
  // 退役回收企业 RecycleOrgMSP (2)
  'recycle-custodian',
  'recycle-recycler',
]);

export const ORG_PROFILES: {
  mspId: OrganizationMSP;
  shortName: string;
  name: string;
  tagline: string;
  peerPort: string;
  accent: string;
  badgeBg: string;
}[] = [
  {
    mspId: 'CellOrgMSP',
    shortName: '电芯制造企业',
    name: '电芯制造企业 (CellOrg)',
    tagline: '负责原料与电芯批次建档、24 位国标编码注册及供货授权',
    peerPort: 'Peer :17051',
    accent: '#2563EB',
    badgeBg: 'bg-blue-500/12 text-blue-700 border-blue-500/25',
  },
  {
    mspId: 'PackOrgMSP',
    shortName: 'PACK 装配企业',
    name: 'PACK 装配企业 (PackOrg)',
    tagline: '负责模组与电池包成组装配、放行申报、装车运维及对外交接',
    peerPort: 'Peer :19051',
    accent: '#0F9D8A',
    badgeBg: 'bg-teal-500/12 text-teal-700 border-teal-500/25',
  },
  {
    mspId: 'LabOrgMSP',
    shortName: '第三方检测机构',
    name: '第三方检测机构 (LabOrg)',
    tagline: '负责独立质检报告签发、健康度监测、风险复核与合规审计',
    peerPort: 'Peer :21051',
    accent: '#3185D8',
    badgeBg: 'bg-sky-500/12 text-sky-700 border-sky-500/25',
  },
  {
    mspId: 'RecycleOrgMSP',
    shortName: '退役回收企业',
    name: '退役回收企业 (RecycleOrg)',
    tagline: '负责退役电池包签收交接、入库接收及报废终态核销',
    peerPort: 'Peer :23051',
    accent: '#159B76',
    badgeBg: 'bg-emerald-500/12 text-emerald-700 border-emerald-500/25',
  },
];

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  manufacturer: '电芯与电池批次建档、24 位编码注册与供货授权',
  assembler: '模组与电池包成组绑定、拆解及谱系维护',
  inspector: '质量检测签发、量测筛查与健康度采集',
  release: '发起电池包放行申请并执行最终放行',
  approver: '代表本企业参与多方联合放行审批',
  custodian: '发起、签收并确认跨企业电池包交接',
  operator: '登记装车、首用、退役及生命周期记录',
  recycler: '确认退役电池包回收接收与正式报废核销',
  auditor: '发起独立复检、审批策略变更与审计核验',
  admin: '负责全局策略预演、组织权限与系统治理',
  viewer: '只读浏览资产档案、谱系图谱与运行态势',
};

export interface RoleCapabilities {
  allowedRoutes: RoutePath[];
  defaultRoute: RoutePath;
  canCreateBatch: boolean;
  canRegisterCell: boolean;
  canRegisterModuleOrPack: boolean;
  canRegisterAnyAsset: boolean;
  canAuthorizeAssembly: boolean;
  canBindAssembly: boolean;
  canSubmitInspection: boolean;
  canImportHealth: boolean;
  canProposeRetest: boolean;
  canRequestRelease: boolean;
  canApproveRelease: boolean;
  canManageTransfers: boolean;
  canRecordInstallOrFirstUse: boolean;
  canRecordRetirement: boolean;
  canRecordRecyclingOrScrap: boolean;
  canAdvanceAnyLifecycle: boolean;
  canProposeCorrection: boolean;
  canApproveCorrection: boolean;
  canManagePolicies: boolean;
  canApprovePolicies: boolean;
  canReadLedgerAudit: boolean;
}

export function getAllowedRoutes(actor: PublicIdentity | null): RoutePath[] {
  if (!actor) return ALL_ROUTES.map(r => r.href);
  const { mspId, role } = actor;

  switch (role) {
    case 'manufacturer':
      // 电芯/PACK 生产制造员专注「电池数字身份」与「电池谱系追溯」
      return ['/identity', '/trace'];
    case 'assembler':
      return ['/trace', '/identity'];
    case 'inspector':
      return ['/inspections', '/identity', '/risk', '/trace'];
    case 'release':
      return ['/approvals', '/risk', '/trace', '/identity'];
    case 'approver':
      return ['/approvals', '/risk', '/trace', '/identity'];
    case 'custodian':
      return ['/transfers', '/identity', '/trace'];
    case 'operator':
      return ['/identity', '/trace', '/transfers'];
    case 'recycler':
      return ['/identity', '/transfers', '/trace'];
    case 'auditor':
      return ['/', '/audit', '/policies', '/inspections', '/lab', '/trace', '/identity'];
    case 'admin':
      return [
        '/',
        '/policies',
        '/organizations',
        '/audit',
        '/lab',
        '/risk',
        '/identity',
        '/trace',
        '/inspections',
        '/approvals',
        '/transfers',
      ];
    case 'viewer':
      return mspId === 'LabOrgMSP'
        ? ['/', '/identity', '/inspections', '/trace', '/audit', '/organizations']
        : ['/', '/identity', '/trace', '/audit', '/organizations'];
    default:
      return ['/', '/identity', '/trace'];
  }
}

export function getDefaultRouteForActor(actor: PublicIdentity | null): RoutePath {
  const allowed = getAllowedRoutes(actor);
  return allowed[0] ?? '/';
}

export function canAccessRoute(actor: PublicIdentity | null, pathname: string): boolean {
  if (!actor) return true;
  if (pathname === '/login') return true;
  const allowed = getAllowedRoutes(actor);
  return allowed.some(route => (route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(`${route}/`)));
}

export function getCapabilities(actor: PublicIdentity | null): RoleCapabilities {
  const msp = actor?.mspId;
  const role = actor?.role;
  const allowedRoutes = getAllowedRoutes(actor);

  const canCreateBatch = msp === 'CellOrgMSP' && role === 'manufacturer';
  const canRegisterCell = msp === 'CellOrgMSP' && role === 'manufacturer';
  const canRegisterModuleOrPack = msp === 'PackOrgMSP' && role === 'manufacturer';
  const canRecordInstallOrFirstUse = msp === 'PackOrgMSP' && role === 'operator';
  const canRecordRetirement = (msp === 'PackOrgMSP' || msp === 'CellOrgMSP') && role === 'operator';
  const canRecordRecyclingOrScrap = msp === 'RecycleOrgMSP' && role === 'recycler';

  return {
    allowedRoutes,
    defaultRoute: allowedRoutes[0] ?? '/',
    canCreateBatch,
    canRegisterCell,
    canRegisterModuleOrPack,
    canRegisterAnyAsset: canRegisterCell || canRegisterModuleOrPack,
    canAuthorizeAssembly: msp === 'CellOrgMSP' && role === 'manufacturer',
    canBindAssembly: msp === 'PackOrgMSP' && role === 'assembler',
    canSubmitInspection: msp === 'LabOrgMSP' && role === 'inspector',
    canImportHealth: msp === 'LabOrgMSP' && role === 'inspector',
    canProposeRetest: msp === 'LabOrgMSP' && role === 'auditor',
    canRequestRelease: msp === 'PackOrgMSP' && role === 'release',
    canApproveRelease: role === 'approver',
    canManageTransfers: role === 'custodian',
    canRecordInstallOrFirstUse,
    canRecordRetirement,
    canRecordRecyclingOrScrap,
    canAdvanceAnyLifecycle: canRecordInstallOrFirstUse || canRecordRetirement || canRecordRecyclingOrScrap,
    canProposeCorrection: canRecordRetirement || canRecordRecyclingOrScrap,
    canApproveCorrection: role === 'auditor',
    canManagePolicies: role === 'admin',
    canApprovePolicies: role === 'auditor',
    canReadLedgerAudit: role === 'auditor',
  };
}

export function getRoleSummaryForIdentity(identity: PublicIdentity): string {
  if (identity.mspId === 'CellOrgMSP' && identity.role === 'manufacturer') {
    return '电芯批次建档、24 位国标码注册与供货授权';
  }
  if (identity.mspId === 'PackOrgMSP' && identity.role === 'manufacturer') {
    return '电池模组与动力电池包 24 位身份建档';
  }
  if (identity.mspId === 'RecycleOrgMSP' && identity.role === 'custodian') {
    return '签收退役电池包交接凭证并完成接收移交';
  }
  return ROLE_DESCRIPTIONS[identity.role] ?? '企业工作台岗位身份';
}
