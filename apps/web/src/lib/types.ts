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
  originAssetId?: string;
  originCode?: string;
  echelonAssetId?: string;
  echelonCode?: string;
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
  auditor: '组织审计员',
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
  FORBIDDEN: '权限拒绝：当前证书所属组织、岗位角色或资产持有方无权执行此操作（电芯建档/供货需 cell-manufacturer，模组/PACK 建档需 pack-manufacturer，装配绑定需 pack-assembler）',
  INVALID_SUPPLY: '供货授权校验失败：仅允许对「CellOrg 持有且未装配 (REGISTERED)」的单体电芯，授权给「未装配 (REGISTERED)」的目标模组',
  INVALID_ASSEMBLY: '装配绑定校验失败：父级组件须由 PackOrg 持有且处于未放行/未投用状态（REGISTERED/ASSEMBLED），子组件须类型、材料体系匹配且已获供货授权、未被其他组件占用',
  INVALID_ID: '业务单号或资产 ID 格式非法（仅允许字母、数字、连字符或下划线）',
  INVALID_ARGUMENT: '请求参数不完整或格式不符合链码规则，请检查输入字段',
  RETEST_REQUIRED: '当前报告必须先提出复检，再由独立检测员签发新版本。',
  QUALITY_GATE: '质量门禁阻断：电芯或组件未达到有效 QC_PASSED 合格状态',
  REPORT_HASH_MISMATCH: '完整性校验失败：上报文件 SHA-256 摘要与声明不一致',
  VERIFIED_REPORT_REQUIRED: '缺少经本机构核验的加密检测报告',
  REPORT_ACCESS_REVOKED: '报告访问权限已被撤权，API 与独立密钥服务拒绝解密',
  POLICY_PREVIEW_REQUIRED: '策略未通过隔离回归预演或基线版本不匹配，禁止发布',
  POLICY_PREVIEW_EVIDENCE_INVALID: '策略预演报告签名或测试集摘要校验失败，拒绝审批激活',
  UNSAFE_POLICY: '链码安全底线拒绝：策略不能取消独立复核或低于最低安全门槛',
  CODE_FORMAT: '编码长度或字符集不符合 GB/T 34014—2017（24位大写字母/数字）',
  CODE_PRODUCT: '第 4 位产品类别代码非法（仅支持 C/M/P）',
  CODE_CHEMISTRY: '第 5 位电池材料类型代码未在适用标准版本中定义',
  CODE_DATE: '第 15–17 位生产日期代码非法或日历日期不存在',
  CODE_DATE_MISMATCH: '编码生产日期与来源声明的 manufacturedAt 不一致',
  TERMINAL_STATE: '资产已处于终态（已报废/已处理），不可逆转或普通流转',
  INVALID_STATE: '当前生命周期状态不允许该业务操作',
  INVALID_TIME: '请使用 UTC 时间（YYYY-MM-DDTHH:mm:ssZ），并核对已有事件的时间顺序和当前时间',
  INVALID_TRANSFER: '请核对目标组织及资产状态，退役电池仅可交给回收组织',
  TRANSFER_PENDING: '该电池包已有待处理交接，请先签收或取消',
  TRANSFER_EXPIRED: '该交接单已过期，请由转出方取消后重新发起',
  STALE_TRANSFER: '电池包的持有方或版本已变化，请由转出方取消后重新发起',
  VERSION_CONFLICT: '资产或策略版本号冲突，禁止覆盖历史记录',
  ALREADY_EXISTS: '唯一性约束拒绝：资产编码或业务单号已存在',
  NOT_FOUND: '链上或索引中未找到对应记录',
  IDEMPOTENCY_CONFLICT: '幂等冲突：同一 requestId 被用于不同的请求载荷',
  RISK_UNAVAILABLE: '风控服务不可用：系统保守降级，暂停自动放行',
  RATE_LIMITED: '接口限流保护已触发，请稍后重试',
  RELEASE_EXPIRED: '放行申请已过期，请重新发起申请',
  RISK_EXPIRED: '风险凭证已过期或失效，请重新发起放行申请',
  APPROVALS_MISSING: '放行或变更所需的独立组织审批数量不足，请完成全部必需会签',
  CHRONOLOGY_INVALID: '生命周期事件时间顺序不合法，不能早于前序关键事件',
  CODE_SERIAL: '第 18–24 位序列号格式不符合对应标准版本要求',
  CORRECTION_EXPIRED: '日期更正提案已过期，请重新发起更正申请',
  CORRUPT_LINEAGE: '装配谱系引用异常或存在环路，操作已被链码拦截',
  DUPLICATE_APPROVAL: '当前组织或审批人已提交过该笔审批，请勿重复签署',
  DUPLICATE_BINDING: '该子组件已绑定在有效父级组件下，禁止重复装配',
  EMPTY_ASSEMBLY: '装配清单不能为空，请至少选择一个有效子组件',
  HISTORY_UNAVAILABLE: '当前账本环境暂不支持历史轨迹查询，请核查节点状态',
  INVALID_BATCH: '电芯批次不存在或与当前材料体系、组织归属不匹配',
  INVALID_CORRECTION: '日期更正提案参数或审批条件不合法，请核对字段与理由',
  INVALID_DATE: '日期格式不合法或日历中不存在该日期',
  INVALID_HASH: '摘要格式非法，请提供 64 位小写十六进制 SHA-256 哈希',
  INVALID_INPUT: '输入参数缺失或格式有误，请核对表单必填项',
  INVALID_MAKER: '厂商代码未在备案映射中登记，或与当前组织身份不匹配',
  INVALID_RISK: '风险凭证结构不合法或与当前放行请求不匹配',
  INVALID_TRANSFER_STATE: '当前交接单状态不允许执行此操作，请刷新确认最新阶段',
  RISK_BINDING: '风险凭证绑定的资产、版本或请求标识与当前放行单不一致',
  RISK_SIGNATURE: '风险凭证数字签名校验失败，拒绝采信',
  RISK_SIGNER: '风险凭证签发方不在受信任风控服务白名单内',
  STALE_APPROVAL: '审批所依据的资产、质检或策略版本已过期，请基于最新版本重审',
  STALE_CORRECTION: '日期更正提案所依据的资产版本已变化，请重新提交',
  STALE_POLICY: '请求绑定的安全策略版本已过期，请刷新后按当前生效策略提交',
  STANDARD_NOT_VERIFIED: '当前版本未启用正式企业编码登记，仅允许明确标注的模拟编码',
  SUPPLY_REQUIRED: '电芯尚未获得电芯厂供货授权，暂不允许装配到目标模组',
  UNAUTHENTICATED: '客户端身份证书无效或未通过双向认证',
  UNKNOWN_ACTION: '链码不支持该写入动作，请检查客户端与链码版本是否一致',
  UNKNOWN_QUERY: '链码不支持该查询类型，请检查客户端与链码版本是否一致',
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
