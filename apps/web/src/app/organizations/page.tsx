'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  CheckCircle2,
  LogIn,
  RefreshCw,
  Shield,
  Users,
} from 'lucide-react';
import { useIdentity } from '@/components/IdentityProvider';
import { OrgBadge, PageBanner, SectionHeader, StagePill } from '@/components/Badges';
import { ConsortiumTopologySvg, PaginationBar } from '@/components/Visuals';
import { CORE_IDENTITY_NAMES } from '@/lib/permissions';
import { ROLE_LABELS, formatDateTime, type OrganizationMSP } from '@/lib/types';

interface DashboardOrg {
  mspId: string;
  label: string;
  gatewayEndpoint: string;
  roles: { name: string; role: string }[];
}

interface OrgDashboardData {
  summary: {
    ledgerHeight: string;
    activePolicyVersion: number;
    chaincode: { name: string; version: string; sequence: string };
    auditLogsTotal: number;
    rejectedTxCount: number;
  };
  organizations: DashboardOrg[];
}

interface RecentAuditTx {
  requestId: string;
  action: string;
  resourceId: string | null;
  stage: string;
  blockNumber: string | null;
  updatedAt: string;
}

const ORG_DUTIES: Record<OrganizationMSP, { scope: string; caPort: string; keyProtect: string }> = {
  CellOrgMSP: {
    scope: '电芯单体研发生产、GB/T 34014 24位编码首次建档与电芯批量出厂检定',
    caPort: 'Fabric CA · Peer :17051',
    keyProtect: '独立组织 CA 签发 X.509 ECDSA 证书，含 OU=manufacturer/inspector/viewer',
  },
  PackOrgMSP: {
    scope: '模组串并联装配、PACK 总成集成、放行申请与装车投用/退役生命周期管理',
    caPort: 'Fabric CA · Peer :19051',
    keyProtect: '支持 assembler / release / custodian / operator 多角色职责分离',
  },
  LabOrgMSP: {
    scope: '独立第三方复核质检、AEAD 加密报告签发、AI 风险凭证担保与全网合规审计',
    caPort: 'Fabric CA · Peer :21051',
    keyProtect: '拥有独立审批权、auditor 账本审计权及密钥服务加密报告授权校验',
  },
  RecycleOrgMSP: {
    scope: '退役动力电池接收确认、拆解核销终态锁定（PROCESSED 不可逆）与回收合规存证',
    caPort: 'Fabric CA · Peer :23051',
    keyProtect: '严格限定 recycler/custodian 凭证执行退役流转，防越权报废',
  },
};

