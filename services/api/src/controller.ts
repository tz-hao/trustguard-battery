import { Body, Controller, Get, HttpException, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedRequest } from './auth.js';
import type { Asset } from './types.js';
import { FabricService } from './gateway.js';
import { TransactionService } from './transactions.js';
import { RiskService } from './risk.js';
import { projectBattery } from './projection.js';
import { FileService } from './files.js';
import { IngestionService } from './ingestion.js';
import { TraceService } from './trace.js';
import { PolicyService } from './policy.js';
import { X509Certificate } from 'node:crypto';
import { sha256 } from './config.js';
import { readFileSync } from 'node:fs';
import { verifyMesFile } from './mes.js';
import { ScanService } from './scans.js';
import { HealthService } from './health.js';
import { OverviewService } from './overview.js';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
const commandBody = z.object({ requestId: id, data: z.record(z.string(), z.unknown()) }).strict();
const releaseBody = z.object({ requestId: id, id, packId: id }).strict();
const actionMap: Record<string, string> = {
  initialize: 'Initialize', makers: 'RegisterMaker', 'material-lots': 'RegisterMaterialLot', batches: 'RegisterBatch',
  assets: 'RegisterAsset', inspections: 'SubmitInspection', 'assembly-authorizations': 'AuthorizeAssembly', assembly: 'ReplaceAssembly',
  'release-approvals': 'ApproveRelease', 'release-finalizations': 'FinalizeRelease',
  transfers: 'InitiateTransfer', 'transfer-confirmations': 'ConfirmTransfer', 'transfer-cancellations': 'CancelTransfer',
  'transfer-drafts': 'CreateTransfer', 'transfer-dispatches': 'SendTransfer',
  'transfer-acceptances': 'AcceptTransfer', 'transfer-commits': 'CommitTransfer',
  installations: 'RecordInstallation', 'first-use': 'RecordFirstUse', retirements: 'RecordRetirement',
  'recycling-receipts': 'ConfirmRecycling', 'scrap-confirmations': 'RecordScrapConfirmation',
  'echelon-assets': 'RegisterEchelonAsset',
  'lifecycle-corrections':'ProposeLifecycleCorrection','lifecycle-correction-approvals':'ApproveLifecycleCorrection','lifecycle-correction-applications':'ApplyLifecycleCorrection',
  'batch-inspections': 'SubmitBatchInspection', 'retest-proposals':'ProposeRetest', 'retest-completions':'CompleteRetest',
  'policy-candidates': 'ProposePolicy', 'policy-approvals': 'ApprovePolicy', 'policy-activations': 'ActivatePolicy', 'audit-anchors': 'AnchorAudit',
};

@ApiTags('battery-backend')
@Controller('api/v1')
export class BatteryController {
  constructor(
    @Inject(FabricService) private readonly fabric: FabricService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(RiskService) private readonly risk: RiskService,
    @Inject(FileService) private readonly files: FileService,
    @Inject(IngestionService) private readonly ingestion: IngestionService,
    @Inject(TraceService) private readonly trace: TraceService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(ScanService) private readonly scans: ScanService,
    @Inject(HealthService) private readonly healthService:HealthService,
    @Inject(OverviewService) private readonly overview: OverviewService,
  ) {}

  @Post('scans')
  observe(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.scans.record(req.actor,body); }
  @Get('batteries/:code/scans')
  observations(@Req() req: AuthenticatedRequest, @Param('code') code: string) { return this.scans.recent(req.actor,code); }

  @Get('health')
  health() { return { status: 'ok', network: 'local', mode: 'fabric', simulationData: true }; }

  @Get('overview/dashboard')
  overviewDashboard(@Req() req: AuthenticatedRequest) { return this.overview.dashboard(req.actor); }

  @Get('overview/assets')
  overviewAssets(
    @Query('type') type?: string,
    @Query('state') state?: string,
    @Query('quality') quality?: string,
    @Query('q') q?: string,
  ) { return this.overview.assets({ type, state, quality, q }); }

