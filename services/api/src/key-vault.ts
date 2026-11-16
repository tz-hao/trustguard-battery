import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// This class runs only in the separate broker process. API does not receive its master key.
export class KeyVault {
  constructor(private readonly root: string, private readonly master: Buffer) {
    if (master.length !== 32) throw new Error('VAULT_MASTER_KEY_REQUIRED');
  }
  private file(id: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(id)) throw new Error('INVALID_REPORT_ID');
    return path.join(this.root, id + '.json');
  }
  async create(id: string): Promise<Buffer> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomBytes(32), nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, nonce);
    cipher.setAAD(Buffer.from(id));
    const wrapped = Buffer.concat([cipher.update(key), cipher.final()]);
    try {
      await writeFile(this.file(id), JSON.stringify({ nonce: nonce.toString('base64'), wrapped: wrapped.toString('base64'), tag: cipher.getAuthTag().toString('base64') }), { flag: 'wx', mode: 0o600 });
      return key;
    } catch (error) { key.fill(0); throw error; }
  }
  async open(id: string): Promise<Buffer> {
    const row = JSON.parse(await readFile(this.file(id), 'utf8')) as { nonce: string; wrapped: string; tag: string };
    const decipher = createDecipheriv('aes-256-gcm', this.master, Buffer.from(row.nonce, 'base64'));
    decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.wrapped, 'base64')), decipher.final()]);
  }
}
