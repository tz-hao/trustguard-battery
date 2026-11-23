import { HttpException } from '@nestjs/common';
import { Database } from './database.js';
import { FabricService, InvalidLedgerTransaction } from './gateway.js';
import { canonicalJson, sha256 } from './config.js';
import type { LedgerActor, Command, LedgerResult, TransactionStage } from './types.js';

interface RequestRow {
  payload_hash: string; stage: TransactionStage; tx_id: string | null;
  result: LedgerResult | null; block_number: string | null; error_code: string | null;
}
const ledgerErrors = ['FORBIDDEN', 'UNAUTHENTICATED', 'INVALID_INPUT', 'INVALID_ID', 'INVALID_HASH', 'INVALID_TIME', 'INVALID_DATE',
  'CODE_FORMAT', 'CODE_PRODUCT', 'CODE_CHEMISTRY_UNVERIFIED', 'CODE_CHEMISTRY', 'CODE_DATE', 'CODE_DATE_MISMATCH', 'CODE_SERIAL', 'ALREADY_EXISTS', 'NOT_FOUND', 'VERSION_CONFLICT',
  'RETEST_REQUIRED', 'QUALITY_GATE', 'EMPTY_ASSEMBLY', 'INVALID_ASSEMBLY', 'DUPLICATE_BINDING', 'SUPPLY_REQUIRED', 'INVALID_SUPPLY',
  'RISK_BINDING', 'RISK_SIGNATURE', 'RISK_EXPIRED', 'RISK_SIGNER', 'INVALID_RISK', 'APPROVALS_MISSING',
  'STALE_APPROVAL', 'DUPLICATE_APPROVAL', 'RELEASE_EXPIRED', 'INVALID_STATE', 'TERMINAL_STATE', 'INVALID_TRANSFER',
  'TRANSFER_EXPIRED', 'TRANSFER_PENDING', 'STALE_TRANSFER', 'INVALID_TRANSFER_STATE', 'UNSAFE_POLICY', 'STALE_POLICY', 'STANDARD_NOT_VERIFIED',
  'IDEMPOTENCY_CONFLICT', 'INVALID_MAKER', 'INVALID_BATCH','INVALID_CORRECTION','STALE_CORRECTION','CORRECTION_EXPIRED','CHRONOLOGY_INVALID'];

export function safeErrorCode(error: unknown): string {
  const object = error as { message?: string; details?: { message?: string }[] };
  const messages = [object?.message, ...(object?.details ?? []).map(d => d.message)].filter(Boolean).join(' ');
  return ledgerErrors.find(code => messages.includes(`${code}:`)) ?? 'DEPENDENCY_UNAVAILABLE';
}

