import { TLSSocket } from 'node:tls';
import type { NextFunction, Request, Response } from 'express';
import { fingerprint, sha256, type Configuration } from './config.js';
import type { AuthenticatedActor } from './types.js';
import { AuditService } from './audit.js';

export interface AuthenticatedRequest extends Request { actor: AuthenticatedActor }
export function authentication(config: Configuration, audit: AuditService) {
  const counters = new Map<string, { window: number; reads: number; writes: number }>();
  return async (request: Request, response: Response, next: NextFunction) => {
    const socket = request.socket;
    if (!(socket instanceof TLSSocket) || !socket.authorized) { response.status(401).json({ code: 'CLIENT_CERTIFICATE_REQUIRED' }); return; }
    const peer = socket.getPeerCertificate();
    const identity = peer.raw && config.identities.find(i => i.clientFingerprint === fingerprint(peer.raw));
    if (!identity) { response.status(403).json({ code: 'UNKNOWN_CLIENT_CERTIFICATE' }); return; }
    const actor = { identity, actorHash: sha256(identity.mspId + ':' + identity.clientFingerprint) };
    (request as AuthenticatedRequest).actor = actor;
    const window = Math.floor(Date.now() / 60000);
    let count = counters.get(actor.actorHash);
    if (!count || count.window !== window) { count = { window, reads: 0, writes: 0 }; counters.set(actor.actorHash, count); }
    const type = request.method === 'GET' ? 'reads' : 'writes';
    count[type]++;
    if (count[type] > (type === 'reads' ? 120 : 30)) { response.status(429).json({ code: 'RATE_LIMITED' }); return; }
    const requestId = typeof request.body?.requestId === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(request.body.requestId) ? request.body.requestId : null;
    // Log action shape only; codes, bodies, certs, credentials and report contents stay out of logs.
    const action = request.method + ':' + request.path.split('/').slice(0, 7).map(part => part==='v1'||/^[A-Za-z-]+$/.test(part) ? part : ':resource').join('/');
    try { await audit.record(actor.actorHash, requestId, action, 'RECEIVED'); }
    catch { response.status(503).json({ code: 'AUDIT_UNAVAILABLE' }); return; }
    response.once('finish', () => { void audit.record(actor.actorHash, requestId, action, String(response.statusCode)).catch(() => { /* pre-request evidence remains durable */ }); });
    next();
  };
}