const ROLE_MATRIX: {
  role: string;
  scope: string;
  chaincodeAccess: string;
  offchainAccess: string;
  demoIdentity: string;
}[] = [
  {
    role: 'manufacturer',
    scope: '生产制造员',
    chaincodeAccess: '电芯/批次建档，制造记录上链（禁止越权签发第三方放行与报废）',
    offchainAccess: '提交制造数据源哈希与批量导入',
    demoIdentity: 'cell-manufacturer',
  },
  {
    role: 'inspector',
    scope: '质检签发员',
    chaincodeAccess: '提交版本化质检结论与报告哈希，不可伪造他人报告正文',
    offchainAccess: '加密上传检测报告至 MinIO（含健康度明细鉴权）',
    demoIdentity: 'lab-inspector',
  },
  {
    role: 'assembler',
    scope: '模组/PACK 装配员',
    chaincodeAccess: '构建 CELL -> MODULE -> PACK 装配关系（受质量门禁约束）',
    offchainAccess: '关联谱系装配BOM并触发链码前校验',
    demoIdentity: 'pack-assembler',
  },
  {
    role: 'release',
    scope: '放行申请员',
    chaincodeAccess: '为 PACK 发起联合放行审批单，绑定最新 AI 风控凭证',
    offchainAccess: '触发 FastAPI AI 风险分析与证据签名',
    demoIdentity: 'pack-release',
  },
  {
    role: 'approver',
    scope: '联合审批员',
    chaincodeAccess: '对放行单执行多组织背书会签，禁止跨组织代签',
    offchainAccess: '查阅审批矩阵与待放行证据快照',
    demoIdentity: 'lab-approver',
  },
  {
    role: 'custodian',
    scope: '资产交接保管员',
    chaincodeAccess: '转出方创建并发出交接单，接收方签收凭证并提交持有权变更',
    offchainAccess: '查询当前持有人流转历史',
    demoIdentity: 'pack-custodian',
  },
  {
    role: 'operator',
    scope: '运维/装车登记员',
    chaincodeAccess: '登记装车、首次投用时间及退役事件（自动驱动服役年限计算）',
    offchainAccess: '读取维保时间轴与服役生命周期',
    demoIdentity: 'pack-operator',
  },
  {
    role: 'recycler',
    scope: '退役回收确认员',
    chaincodeAccess: '执行收货与最终报废 PROCESSED 终态核销',
    offchainAccess: '记录回收拆解凭证与销毁事件',
    demoIdentity: 'recycle-recycler',
  },
  {
    role: 'admin',
    scope: '组织管理员',
    chaincodeAccess: '发布并激活风控与审批安全策略版本（需隔离预演通过且符合底线）',
    offchainAccess: '撤销报告访问授权（通知 key-broker 拒解）',
    demoIdentity: 'cell-admin',
  },
  {
    role: 'auditor',
    scope: '组织审计员',
    chaincodeAccess: '查询操作证据，按批次核对日志摘要和锚定交易',
    offchainAccess: '对账交易台账、Ed25519 日志与批次摘要',
    demoIdentity: 'lab-auditor',
  },
  {
    role: 'viewer',
    scope: '只读观察员',
    chaincodeAccess: '公开资产档案与图谱查询，禁止写入且健康度高敏字段脱敏',
    offchainAccess: '只读查看看板、谱系图与交易状态',
    demoIdentity: 'cell-viewer',
  },
];