export class TransactionService {
  constructor(private readonly db: Database, private readonly fabric: FabricService) {}
  private payloadHash(command:Command){
    const intent=command.action==='RequestRelease'?{...command,data:{id:command.data.id,packId:command.data.packId}}:command;
    return sha256(canonicalJson(intent));
  }
  async replay(actor:LedgerActor,command:Command){
    const {rows}=await this.db.pool.query<RequestRow>('SELECT payload_hash,stage,tx_id,result,block_number,error_code FROM transaction_requests WHERE actor_hash=$1 AND request_id=$2',[actor.actorHash,command.requestId]);
    if(!rows[0])return null;
    if(rows[0].payload_hash!==this.payloadHash(command))throw new HttpException({code:'IDEMPOTENCY_CONFLICT'},409);
    return this.response(command.requestId,rows[0]);
  }
  private async update(actorHash: string, requestId: string, stage: TransactionStage, txId?: string, result?: LedgerResult, block?: string, code?: string) {
    await this.db.pool.query(`UPDATE transaction_requests SET stage=$3, tx_id=COALESCE($4,tx_id), result=COALESCE($5::jsonb,result),
      block_number=COALESCE($6::numeric,block_number),error_code=$7,updated_at=now() WHERE actor_hash=$1 AND request_id=$2`,
    [actorHash, requestId, stage, txId ?? null, result ? JSON.stringify(result) : null, block ?? null, code ?? null]);
  }
  async execute(actor: LedgerActor, command: Command) {
    // Risk evidence is generated internally and may refresh; idempotency binds caller intent.
    const digest = this.payloadHash(command);
    const inserted = await this.db.pool.query(`INSERT INTO transaction_requests(actor_hash,request_id,payload_hash,command,stage)
      VALUES($1,$2,$3,$4::jsonb,'built') ON CONFLICT DO NOTHING RETURNING request_id`,
    [actor.actorHash, command.requestId, digest, JSON.stringify(command)]);
    if (!inserted.rowCount) {
      const row = await this.row(actor.actorHash, command.requestId);
      if (row.payload_hash !== digest) throw new HttpException({ code: 'IDEMPOTENCY_CONFLICT' }, 409);
      return this.response(command.requestId, row);
    }
    let stage: TransactionStage = 'built';
    let txId: string | undefined;
    try {
      const proposal = await this.fabric.proposal(actor.identity, command);
      txId = proposal.getTransactionId();
      await this.update(actor.actorHash, command.requestId, 'built', txId);
      const transaction = await proposal.endorse();
      stage = 'endorsed';
      await this.update(actor.actorHash, command.requestId, stage);
      // Persist uncertainty before sending: a crash/timeout must never cause an automatic replay.
      stage = 'submitted';
      await this.update(actor.actorHash, command.requestId, stage);
      const submitted = await transaction.submit();
      const status = await submitted.getStatus();
      if (!status.successful || status.code !== 0) {
        await this.update(actor.actorHash, command.requestId, 'invalid', txId, undefined, status.blockNumber.toString(), 'INVALID_LEDGER_TRANSACTION');
        return this.status(actor, command.requestId, false);
      }
      stage = 'committed';
      await this.update(actor.actorHash, command.requestId, stage, txId, undefined, status.blockNumber.toString());
      const verified = await this.fabric.verifyCommitted(actor.identity, txId, command.requestId);
      await this.update(actor.actorHash, command.requestId, 'ledger-verified', txId, verified.result, verified.blockNumber);
      return this.status(actor, command.requestId, false);
    } catch (error) {
      const code = safeErrorCode(error);
      const outcome = stage === 'submitted' || stage === 'committed' ? 'unknown' : 'rejected';
      await this.update(actor.actorHash, command.requestId, outcome, txId, undefined, undefined, code);
      return this.status(actor, command.requestId, false);
    }
  }
  private async row(actorHash: string, requestId: string): Promise<RequestRow> {
    const { rows } = await this.db.pool.query<RequestRow>('SELECT payload_hash,stage,tx_id,result,block_number,error_code FROM transaction_requests WHERE actor_hash=$1 AND request_id=$2', [actorHash, requestId]);
    if (!rows[0]) throw new HttpException({ code: 'NOT_FOUND' }, 404);
    return rows[0];
  }
  private response(requestId: string, row: RequestRow) {
    return { requestId, txId: row.tx_id, stage: row.stage, completed: row.stage === 'ledger-verified',
      result: row.result, blockNumber: row.block_number, errorCode: row.error_code };
  }
  async status(actor: LedgerActor, requestId: string, reconcile = true) {
    let row = await this.row(actor.actorHash, requestId);
    if (reconcile && row.tx_id && ['submitted', 'committed', 'unknown', 'endorsed'].includes(row.stage)) {
      try {
        const verified = await this.fabric.verifyCommitted(actor.identity, row.tx_id, requestId);
        await this.update(actor.actorHash, requestId, 'ledger-verified', row.tx_id, verified.result, verified.blockNumber);
        row = await this.row(actor.actorHash, requestId);
      } catch(error) {
        if(error instanceof InvalidLedgerTransaction){
          await this.update(actor.actorHash,requestId,'invalid',row.tx_id??undefined,undefined,error.blockNumber,'INVALID_LEDGER_TRANSACTION');
          row=await this.row(actor.actorHash,requestId);
        }
        // An absent/unreachable block is not proof that the transaction failed.
      }
    }
    return this.response(requestId, row);
  }
}