  @Get('overview/batches')
  overviewBatches() { return this.overview.batches(); }

  @Get('overview/inspections')
  overviewInspections() { return this.overview.inspections(); }

  @Get('overview/transfers')
  overviewTransfers() { return this.overview.transfers(); }

  @Get('transfers/:id')
  transfer(@Req() req: AuthenticatedRequest, @Param('id') transferId: string) {
    return this.fabric.query(req.actor.identity, 'transfer', id.parse(transferId));
  }

  @Get('overview/releases')
  overviewReleases(@Req() req: AuthenticatedRequest) { return this.overview.releases(req.actor); }

  @Get('overview/audit')
  overviewAudit(@Req() req: AuthenticatedRequest, @Query('batch') batch?: string) {
    return this.overview.audit(req.actor, z.string().max(96).regex(/^audit-[0-9]+-[0-9]+-[0-9a-f]{12}$/).optional().parse(batch));
  }

  @Post('lab/endorse-probe')
  endorseProbe(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = commandBody.parse(body);
    return this.overview.probeUnauthorizedInspectionEndorsement(req.actor, input.requestId, input.data);
  }

  @Get('codes/:code')
  parse(@Req() req: AuthenticatedRequest, @Param('code') code: string) { return this.fabric.query(req.actor.identity, 'code', code); }

  @Get('makers/:code')
  maker(@Req() req: AuthenticatedRequest,@Param('code') code:string){return this.fabric.query(req.actor.identity,'maker',code);}

  @Get('policies/current')
  policy(@Req() req: AuthenticatedRequest){return this.fabric.query(req.actor.identity,'policy');}

  @Get('batteries/:code')
  async battery(@Req() req: AuthenticatedRequest, @Param('code') code: string) {
    let asset = await this.fabric.query<Asset>(req.actor.identity, 'battery', code);
    let containingPack:{id:string;state:string;firstUseAt:string|null;txId:string}|null=null;
    if(asset.type!=='PACK'){
      const ancestry=await this.fabric.query<{asset:Asset;ancestors:Asset[]}>(req.actor.identity,'ancestry',asset.id);asset=ancestry.asset;
      const parentPack=ancestry.ancestors.find(a=>a.type==='PACK');
      if(parentPack)containingPack={id:parentPack.id,state:parentPack.state,firstUseAt:parentPack.firstUseAt,txId:parentPack.txId};
    }
    const maker = await this.fabric.query<{name: string; simulation: boolean; sourceHash: string}>(req.actor.identity, 'maker', asset.makerCode);
    const componentQuality=asset.type==='PACK'?(await this.fabric.query<{assets:Asset[]}>(req.actor.identity,'snapshot',asset.id)).assets
      .filter(a=>a.quality!=='QC_PASSED').map(a=>({assetId:a.id,quality:a.quality,inspectionVersion:a.inspectionVersion})):[];
    const projected=projectBattery(asset);
    if(containingPack)projected.statusLabel=`已装配（所属电池包：${({IN_USE:'使用中',INSTALLED:'已装车',RETIRED:'已退役',PROCESSED:'已处理',RECEIVED_FOR_RECYCLING:'已交回收企业'} as Record<string,string>)[containingPack.state]??'已装配'}）`;
    return {...projected, makerName: maker.name, makerSource: {simulation: maker.simulation, sourceHash: maker.sourceHash},componentQualityAlerts:componentQuality,containingPack};
  }

  @Get('batteries/:code/lifecycle')
  async lifecycle(@Req() req: AuthenticatedRequest, @Param('code') code: string) {
    const p = await this.battery(req, code);
    return { state: p.state, statusLabel: p.statusLabel, installedAt: p.installedAt, firstUseAt: p.firstUseAt,
      serviceAge: p.serviceAge, retiredAt: p.retiredAt, scrappedAt: p.scrappedAt, scrapped: p.scrapped, evidence: p.evidence, asOf: p.asOf };
  }

