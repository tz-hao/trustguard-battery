import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { common, peer, ledger } from '@hyperledger/fabric-protos';
import { Database } from './database.js';
import { FabricService } from './gateway.js';
import type { ClientIdentity, Asset } from './types.js';

export interface IndexedWrite { key: string; body: unknown; txId: string; deleted: boolean }
export interface IndexedEvent { txId: string; index: number; payload: unknown }
export function parseBlock(block: common.Block, chaincode: string): { number: bigint; writes: IndexedWrite[]; events: IndexedEvent[] } {
  const header = block.getHeader();
  if (!header || !Number.isSafeInteger(header.getNumber())) throw new Error('INVALID_BLOCK_NUMBER');
  const number = BigInt(header.getNumber());
  const envelopes = block.getData()?.getDataList_asU8() ?? [];
  const hash = createHash('sha256').update(Buffer.concat(envelopes)).digest();
  if (!hash.equals(Buffer.from(header.getDataHash_asU8()))) throw new Error('INVALID_BLOCK_DATA_HASH');
  const flags = block.getMetadata()?.getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER];
  const writes: IndexedWrite[] = [], events: IndexedEvent[] = [];
  for (let txIndex = 0; txIndex < envelopes.length; txIndex++) {
    if (flags?.[txIndex] !== 0) continue;
    const envelope = common.Envelope.deserializeBinary(envelopes[txIndex]);
    const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
    const channel = common.ChannelHeader.deserializeBinary(payload.getHeader()!.getChannelHeader_asU8());
    if (channel.getType() !== common.HeaderType.ENDORSER_TRANSACTION) continue;
    const transaction = peer.Transaction.deserializeBinary(payload.getData_asU8());
    for (const [index, action] of transaction.getActionsList().entries()) {
      const endorsed = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8()).getAction();
      if (!endorsed) continue;
      const response = peer.ProposalResponsePayload.deserializeBinary(endorsed.getProposalResponsePayload_asU8());
      const chaincodeAction = peer.ChaincodeAction.deserializeBinary(response.getExtension_asU8());
      const txRwSet = ledger.rwset.TxReadWriteSet.deserializeBinary(chaincodeAction.getResults_asU8());
      for (const namespace of txRwSet.getNsRwsetList()) {
        if (namespace.getNamespace() !== chaincode) continue;
        const kv = ledger.rwset.kvrwset.KVRWSet.deserializeBinary(namespace.getRwset_asU8());
        for (const write of kv.getWritesList()) {
          // Request receipts are actor-scoped and not needed for public query indexes.
          if (write.getKey().startsWith('request:')) continue;
          writes.push({ key: write.getKey(), body: write.getIsDelete() ? null : JSON.parse(Buffer.from(write.getValue_asU8()).toString()), txId: channel.getTxId(), deleted: write.getIsDelete() });
        }
      }
      const rawEvent = chaincodeAction.getEvents_asU8();
      if (rawEvent.length) {
        const event = peer.ChaincodeEvent.deserializeBinary(rawEvent);
        if (event.getChaincodeId() === chaincode && event.getEventName() === 'BatteryEvent') events.push({ txId: channel.getTxId(), index, payload: JSON.parse(Buffer.from(event.getPayload_asU8()).toString()) });
      }
    }
  }
  return { number, writes, events };
}

export class Indexer {
  private stopped = false;
  private stream?: { close(): void };
  constructor(private readonly db: Database, private readonly fabric: FabricService, private readonly identity: ClientIdentity,
    private readonly channel: string, private readonly chaincode: string) {}
  stop() { this.stopped = true; this.stream?.close(); }
  async apply(block: common.Block) {
    const parsed = parseBlock(block, this.chaincode);
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['index:' + this.channel]);
      const cursor = await client.query<{next_block: string}>('SELECT next_block FROM index_cursors WHERE channel=$1 FOR UPDATE', [this.channel]);
      const next = BigInt(cursor.rows[0]?.next_block ?? '0');
      if (parsed.number < next) { await client.query('ROLLBACK'); return; }
      if (parsed.number !== next) throw new Error('INDEX_BLOCK_GAP');
      for (const write of parsed.writes) {
        if (write.deleted) throw new Error('UNEXPECTED_LEDGER_DELETION');
        await client.query(`INSERT INTO state_index(state_key,body,block_number,tx_id) VALUES($1,$2::jsonb,$3,$4)
          ON CONFLICT(state_key) DO UPDATE SET body=excluded.body,block_number=excluded.block_number,tx_id=excluded.tx_id`, [write.key,JSON.stringify(write.body),parsed.number.toString(),write.txId]);
        if (write.key.startsWith('asset:')) {
          const asset = write.body as Asset;
          await client.query(`INSERT INTO asset_index(id,code,body,block_number,tx_id) VALUES($1,$2,$3::jsonb,$4,$5)
            ON CONFLICT(id) DO UPDATE SET body=excluded.body,block_number=excluded.block_number,tx_id=excluded.tx_id,updated_at=now()`, [asset.id,asset.code,JSON.stringify(asset),parsed.number.toString(),write.txId]);
        }
      }
      for (const event of parsed.events) await client.query(`INSERT INTO ledger_events(channel,tx_id,event_index,block_number,payload)
        VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`, [this.channel,event.txId,event.index,parsed.number.toString(),JSON.stringify(event.payload)]);
      await client.query(`INSERT INTO index_cursors(channel,next_block) VALUES($1,$2)
        ON CONFLICT(channel) DO UPDATE SET next_block=excluded.next_block,updated_at=now()`, [this.channel,(parsed.number+1n).toString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async run(until?: bigint) {
    while (!this.stopped) {
      const { rows } = await this.db.pool.query<{next_block: string}>('SELECT next_block FROM index_cursors WHERE channel=$1', [this.channel]);
      const next = BigInt(rows[0]?.next_block ?? '0');
      if (until !== undefined && next > until) return;
      try {
        const stream = await this.fabric.blocks(this.identity, next);
        this.stream = stream;
        try { for await (const block of stream) {
          if (this.stopped) break;
          await this.apply(block);
          if (until !== undefined && BigInt(block.getHeader()!.getNumber()) >= until) return;
        } } finally { stream.close(); }
      } catch { if (!this.stopped) await delay(1000); }
    }
  }
}
