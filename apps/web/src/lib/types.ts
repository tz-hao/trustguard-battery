export type OrganizationMSP = 'CellOrgMSP' | 'PackOrgMSP' | 'LabOrgMSP' | 'RecycleOrgMSP';

export interface PublicIdentity {
  name: string;
  mspId: OrganizationMSP;
  role: string;
  orgLabel: string;
  roleLabel: string;
  fingerprintPrefix: string;
}

export interface ServiceAge {
  years: number;
  months: number;
  days: number;
}

export interface BatteryAssetView {
  id: string;
  code: string;
  type: 'CELL' | 'MODULE' | 'PACK';
  makerCode: string;
  makerMSP: OrganizationMSP;
  makerName?: string;
  makerSource?: { simulation: boolean; sourceHash: string };
  chemistry: string;
  batchId?: string;
  model: string;
  holderMSP: OrganizationMSP;
  simulation: boolean;
  manufacturedAt: string;
  manufactureSourceHash?: string;
  designLifeMonths: number | null;
  specSourceHash?: string;
  state: string;
  statusLabel: string;
  quality: 'NOT_TESTED' | 'QC_PASSED' | 'QC_REJECTED' | 'REVIEW_REQUIRED' | string;
  version: number;
  assemblyVersion: number;
  parentId?: string;
  children: string[];
  inspectionVersion: number;
  installedAt: string | null;
  firstUseAt: string | null;
  serviceAge: ServiceAge | null;
  retiredAt: string | null;
  recyclingReceivedAt: string | null;
  scrappedAt: string | null;
  scrapped: boolean;
  updatedAt: string;
  txId: string;
  evidence: {
    txId: string;
    updatedAt: string;
    simulation: boolean;
    source: string;
  };
  asOf?: string;
  containingPack?: {
    id: string;
    state: string;
    firstUseAt: string | null;
    txId: string;
  } | null;
  componentQualityAlerts?: {
    assetId: string;
    quality: string;
    inspectionVersion: number;
  }[];
}

export interface ParsedCodeView {
  code: string;
  makerCode: string;
  productType: string;
  chemistry: string;
  specCode: string;
  traceCode: string;
  dateCode: string;
  serial: string;
  validation: string;
  standardVersion: string;
  standardSourceHash: string;
  codeScope: string;
  batteryTypeCode: string;
  batteryTypeName: string;
  productionDateCode: {
    yearCode: string;
    cycleFirstYear: number;
    yearCycle: number;
    month: number;
    day: number;
    requiresSourceDate: boolean;
  };
  additionalSpecCodeCandidate?: string;
}

export interface HealthDataView {
  designLifeMonths: number | null;
  sohPct: number | null;
  sohBasisPoints: number | null;
  cycleCount: number | null;
  measuredAt: string | null;
  sourceHash: string | null;
  simulation: boolean;
  remainingLifeEstimate: number | null;
  plannedScrapAt: string | null;
  remainingLifeUnavailableReason: string;
  source: string | null;
  asOf: string;
}

export const ORG_LABELS: Record<string, string> = {
  CellOrgMSP: '电芯制造企业 (CellOrg)',
  PackOrgMSP: 'PACK 装配企业 (PackOrg)',
  LabOrgMSP: '第三方检测机构 (LabOrg)',
  RecycleOrgMSP: '退役回收企业 (RecycleOrg)',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: '组织管理员',
  manufacturer: '生产制造员',
  inspector: '质检签发员',
  assembler: '模组/PACK 装配员',
  approver: '联合审批员',
  release: '放行申请员',
  custodian: '资产交接保管员',
  operator: '运维/装车登记员',
  recycler: '退役回收确认员',
  auditor: '独立审计员',
  viewer: '只读观察员',
};

export const QUALITY_LABELS: Record<string, { label: string; tone: 'emerald' | 'rose' | 'amber' | 'slate' }> = {
  QC_PASSED: { label: '质检合格', tone: 'emerald' },
  QC_REJECTED: { label: '质检不合格', tone: 'rose' },
  REVIEW_REQUIRED: { label: '待独立复核', tone: 'amber' },
  NOT_TESTED: { label: '尚未检测', tone: 'slate' },
};

export const CHEMISTRY_LABELS: Record<string, string> = {
  LFP: '磷酸铁锂 (LFP)',
  TERNARY: '三元材料 (NCM/NCA)',
  NIMH: '镍氢电池 (NiMH)',
  LMO: '锰酸锂 (LMO)',
  LCO: '钴酸锂 (LCO)',
  SUPERCAPACITOR: '超级电容器',
  LTO: '钛酸锂 (LTO)',
  LMFP: '磷酸锰铁锂 (LMFP)',
  SODIUM_ION: '钠离子电池',
  OTHER: '其他体系',
};

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  CELL: '电芯单体 (Cell)',
  MODULE: '电池模块 (Module)',
  PACK: '动力电池包 (PACK)',
};

export const ERROR_DESCRIPTIONS: Record<string, string> = {
  FORBIDDEN: '权限拒绝：当前证书所属组织或角色无权执行此操作',
  QUALITY_GATE: '质量门禁阻断：电芯或组件未达到有效 QC_PASSED 合格状态',
  REPORT_HASH_MISMATCH: '完整性校验失败：上报文件 SHA-256 摘要与声明不一致',
  VERIFIED_REPORT_REQUIRED: '缺少经本机构核验的加密检测报告',
  REPORT_ACCESS_REVOKED: '报告访问权限已被撤权，API 与独立密钥服务拒绝解密',
  POLICY_PREVIEW_REQUIRED: '策略未通过隔离回归预演或基线版本不匹配，禁止发布',
  UNSAFE_POLICY: '链码安全底线拒绝：策略不能取消独立复核或低于最低安全门槛',
  CODE_FORMAT: '编码长度或字符集不符合 GB/T 34014—2017（24位大写字母/数字）',
  CODE_PRODUCT: '第 4 位产品类别代码非法（仅支持 C/M/P）',
  CODE_CHEMISTRY: '第 5 位电池材料类型代码未在适用标准版本中定义',
  CODE_DATE: '第 15–17 位生产日期代码非法或日历日期不存在',
  CODE_DATE_MISMATCH: '编码生产日期与来源声明的 manufacturedAt 不一致',
  TERMINAL_STATE: '资产已处于终态（已报废/已处理），不可逆转或普通流转',
  INVALID_STATE: '当前生命周期状态不允许该业务操作',
  VERSION_CONFLICT: '资产或策略版本号冲突，禁止覆盖历史记录',
  ALREADY_EXISTS: '唯一性约束拒绝：资产编码或业务单号已存在',
  NOT_FOUND: '链上或索引中未找到对应记录',
  IDEMPOTENCY_CONFLICT: '幂等冲突：同一 requestId 被用于不同的请求载荷',
  RISK_UNAVAILABLE: '风控服务不可用：系统保守降级，暂停自动放行',
  RATE_LIMITED: '接口限流保护已触发，请稍后重试',
};

export function formatServiceAge(age: ServiceAge | null): string {
  if (!age) return '暂无（未记录首次投用时间）';
  const parts: string[] = [];
  if (age.years > 0) parts.push(`${age.years} 年`);
  if (age.months > 0) parts.push(`${age.months} 个月`);
  if (age.days > 0 || parts.length === 0) parts.push(`${age.days} 天`);
  return parts.join(' ');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '暂无记录';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

export function shortHash(value: string | null | undefined, left = 10, right = 6): string {
  if (!value) return '—';
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}...${value.slice(-right)}`;
}