  @Get('batteries/:code/health')
  async healthData(@Req() req: AuthenticatedRequest, @Param('code') code: string) {
    return this.healthService.latest(req.actor,code);
  }

  @Get('assets/:id')
  asset(@Req() req: AuthenticatedRequest, @Param('id') assetId: string) { return this.fabric.query(req.actor.identity, 'asset', id.parse(assetId)); }

  @Get('assets/:id/ancestry')
  ancestry(@Req() req: AuthenticatedRequest,@Param('id') assetId:string){return this.fabric.query(req.actor.identity,'ancestry',id.parse(assetId));}

  @Get('assets/:id/inspections')
  inspections(@Req() req: AuthenticatedRequest, @Param('id') assetId: string) { return this.fabric.query(req.actor.identity, 'inspections', id.parse(assetId)); }

  @Get('assets/:id/history')
  history(@Req() req:AuthenticatedRequest,@Param('id') assetId:string){return this.fabric.query(req.actor.identity,'history',id.parse(assetId));}

  @Get('assets/:id/assembly-history')
  edges(@Req() req: AuthenticatedRequest, @Param('id') assetId: string) { return this.fabric.query(req.actor.identity, 'edges', id.parse(assetId)); }

  @Get('assets/:id/snapshot')
  snapshot(@Req() req: AuthenticatedRequest, @Param('id') assetId: string) { return this.fabric.query(req.actor.identity, 'snapshot', id.parse(assetId)); }

  @Get('assets/:id/corrections')
  corrections(@Req() req:AuthenticatedRequest,@Param('id') assetId:string){return this.fabric.query(req.actor.identity,'corrections',id.parse(assetId));}

  @Get('transactions/:requestId')
  transaction(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string) { return this.transactions.status(req.actor, id.parse(requestId)); }

  @Get('trace/batch/:id')
  traceBatch(@Req() req: AuthenticatedRequest,@Param('id') batchId: string){return this.trace.batch(req.actor,id.parse(batchId));}

  @Post('release/requests')
  @ApiOperation({ summary: '由服务端生成风险凭证后提交放行申请' })
  @ApiBody({ schema: { type: 'object', required: ['requestId', 'id', 'packId'], properties: { requestId: { type: 'string' }, id: { type: 'string' }, packId: { type: 'string' } } } })
  async release(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = releaseBody.parse(body);
    if (req.actor.identity.mspId !== 'PackOrgMSP' || req.actor.identity.role !== 'release') throw new HttpException({ code: 'FORBIDDEN' }, 403);
    const replay=await this.transactions.replay(req.actor,{requestId:input.requestId,action:'RequestRelease',data:{id:input.id,packId:input.packId}});
    if(replay)return replay;
    const risk = await this.risk.forRelease(req.actor, input.id, input.packId);
    return this.transactions.execute(req.actor, { requestId: input.requestId, action: 'RequestRelease', data: { id: input.id, packId: input.packId, risk } });
  }

