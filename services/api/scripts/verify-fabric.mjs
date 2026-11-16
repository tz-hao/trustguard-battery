import assert from 'node:assert/strict';
import { createHash, createPrivateKey, randomUUID, X509Certificate } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import * as grpc from '@grpc/grpc-js';
import { connect, hash, signers } from '@hyperledger/fabric-gateway';
import { common, gateway as gatewayProto, msp, peer } from '@hyperledger/fabric-protos';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const networkDir = '/home/milli/projects/fabric-samples/test-network';
const channel = 'trustguardchannel';
const chaincode = 'basic';
const assetId = `trustguard-${randomUUID()}`;
const reportPath = path.join(root, 'docs/reports/phase4-transactions.json');
const report = { network: 'local Fabric test-network', channel, chaincode, assetId, transactions: [], identities: [] };
const connections = [];
const save = () => writeFile(reportPath, JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');

async function onlyFile(directory) {
  const files = await readdir(directory);
  assert.equal(files.length, 1, `Expected one identity file in ${directory}`);
  return readFile(path.join(directory, files[0]));
}

async function openOrg(org, port) {
  const domain = `org${org}.example.com`;
  const base = path.join(networkDir, 'organizations/peerOrganizations', domain);
  const userMsp = path.join(base, `users/User1@${domain}/msp`);
  const certificate = await onlyFile(path.join(userMsp, 'signcerts'));
  // Key material stays in memory and is never logged or written to a report.
  const key = createPrivateKey(await onlyFile(path.join(userMsp, 'keystore')));
  const tlsRoot = await readFile(path.join(base, `peers/peer0.${domain}/tls/ca.crt`));
  const client = new grpc.Client(`localhost:${port}`, grpc.credentials.createSsl(tlsRoot), {
    'grpc.ssl_target_name_override': `peer0.${domain}`,
  });
  const gateway = connect({ client, identity: { mspId: `Org${org}MSP`, credentials: certificate },
    signer: signers.newPrivateKeySigner(key), hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + 15_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 30_000 }),
    submitOptions: () => ({ deadline: Date.now() + 15_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 30_000 }),
  });
  const network = gateway.getNetwork(channel);
  const result = { client, gateway, org: `Org${org}MSP`, contract: network.getContract(chaincode), qscc: network.getContract('qscc') };
  connections.push(result);
  report.identities.push({ mspId: result.org, endpoint: `localhost:${port}`, certificateSha256: new X509Certificate(certificate).fingerprint256 });
  return result;
}

function endorsingMsps(envelope) {
  const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
  const transaction = peer.Transaction.deserializeBinary(payload.getData_asU8());
  const organizations = [];
  for (const action of transaction.getActionsList()) {
    const endorsed = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8()).getAction();
    for (const endorsement of endorsed.getEndorsementsList()) {
      organizations.push(msp.SerializedIdentity.deserializeBinary(endorsement.getEndorser_asU8()).getMspid());
    }
  }
  return [...new Set(organizations)].sort();
}

async function readCommittedBlock(org, transactionId, expectedNumber) {
  let bytes;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      bytes = await org.qscc.evaluateTransaction('GetBlockByTxID', channel, transactionId);
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await delay(250); // Read-only retry while the second peer catches up.
    }
  }
  const block = common.Block.deserializeBinary(bytes);
  const header = block.getHeader();
  assert(Number.isSafeInteger(header.getNumber()));
  assert.equal(BigInt(header.getNumber()), expectedNumber);
  const entries = block.getData().getDataList_asU8();
  const dataHash = createHash('sha256').update(Buffer.concat(entries)).digest();
  assert.deepEqual(dataHash, Buffer.from(header.getDataHash_asU8()));
  const flags = block.getMetadata().getMetadataList_asU8()[common.BlockMetadataIndex.TRANSACTIONS_FILTER];
  let index = -1;
  for (let i = 0; i < entries.length; i++) {
    const envelope = common.Envelope.deserializeBinary(entries[i]);
    const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
    const channelHeader = common.ChannelHeader.deserializeBinary(payload.getHeader().getChannelHeader_asU8());
    if (channelHeader.getTxId() === transactionId) {
      assert.equal(channelHeader.getChannelId(), channel);
      assert.deepEqual(endorsingMsps(envelope), ['Org1MSP', 'Org2MSP']);
      index = i;
      break;
    }
  }
  assert(index >= 0, 'Transaction absent from committed block');
  assert.equal(flags[index], 0, 'Ledger transaction validation code must be VALID');
  return { organization: org.org, blockNumber: expectedNumber.toString(), validationCode: flags[index],
    dataHash: dataHash.toString('hex'), previousHash: Buffer.from(header.getPreviousHash_asU8()).toString('hex') };
}

async function submitAndVerify(orgs, method, args, expectedOwner) {
  const proposal = orgs[0].contract.newProposal(method, { arguments: args, endorsingOrganizations: ['Org1MSP', 'Org2MSP'] });
  const record = { function: method, transactionId: proposal.getTransactionId(), stage: 'built' };
  report.transactions.push(record);
  await save();
  const transaction = await proposal.endorse();
  const envelope = gatewayProto.PreparedTransaction.deserializeBinary(transaction.getBytes()).getEnvelope();
  record.endorsingOrganizations = endorsingMsps(envelope);
  assert.deepEqual(record.endorsingOrganizations, ['Org1MSP', 'Org2MSP']);
  record.stage = 'endorsed';
  await save();
  // No automatic write retries: uncertain submissions must be inspected by transaction ID.
  const submitted = await transaction.submit();
  record.stage = 'submitted';
  await save();
  const status = await submitted.getStatus();
  record.commitStatus = status;
  assert.equal(status.transactionId, record.transactionId);
  assert.equal(status.successful, true);
  assert.equal(status.code, 0);
  record.stage = 'committed';
  await save();
  record.peerBlocks = [];
  for (const org of orgs) record.peerBlocks.push(await readCommittedBlock(org, record.transactionId, status.blockNumber));
  assert.equal(record.peerBlocks[0].dataHash, record.peerBlocks[1].dataHash);
  assert.equal(record.peerBlocks[0].previousHash, record.peerBlocks[1].previousHash);
  record.peerReads = [];
  for (const org of orgs) {
    const asset = JSON.parse(Buffer.from(await org.contract.evaluateTransaction('ReadAsset', assetId)).toString());
    assert.equal(asset.ID, assetId);
    assert.equal(asset.Owner, expectedOwner);
    record.peerReads.push({ organization: org.org, asset });
  }
  assert.deepEqual(record.peerReads[0].asset, record.peerReads[1].asset);
  record.stage = 'ledger-verified';
  await save();
  console.log(`${method}: VALID, block=${status.blockNumber}, both MSP endorsements and both peer ledger reads verified; tx=${record.transactionId}`);
}

try {
  const orgs = [await openOrg(1, 7051), await openOrg(2, 9051)];
  await submitAndVerify(orgs, 'CreateAsset', [assetId, 'blue', '10', 'TrustGuard-QA', '100'], 'TrustGuard-QA');
  await submitAndVerify(orgs, 'TransferAsset', [assetId, 'TrustGuard-QA-Verified'], 'TrustGuard-QA-Verified');
  report.completedAt = new Date().toISOString();
  report.result = 'PASS';
  await save();
} catch (error) {
  report.result = 'FAIL';
  report.error = { name: error.name, message: error.message };
  await save();
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const { client, gateway } of connections) { gateway.close(); client.close(); }
}
