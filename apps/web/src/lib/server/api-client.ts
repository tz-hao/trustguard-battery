import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ORG_LABELS, ROLE_LABELS, type OrganizationMSP, type PublicIdentity } from '../types';

export interface ServerIdentity {
  name: string;
  mspId: OrganizationMSP;
  role: string;
  clientFingerprint: string;
  certificateFile: string;
  privateKeyFile: string;
  gatewayEndpoint: string;
  gatewayServerName: string;
  gatewayTlsRootFile: string;
}

interface CachedRuntime {
  runtimeDir: string;
  caCert: Buffer;
  identities: ServerIdentity[];
  byName: Map<string, ServerIdentity>;
  agents: Map<string, https.Agent>;
}

const globalForBff = globalThis as unknown as { __tgBffRuntime?: CachedRuntime };

function resolveRuntimePaths(): { identitiesFile: string; runtimeDir: string } {
  if (process.env.TRUSTGUARD_IDENTITIES_FILE) {
    const identitiesFile = process.env.TRUSTGUARD_IDENTITIES_FILE;
    return { identitiesFile, runtimeDir: path.dirname(identitiesFile) };
  }
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, 'infrastructure/runtime/business/identities.json'),
    path.resolve(cwd, '../../infrastructure/runtime/business/identities.json'),
  ];
  for (const candidate of candidates) {
    try {
      readFileSync(/*turbopackIgnore: true*/ candidate, 'utf8');
      return { identitiesFile: candidate, runtimeDir: path.dirname(candidate) };
    } catch {
      // try next
    }
  }
  throw new Error('Unable to locate infrastructure/runtime/business/identities.json');
}

function getRuntime(): CachedRuntime {
  if (globalForBff.__tgBffRuntime) return globalForBff.__tgBffRuntime;
  const { identitiesFile, runtimeDir } = resolveRuntimePaths();
  const identities = JSON.parse(readFileSync(/*turbopackIgnore: true*/ identitiesFile, 'utf8')) as ServerIdentity[];
  const caCert = readFileSync(/*turbopackIgnore: true*/ path.join(runtimeDir, 'server-ca/ca.crt'));
  const byName = new Map(identities.map(i => [i.name, i]));
  globalForBff.__tgBffRuntime = { runtimeDir, caCert, identities, byName, agents: new Map() };
  return globalForBff.__tgBffRuntime;
}

export function getRuntimeDir(): string {
  return getRuntime().runtimeDir;
}

export function listPublicIdentities(): PublicIdentity[] {
  return getRuntime().identities.map(i => ({
    name: i.name,
    mspId: i.mspId,
    role: i.role,
    orgLabel: ORG_LABELS[i.mspId] ?? i.mspId,
    roleLabel: ROLE_LABELS[i.role] ?? i.role,
    fingerprintPrefix: i.clientFingerprint.slice(0, 17),
  }));
}

export function resolveActorName(candidate?: string | null): string {
  const { byName } = getRuntime();
  if (candidate && byName.has(candidate)) return candidate;
  return byName.has('cell-viewer') ? 'cell-viewer' : getRuntime().identities[0].name;
}

export function getPublicIdentity(actorName: string): PublicIdentity {
  const resolved = resolveActorName(actorName);
  const found = listPublicIdentities().find(i => i.name === resolved);
  if (!found) throw new Error(`Unknown actor ${resolved}`);
  return found;
}

export function getActorPrivateKeyPem(actorName: string): string {
  const rt = getRuntime();
  const resolved = resolveActorName(actorName);
  const identity = rt.byName.get(resolved);
  if (!identity) throw new Error(`Unknown actor ${resolved}`);
  return readFileSync(identity.privateKeyFile, 'utf8');
}

export function getDemoSourceSigningKeyPem(): string {
  const rt = getRuntime();
  return readFileSync(path.join(rt.runtimeDir, 'services/source-signing.key'), 'utf8');
}

function getAgent(actorName: string): https.Agent {
  const rt = getRuntime();
  const resolved = resolveActorName(actorName);
  const existing = rt.agents.get(resolved);
  if (existing) return existing;
  const [org, role] = resolved.split('-');
  const base = path.join(rt.runtimeDir, 'organizations', org, 'users', role);
  const agent = new https.Agent({
    cert: readFileSync(path.join(base, 'api.crt')),
    key: readFileSync(path.join(base, 'api.key')),
    ca: rt.caCert,
    rejectUnauthorized: true,
    keepAlive: true,
  });
  rt.agents.set(resolved, agent);
  return agent;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  rawBuffer?: Buffer;
  contentType?: string;
}

export async function callBackendApi<T = unknown>(
  actorName: string,
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const baseUrl = process.env.TRUSTGUARD_API_BASE_URL ?? 'https://localhost:13000/api/v1';
  const agent = getAgent(actorName);
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${baseUrl}${route}`,
      {
        method,
        agent,
        timeout: 45000,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.byteLength }
          : undefined,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const contentType = res.headers['content-type'] ?? '';
          let data: unknown = buf;
          if (contentType.includes('application/json')) {
            try {
              data = JSON.parse(buf.toString('utf8'));
            } catch {
              data = { raw: buf.toString('utf8') };
            }
          }
          resolve({ status: res.statusCode ?? 500, data: data as T, rawBuffer: buf, contentType });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('BACKEND_API_TIMEOUT')));
    req.end(payload);
  });
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
