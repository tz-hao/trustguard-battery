export const organizations = ['CellOrgMSP', 'PackOrgMSP', 'LabOrgMSP', 'RecycleOrgMSP'] as const;
export type Organization = typeof organizations[number];
export type Role = 'admin' | 'manufacturer' | 'inspector' | 'assembler' | 'approver' | 'release' | 'custodian' | 'operator' | 'recycler' | 'auditor' | 'viewer';
export interface ClientIdentity {
  name: string;
  mspId: Organization | 'AuditOrgMSP';
  role: Role;
  clientFingerprint: string;
  certificateFile: string;
  privateKeyFile: string;
  gatewayEndpoint: string;
  gatewayServerName: string;
  gatewayTlsRootFile: string;
}
export type BusinessIdentity = ClientIdentity & { mspId: Organization };
export interface LedgerActor {
  identity: ClientIdentity;
  actorHash: string;
}
export interface AuthenticatedActor extends LedgerActor { identity: BusinessIdentity }
export interface Command { requestId: string; action: string; data: Record<string, unknown> }
export interface LedgerResult { requestId: string; txId: string; action: string; resourceId: string; version: number }
export type TransactionStage = 'built' | 'endorsed' | 'submitted' | 'committed' | 'ledger-verified' | 'rejected' | 'invalid' | 'unknown';
export interface Asset {
  id: string; code: string; type: 'CELL' | 'MODULE' | 'PACK'; makerCode: string;
  makerMSP: Organization; chemistry: string; batchId?: string; model: string;
  holderMSP: Organization; simulation: boolean; manufacturedAt: string;
  designLifeMonths: number | null; state: string; quality: string;
  version: number; assemblyVersion: number; parentId?: string; children: string[];
  inspectionVersion: number; installedAt: string | null; firstUseAt: string | null;
  retiredAt: string | null; recyclingReceivedAt: string | null; scrappedAt: string | null;
  updatedAt: string; txId: string;
}