  @Post('commands/:resource')
  @ApiOperation({ summary: '提交受链码身份和状态规则约束的业务命令', description: Object.keys(actionMap).join(', ') })
  @ApiBody({ schema: { type: 'object', required: ['requestId', 'data'], properties: { requestId: { type: 'string' }, data: { type: 'object', additionalProperties: true } } } })
  async command(@Req() req: AuthenticatedRequest, @Param('resource') resource: string, @Body() body: unknown) {
    const action = actionMap[resource];
    if (!action) throw new HttpException({ code: 'UNKNOWN_ACTION' }, 404);
    const input = commandBody.parse(body);
    const command={...input,action};
    const replay=await this.transactions.replay(req.actor,command);
    if(replay)return replay;
    // The two historical HTTP operations still return dispatch and final custody.
    // Each prerequisite has its own recoverable request and ledger receipt.
    if (action === 'InitiateTransfer' || action === 'ConfirmTransfer') {
      const prerequisite = action === 'InitiateTransfer' ? 'CreateTransfer' : 'AcceptTransfer';
      const step = { ...input, action: prerequisite, requestId: 'tr-' + sha256(prerequisite + ':' + input.requestId) };
      const previous = await this.transactions.replay(req.actor, step);
      let needed = true;
      if (!previous && action === 'ConfirmTransfer') {
        const row = await this.fabric.query<{state: string; createdTx?: string}>(req.actor.identity, 'transfer', id.parse(input.data.id));
        needed = !!row.createdTx && row.state === 'SENT';
      }
      if (needed) {
        const result = previous
          ? await this.transactions.status(req.actor, step.requestId)
          : await this.transactions.execute(req.actor, step);
        if (!result.completed) return result;
      }
    }
    if (['SubmitInspection','SubmitBatchInspection','CompleteRetest'].includes(action)) await this.files.verifyInspection(req.actor, input.data);
    if (action === 'ProposePolicy') await this.policies.requirePassed(req.actor,input.data);
    if(['ApprovePolicy','ActivatePolicy'].includes(action)){
      const candidate=await this.fabric.query<{id:string;policy:unknown;testsHash:string}>(req.actor.identity,'candidate',id.parse(input.data.id));
      await this.policies.requirePassed(req.actor,candidate);
    }
    if (action === 'FinalizeRelease') await this.risk.assertAvailable();
    return this.transactions.execute(req.actor, command);
  }

  @Post('reports')
  uploadReport(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.files.upload(req.actor, body); }

  @Get('quality/:subject')
  async qualitySubject(@Req() req: AuthenticatedRequest,@Param('subject') subject:string) {
    const batch=subject.startsWith('batch:');
    const target=id.parse(batch ? subject.slice(6) : subject);
    const [state, reports, proposal, retests]=await Promise.all([
      this.fabric.query(req.actor.identity,batch?'batchStatus':'asset',target),
      this.fabric.query(req.actor.identity,batch?'batchInspections':'inspections',target),
      this.fabric.query(req.actor.identity,'retest',subject),
      this.fabric.query(req.actor.identity,'retests',subject)
    ]);
    return {state,reports,proposal,retests};
  }

  @Post('imports/mes')
  importMES(@Req() req:AuthenticatedRequest,@Body() body:unknown) {
    const signer = new X509Certificate(readFileSync(req.actor.identity.certificateFile));
    const input = verifyMesFile(body,signer.publicKey);
    return this.transactions.execute(req.actor,{requestId:input.requestId,action:'ImportMES',data:input.data});
  }

  @Post('imports/measurements')
  importMeasurements(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.ingestion.csv(req.actor,body); }

  @Post('imports/health')
  importHealth(@Req() req:AuthenticatedRequest,@Body() body:unknown){return this.healthService.ingest(req.actor,body);}

  @Post('policies/previews')
  previewPolicy(@Req() req: AuthenticatedRequest,@Body() body:unknown){return this.policies.preview(req.actor,body);}

  @Get('reports/:id/content')
  async reportContent(@Req() req: AuthenticatedRequest, @Param('id') reportId: string, @Res() response: Response) {
    const bytes = await this.files.download(req.actor, id.parse(reportId));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(bytes);
  }

  @Post('reports/:id/revocations')
  revokeReport(@Req() req: AuthenticatedRequest, @Param('id') reportId: string, @Body() body: unknown) {
    const input = z.object({ requestId:id,granteeMSP: z.enum(['CellOrgMSP','PackOrgMSP','LabOrgMSP','RecycleOrgMSP']) }).strict().parse(body);
    return this.files.revoke(req.actor, id.parse(reportId), input.granteeMSP,input.requestId);
  }
}
