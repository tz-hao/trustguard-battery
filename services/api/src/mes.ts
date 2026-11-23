import {verify, type KeyObject} from 'node:crypto';
import {HttpException} from '@nestjs/common';
import {z} from 'zod';
import {canonicalJson} from './config.js';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const rows = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('material'),data:z.object({
    id,ownerMSP:z.literal('CellOrgMSP'),sourceHash:hash,simulation:z.literal(true)
  }).strict()}).strict(),
  z.object({kind:z.literal('batch'),data:z.object({
    id,makerMSP:z.literal('CellOrgMSP'),materialLotIds:z.array(id).min(1).max(100),simulation:z.literal(true)
  }).strict()}).strict(),
  z.object({kind:z.literal('product'),data:z.object({
    id,code:z.string().regex(/^[A-Z0-9]{24}$/),batchId:z.union([id,z.literal('')]).optional(),
    model:z.string().min(1).max(100),manufacturedAt:z.iso.date(),manufactureSourceHash:hash,
    designLifeMonths:z.number().int().min(1).max(1200).nullable().optional(),specSourceHash:hash.optional()
  }).strict()}).strict(),
  z.object({kind:z.literal('supply'),data:z.object({childId:id,parentId:id,evidenceHash:hash}).strict()}).strict(),
  z.object({kind:z.literal('assembly'),data:z.object({
    parentId:id,children:z.array(id).max(1000),revision:z.number().int().positive(),evidenceHash:hash
  }).strict()}).strict()
]);
const envelope = z.object({
  requestId:id,
  data:z.object({source:z.literal('MES_SIM'),simulation:z.literal(true),records:z.array(rows).min(1).max(100)}).strict(),
  signature:z.string().min(1).max(4096)
}).strict();

export function verifyMesFile(body:unknown,key:KeyObject){
  const {signature,...manifest}=envelope.parse(body);
  if (!verify('sha256',Buffer.from(canonicalJson(manifest)),key,Buffer.from(signature,'base64')))
    throw new HttpException({code:'SOURCE_SIGNATURE_INVALID'},400);
  return manifest;
}