export default function OrganizationsPage() {
  const { actor, identities, switching, switchActor } = useIdentity();
  const [dash, setDash] = useState<OrgDashboardData | null>(null);
  const [recentTx, setRecentTx] = useState<RecentAuditTx[]>([]);
  const [mspFilter, setMspFilter] = useState<'ALL' | OrganizationMSP>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [coreOnly, setCoreOnly] = useState<boolean>(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [dRes, aRes] = await Promise.all([
        fetch('/api/bff/dashboard', { cache: 'no-store' }),
        fetch('/api/bff/audit', { cache: 'no-store' }),
      ]);
      if (dRes.ok) {
        const dJson = (await dRes.json()) as OrgDashboardData;
        setDash(dJson);
      }
      if (aRes.ok) {
        const aJson = (await aRes.json()) as { transactions?: RecentAuditTx[] };
        setRecentTx((aJson.transactions ?? []).slice(0, 6));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredIdentities = identities.filter(id => {
    if (coreOnly && !CORE_IDENTITY_NAMES.has(id.name)) return false;
    if (mspFilter !== 'ALL' && id.mspId !== mspFilter) return false;
    if (roleFilter !== 'ALL' && id.role !== roleFilter) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredIdentities.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedIdentities = filteredIdentities.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-5">
      <PageBanner
        title="四组织联盟架构与 28 身份 mTLS 权限治理中心"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <LogIn className="h-3.5 w-3.5" />
              切换登录角色
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-600 bg-[#17324f] px-3 py-2 text-xs font-medium text-white hover:bg-[#1e3e61]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新组织拓扑
            </button>
          </div>
        }
      />

      {/* 4 Consortium Organizations + Topology SVG */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
          {(dash?.organizations ?? []).map(org => {
            const duty = ORG_DUTIES[org.mspId as OrganizationMSP];
            const sceneImg =
              org.mspId === 'CellOrgMSP'
                ? '/visuals/org-cell.jpg'
                : org.mspId === 'PackOrgMSP'
                  ? '/visuals/org-pack.jpg'
                  : org.mspId === 'LabOrgMSP'
                    ? '/visuals/org-lab.jpg'
                    : '/visuals/org-recycle.jpg';
            return (
              <div key={org.mspId} className="card-surface card-interactive flex flex-col justify-between overflow-hidden">
                <div className="relative h-28 w-full overflow-hidden bg-[#060f1d]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sceneImg}
                    alt={org.label}
                    className="h-full w-full object-cover object-center transition duration-500 hover:scale-105 select-none"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060f1d]/85 via-transparent to-transparent" />
                  <div className="absolute right-2.5 bottom-2 left-2.5 flex items-center justify-between gap-2">
                    <OrgBadge mspId={org.mspId} dark />
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-[#061120]/85 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur-sm">
                      <CheckCircle2 className="h-3 w-3" />
                      在线背书
                    </span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#172B3A]">{org.label}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{duty?.scope ?? '联盟成员节点'}</p>
                  </div>

                  <div className="mt-3.5 space-y-1.5 border-t border-[#edf2f7] pt-3 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">Gateway Peer</span>
                      <span className="mono font-medium text-[#172B3A]">{org.gatewayEndpoint}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748B]">证书角色数</span>
                      <span className="mono font-bold text-[#2563EB]">{org.roles.length} 类身份</span>
                    </div>
                    <div className="text-[10px] text-[#94A3B8]">{duty?.keyProtect}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card-surface flex flex-col justify-between p-4 lg:col-span-5">
          <div>
            <SectionHeader
              title="联盟共识通道与 Peer 节点拓扑"
              subtitle={`通道 batterybusiness · ${dash?.summary.chaincode ? `链码 ${dash.summary.chaincode.name} v${dash.summary.chaincode.version} (seq ${dash.summary.chaincode.sequence})` : '链码版本待核验'}`}
              icon={<Building2 className="h-4 w-4 text-[#0F9D8A]" />}
            />
            <ConsortiumTopologySvg
              organizations={dash?.organizations ?? []}
              ledgerHeight={dash?.summary.ledgerHeight ?? '—'}
              dark={false}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-[#dce4ee] bg-[#F4F7FA] p-3 text-center text-xs">
            <div>
              <div className="text-[10px] text-[#64748B]">白名单证书总数</div>
              <div className="mono mt-0.5 font-bold text-[#172B3A]">{identities.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#64748B]">生效策略版本</div>
              <div className="mono mt-0.5 font-bold text-[#2563EB]">v{dash?.summary.activePolicyVersion ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#64748B]">拒绝越权笔数</div>
              <div className="mono mt-0.5 font-bold text-[#DC5353]">{dash?.summary.rejectedTxCount ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 11 Role RBAC Matrix */}
      <div className="card-surface p-5">
        <SectionHeader
          title="业务岗位职责矩阵"
          icon={<Shield className="h-4 w-4 text-[#2563EB]" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#dce4ee] bg-[#F4F7FA] text-[11px] text-[#64748B]">
                <th className="px-3 py-2.5 font-semibold">角色标识</th>
                <th className="px-3 py-2.5 font-semibold">业务职务</th>
                <th className="px-3 py-2.5 font-semibold">链码核心约束与写入权限</th>
                <th className="px-3 py-2.5 font-semibold">链下/网关关联权限</th>
                <th className="px-3 py-2.5 text-right font-semibold">快速体验角色</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf2f7]">
              {ROLE_MATRIX.map(r => {
                const isCurrentRole = actor?.role === r.role;
                return (
                  <tr key={r.role} className={isCurrentRole ? 'bg-[#2563EB]/5' : 'hover:bg-[#F4F7FA]'}>
                    <td className="mono px-3 py-2.5 font-bold text-[#10243A]">{r.role}</td>
                    <td className="px-3 py-2.5 font-semibold text-[#172B3A]">{r.scope}</td>
                    <td className="px-3 py-2.5 text-[#172B3A]">{r.chaincodeAccess}</td>
                    <td className="px-3 py-2.5 text-[#64748B]">{r.offchainAccess}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        disabled={switching || actor?.name === r.demoIdentity}
                        onClick={() => void switchActor(r.demoIdentity)}
                        className="rounded-md border border-[#dce4ee] bg-white px-2.5 py-1 text-[11px] font-medium text-[#2563EB] hover:border-[#2563EB] disabled:opacity-45"
                      >
                        {actor?.name === r.demoIdentity ? '当前使用中' : `切换 ${r.demoIdentity}`}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 28 Server-Whitelisted Identities Table + Recent Actions */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="card-surface p-5 lg:col-span-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              title="服务端 28 组白名单身份清单（14 核心实战岗位优先展示）"
              subtitle="可按核心岗位/全量证书、组织 MSP 与角色筛选并即时切换平台当前操作者身份"
              icon={<Users className="h-4 w-4 text-[#0F9D8A]" />}
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-subtle p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setCoreOnly(true);
                    setPage(1);
                  }}
                  className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
                    coreOnly ? 'bg-white text-navy-900 shadow-2xs' : 'text-ink-secondary'
                  }`}
                >
                  核心岗位 (14)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCoreOnly(false);
                    setPage(1);
                  }}
                  className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
                    !coreOnly ? 'bg-white text-navy-900 shadow-2xs' : 'text-ink-secondary'
                  }`}
                >
                  全部证书 ({identities.length})
                </button>
              </div>
              <select
                value={mspFilter}
                onChange={e => {
                  setMspFilter(e.target.value as typeof mspFilter);
                  setPage(1);
                }}
                aria-label="按组织筛选身份"
                className="rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 text-xs text-[#172B3A] outline-none"
              >
                <option value="ALL">全部四组织</option>
                <option value="CellOrgMSP">CellOrgMSP</option>
                <option value="PackOrgMSP">PackOrgMSP</option>
                <option value="LabOrgMSP">LabOrgMSP</option>
                <option value="RecycleOrgMSP">RecycleOrgMSP</option>
              </select>
              <select
                value={roleFilter}
                onChange={e => {
                  setRoleFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="按角色筛选身份"
                className="rounded-lg border border-[#dce4ee] bg-[#F4F7FA] px-2.5 py-1.5 text-xs text-[#172B3A] outline-none"
              >
                <option value="ALL">全部角色 ({Object.keys(ROLE_LABELS).length})</option>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v} ({k})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#dce4ee] bg-[#F4F7FA] text-[11px] text-[#64748B]">
                  <th className="px-3 py-2 font-semibold">白名单身份 ID</th>
                  <th className="px-3 py-2 font-semibold">所属组织</th>
                  <th className="px-3 py-2 font-semibold">角色类型</th>
                  <th className="px-3 py-2 font-semibold">mTLS 证书指纹前缀</th>
                  <th className="px-3 py-2 text-right font-semibold">会话切换</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2f7]">
                {pagedIdentities.map(id => {
                  const active = actor?.name === id.name;
                  return (
                    <tr key={id.name} className={active ? 'bg-[#0F9D8A]/8' : 'hover:bg-[#F4F7FA]'}>
                      <td className="mono px-3 py-2 font-bold text-[#172B3A]">{id.name}</td>
                      <td className="px-3 py-2">
                        <OrgBadge mspId={id.mspId} />
                      </td>
                      <td className="px-3 py-2 text-[#172B3A]">
                        {id.roleLabel} <span className="mono text-[10px] text-[#64748B]">({id.role})</span>
                      </td>
                      <td className="mono px-3 py-2 text-[#64748B]">{id.fingerprintPrefix}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          disabled={active || switching}
                          onClick={() => void switchActor(id.name)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                            active
                              ? 'bg-[#159B76]/15 text-[#159B76]'
                              : 'bg-[#10243A] text-white hover:bg-[#17324f] disabled:opacity-45'
                          }`}
                        >
                          {active ? '已激活' : '切换至此证书'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar page={safePage} totalPages={totalPages} totalItems={filteredIdentities.length} onPageChange={setPage} />
        </div>

        {/* Right: Recent Requests */}
        <div className="space-y-4 lg:col-span-4">
          <div className="card-surface p-4">
            <SectionHeader title="近期调用记录" />
            <div className="space-y-2">
              {recentTx.map(tx => (
                <div key={tx.requestId} className="rounded-lg border border-[#dce4ee] bg-[#F4F7FA] p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#172B3A]">{tx.action}</span>
                    <StagePill stage={tx.stage} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[#64748B]">
                    <span className="mono">{tx.resourceId ?? '策略/系统'}</span>
                    <span>{formatDateTime(tx.updatedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
