import { request, Agent } from 'node:https';
import { readFileSync } from 'node:fs';
import { requiredEnv } from './config.js';

export class InternalServiceError extends Error{
  constructor(readonly status:number){super('INTERNAL_SERVICE_REJECTED');}
}

export class InternalClient {
  private readonly agent: Agent;
  constructor() {
    this.agent = new Agent({
      cert: readFileSync(requiredEnv('TRUSTGUARD_WORKLOAD_CERT')),
      key: readFileSync(requiredEnv('TRUSTGUARD_WORKLOAD_KEY')),
      ca: readFileSync(requiredEnv('TRUSTGUARD_INTERNAL_SERVER_CA')),
      rejectUnauthorized: true, minVersion: 'TLSv1.2', keepAlive: true,
    });
  }
  async post<T>(base: string, path: string, value: unknown): Promise<T> {
    const url = new URL(path, base);
    if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password) throw new Error('INVALID_INTERNAL_ENDPOINT');
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(value);
      const req = request(url, { method: 'POST', agent: this.agent, timeout: 15000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (part: Buffer) => {
          size += part.length;
          if (size > 2 * 1024 * 1024) { res.destroy(); reject(new Error('INTERNAL_RESPONSE_TOO_LARGE')); return; }
          parts.push(part);
        });
        res.on('end', () => {
          if (res.statusCode !== 200) { reject(new InternalServiceError(res.statusCode??503)); return; }
          try { resolve(JSON.parse(Buffer.concat(parts).toString()) as T); } catch { reject(new Error('INVALID_INTERNAL_RESPONSE')); }
        });
        res.on('error', () => reject(new Error('INTERNAL_SERVICE_UNAVAILABLE')));
      });
      req.on('timeout', () => req.destroy(new Error('INTERNAL_TIMEOUT')));
      req.on('error', () => reject(new Error('INTERNAL_SERVICE_UNAVAILABLE')));
      req.end(body);
    });
  }
  close() { this.agent.destroy(); }
}
