import { readFile } from 'node:fs/promises';
import { createPrivateKey, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers, type Gateway, type Network } from '@hyperledger/fabric-gateway';
import { common, peer, msp } from '@hyperledger/fabric-protos';
import type { Asset, ClientIdentity, Command, LedgerResult } from './types.js';
import type { FabricConfiguration } from './config.js';

interface Connection { gateway: Gateway; network: Network; client: grpc.Client }
export class InvalidLedgerTransaction extends Error {
  constructor(readonly blockNumber:string,readonly validationCode:number){super('INVALID_LEDGER_TRANSACTION');}
}
export class FabricService {
  private connections = new Map<string, Promise<Connection>>();
  constructor(private readonly config: FabricConfiguration) {}
  private connection(identity: ClientIdentity, target = identity): Promise<Connection> {
    const key = `${identity.name}@${target.gatewayEndpoint}`;
    const existing = this.connections.get(key);
    if (existing) return existing;
    const pending = this.open(identity, target).catch(error => { this.connections.delete(key); throw error; });
    this.connections.set(key, pending);
    return pending;
  }
  private async open(identity: ClientIdentity, target: ClientIdentity): Promise<Connection> {
    const credentials = await readFile(identity.certificateFile);
    const privateKey = createPrivateKey(await readFile(identity.privateKeyFile));
    const client = new grpc.Client(target.gatewayEndpoint, grpc.credentials.createSsl(await readFile(target.gatewayTlsRootFile)), {
      'grpc.ssl_target_name_override': target.gatewayServerName,
    });
    const gateway = connect({ client, identity: { mspId: identity.mspId, credentials }, signer: signers.newPrivateKeySigner(privateKey), hash: hash.sha256,
      evaluateOptions: () => ({ deadline: Date.now() + 15000 }),
      endorseOptions: () => ({ deadline: Date.now() + 30000 }),
      submitOptions: () => ({ deadline: Date.now() + 15000 }),
      commitStatusOptions: () => ({ deadline: Date.now() + 30000 }),
    });
    return { client, gateway, network: gateway.getNetwork(this.config.channel) };
  }
  async query<T>(identity: ClientIdentity, kind: string, id = ''): Promise<T> {
    const { network } = await this.connection(identity);
    return JSON.parse(Buffer.from(await network.getContract(this.config.chaincode).evaluateTransaction('Query', JSON.stringify({ kind, id }))).toString());
  }
  async proposal(identity: ClientIdentity, command: Command) {
    const { network } = await this.connection(identity);
    return network.getContract(this.config.chaincode).newProposal('Execute', {
      arguments: [JSON.stringify(command)], endorsingOrganizations: [...new Set(this.config.identities.map(i => i.mspId))],
    });
  }
  async blocks(identity: ClientIdentity, startBlock: bigint) {
    const { network } = await this.connection(identity);
    return network.getBlockEvents({ startBlock });
  }
  async height(identity: ClientIdentity): Promise<bigint> {
    const {network}=await this.connection(identity);
    const info=common.BlockchainInfo.deserializeBinary(await network.getContract('qscc').evaluateTransaction('GetChainInfo',this.config.channel));
    if(!Number.isSafeInteger(info.getHeight()))throw new Error('UNSAFE_LEDGER_HEIGHT');
    return BigInt(info.getHeight());
  }
  async block(identity:ClientIdentity,number:bigint):Promise<common.Block>{
    const {network}=await this.connection(identity);
    return common.Block.deserializeBinary(await network.getContract('qscc').evaluateTransaction('GetBlockByNumber',this.config.channel,number.toString()));
  }
  async definition(identity:ClientIdentity){
    const {network}=await this.connection(identity);
    const request=new peer.lifecycle.QueryChaincodeDefinitionArgs();request.setName(this.config.chaincode);
    const bytes=await network.getContract('_lifecycle').evaluateTransaction('QueryChaincodeDefinition',request.serializeBinary());
    const definition=peer.lifecycle.QueryChaincodeDefinitionResult.deserializeBinary(bytes);
    if(!Number.isSafeInteger(definition.getSequence()))throw new Error('UNSAFE_DEFINITION_SEQUENCE');
    return {name:this.config.chaincode,version:definition.getVersion(),sequence:BigInt(definition.getSequence()).toString()};
  }
  async verifyCommitted(identity: ClientIdentity, txId: string, requestId: string): Promise<{ result: LedgerResult; blockNumber: string }> {
    const peers = [...new Map(this.config.identities.map(i => [i.mspId, i])).values()];
    let referenceHash: string | undefined;
    let result: LedgerResult | undefined;
    let blockNumber = '';
    for (const target of peers) {
      const { network } = await this.connection(identity, target);
      let bytes: Uint8Array | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        try { bytes = await network.getContract('qscc').evaluateTransaction('GetBlockByTxID', this.config.channel, txId); break; }
        catch (error) { if (attempt === 11) throw error; await delay(250); }
      }
      if (!bytes) throw new Error('BLOCK_UNAVAILABLE');
      const block = common.Block.deserializeBinary(bytes);
      const header = block.getHeader();
      if (!header || !Number.isSafeInteger(header.getNumber())) throw new Error('INVALID_BLOCK_NUMBER');
      blockNumber = BigInt(header.getNumber()).toString();
      const envelopes = block.getData()?.getDataList_asU8() ?? [];
      const dataHash = createHash('sha256').update(Buffer.concat(envelopes)).digest('hex');
      if (dataHash !== Buffer.from(header.getDataHash_asU8()).toString('hex') || referenceHash && referenceHash !== dataHash) throw new Error('BLOCK_HASH_MISMATCH');
      referenceHash = dataHash;
      const flags = block.getMetadata()?.getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER];
      let found = false;
      for (let index = 0; index < envelopes.length; index++) {
        const envelope = common.Envelope.deserializeBinary(envelopes[index]);
        const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
        const channelHeader = common.ChannelHeader.deserializeBinary(payload.getHeader()!.getChannelHeader_asU8());
        if (channelHeader.getTxId() !== txId) continue;
        if(channelHeader.getChannelId()!==this.config.channel||!flags||index>=flags.length)throw new Error('BLOCK_METADATA_UNAVAILABLE');
        if(flags[index]!==0)throw new InvalidLedgerTransaction(blockNumber,flags[index]);
        const transaction = peer.Transaction.deserializeBinary(payload.getData_asU8());
        const endorsers = new Set<string>();
        for (const action of transaction.getActionsList()) {
          const endorsed = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8()).getAction();
          for (const endorsement of endorsed?.getEndorsementsList() ?? []) endorsers.add(msp.SerializedIdentity.deserializeBinary(endorsement.getEndorser_asU8()).getMspid());
        }
        if (peers.some(p => !endorsers.has(p.mspId))) throw new Error('MISSING_ORGANIZATION_ENDORSEMENT');
        found = true;
      }
      if (!found) throw new Error('TRANSACTION_NOT_IN_BLOCK');
      const receipt = JSON.parse(Buffer.from(await network.getContract(this.config.chaincode).evaluateTransaction('Query', JSON.stringify({ kind: 'request', id: requestId }))).toString()) as { result: LedgerResult };
      if (receipt.result.txId !== txId || receipt.result.requestId !== requestId) throw new Error('RECEIPT_MISMATCH');
      const assetActions = ['RegisterAsset', 'SubmitInspection', 'ReplaceAssembly', 'FinalizeRelease', 'ConfirmTransfer',
        'RecordInstallation', 'RecordFirstUse', 'RecordRetirement', 'ConfirmRecycling', 'RecordScrapConfirmation','ApplyLifecycleCorrection'];
      const {action,resourceId,version} = receipt.result;
      const batchReport = resourceId.startsWith('batch:') && ['SubmitBatchInspection','CompleteRetest'].includes(action);
      const queryState = async (kind: string, id: string) => JSON.parse(Buffer.from(await network.getContract(this.config.chaincode)
        .evaluateTransaction('Query',JSON.stringify({kind,id}))).toString());
      const transferSteps: Record<string, string> = {
        CreateTransfer: 'createdTx', SendTransfer: 'sentTx', AcceptTransfer: 'acceptedTx', CommitTransfer: 'committedTx',
      };
      if (transferSteps[action] || action === 'CancelTransfer' || action === 'InitiateTransfer') {
        const transfer = await queryState('transfer',resourceId);
        const field = transferSteps[action] ?? (action === 'CancelTransfer' ? 'cancelledTx' : 'sentTx');
        // Historical v1.4 dispatch/cancellation receipts predate the per-step IDs.
        if ((transferSteps[action] || transfer[field] || transfer.createdTx) && transfer[field] !== txId)
          throw new Error('TRANSFER_STATE_MISMATCH');
        if (action === 'CommitTransfer') {
          const pack = await queryState('asset',transfer.packId) as Asset;
          if (transfer.state !== 'COMMITTED' || pack.version < version ||
            (pack.version === version && (pack.holderMSP !== transfer.toMSP || pack.txId !== txId)))
            throw new Error('TRANSFER_CUSTODY_MISMATCH');
        }
      }
      if (action === 'AnchorAudit' && identity.mspId === 'AuditOrgMSP') {
        const anchor = await queryState('auditAnchor', resourceId);
        if (anchor.id !== resourceId || anchor.actorMSP !== identity.mspId || anchor.txId !== txId ||
            !anchor.count || !/^[0-9a-f]{64}$/.test(anchor.digest)) throw new Error('AUDIT_ANCHOR_MISMATCH');
      }
      if (action === 'ImportMES') {
        const proof = await queryState('mesReceipt',txId);
        if (proof.txId!==txId || proof.requestId!==requestId || proof.count!==version || proof.organization!==identity.mspId)
          throw new Error('MES_RECEIPT_MISMATCH');
      }
      if (batchReport) {
        const reports = await queryState('batchInspections',resourceId.slice(6)) as {txId:string;version:number}[];
        if (!reports.some(row=>row.txId===txId && row.version===version)) throw new Error('BATCH_REPORT_MISMATCH');
      }
      if (action==='ProposeRetest' || action==='CompleteRetest') {
        const reviews = await queryState('retests',resourceId) as {proposedTx:string;completedTx?:string}[];
        const field = action==='ProposeRetest' ? 'proposedTx' : 'completedTx';
        if (!reviews.some(row=>row[field]===txId)) throw new Error('RETEST_STATE_MISMATCH');
      }
      if (assetActions.includes(action) || (action==='CompleteRetest' && !batchReport)) {
        const asset = JSON.parse(Buffer.from(await network.getContract(this.config.chaincode).evaluateTransaction('Query', JSON.stringify({kind: 'asset', id: receipt.result.resourceId}))).toString()) as Asset;
        if (asset.version < receipt.result.version || asset.version === receipt.result.version && asset.txId !== txId) throw new Error('ASSET_STATE_MISMATCH');
      }
      if (result && JSON.stringify(result) !== JSON.stringify(receipt.result)) throw new Error('PEER_STATE_MISMATCH');
      result = receipt.result;
    }
    if (!result) throw new Error('NO_PEERS');
    return { result, blockNumber };
  }
  async close() {
    for (const connection of this.connections.values()) {
      try { const { gateway, client } = await connection; gateway.close(); client.close(); } catch { /* failed opens have no active connection */ }
    }
    this.connections.clear();
  }
}
