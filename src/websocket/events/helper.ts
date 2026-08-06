import { Redis } from 'ioredis';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const LUA_RATE_LIMIT = `
  local count = redis.call('incr', KEYS[1])
  if count == 1 then
    redis.call('expire', KEYS[1], ARGV[1])
  end
  return count
`;

export async function checkRateLimit(
  redis: Redis, key: string, limit: number, windowSec: number
): Promise<boolean> {
  const count = await redis.eval(LUA_RATE_LIMIT, 1, key, windowSec.toString()) as number;
  return count > limit;
}

export function normalizePublicKey(keyStr: string): string {

  if (keyStr.includes('-----BEGIN PUBLIC KEY-----')) {
    return keyStr;
  }

  if (keyStr.includes('publicKey')) {
    try {
      const parsed = JSON.parse(keyStr);
      if (parsed.publicKey) {
        keyStr = parsed.publicKey;
      }
    } catch (e) {
      console.warn('[normalizePublicKey] JSON parse failed, treating as raw string.', e);
    }
  }

  const base64Part = keyStr.replace(/[\s"]+/g, '');
  const buf = Buffer.from(base64Part, 'base64');

  if (buf.length !== 64 && buf.length !== 65 && buf.length !== 33) {
    const errMsg = `Invalid key size: Expected 64, 65, or 33 bytes, got ${buf.length}.`;
    console.error(`[normalizePublicKey] Error: ${errMsg}`);
    throw new Error(errMsg);
  }

  let sec1Buf = buf;

  if (buf.length === 64) {
    sec1Buf = Buffer.concat([Buffer.from([0x04]), buf]);
  } else if (buf.length === 65) {
    if (buf[0] !== 0x04) {
      const errMsg = "Invalid 65-byte key: Must start with the 0x04 uncompressed prefix.";
      console.error(`[normalizePublicKey] Error: ${errMsg}`);
      throw new Error(errMsg);
    }
  } else if (buf.length === 33) {
    if (buf[0] !== 0x02 && buf[0] !== 0x03) {
      const errMsg = "Invalid 33-byte key: Must start with a 0x02 or 0x03 compressed prefix.";
      console.error(`[normalizePublicKey] Error: ${errMsg}`);
      throw new Error(errMsg);
    }
  }

  const idEcPublicKey = Buffer.from('06072a8648ce3d0201', 'hex');
  const secp256r1 = Buffer.from('06082a8648ce3d030107', 'hex');
  
  const algIdContent = Buffer.concat([idEcPublicKey, secp256r1]);
  const algId = Buffer.concat([
    Buffer.from([0x30, algIdContent.length]),
    algIdContent
  ]);
  
  const bitStringContent = Buffer.concat([Buffer.from([0x00]), sec1Buf]);
  const subjectPublicKey = Buffer.concat([
    Buffer.from([0x03, bitStringContent.length]),
    bitStringContent
  ]);
  
  const spkiContent = Buffer.concat([algId, subjectPublicKey]);
  const spki = Buffer.concat([
    Buffer.from([0x30, spkiContent.length]),
    spkiContent
  ]);

  try {
    const keyObj = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const pemKey = keyObj.export({ type: 'spki', format: 'pem' }) as string;
    return pemKey;
  } catch (err) {
    console.error('[normalizePublicKey] Failed to create or export public key.', err);
    throw err;
  }
}

export function decodeJWT(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
}

export function generateReverseDiff(oldVal: any, newVal: any): string | null {
  if (!oldVal || !newVal) return null;
  const oldDict = typeof oldVal === 'string' ? JSON.parse(oldVal) : oldVal;
  const newDict = typeof newVal === 'string' ? JSON.parse(newVal) : newVal;

  const diffDict: Record<string, any> = {};
  const keys = new Set([...Object.keys(oldDict), ...Object.keys(newDict)]);

  for (const key of keys) {
    if (key === 'distance') continue;

    const ov = oldDict[key];
    const nv = newDict[key];

    const oldStr = JSON.stringify(ov);
    const newStr = JSON.stringify(nv);

    if (oldStr !== newStr) {
      diffDict[key] = ov === undefined ? null : ov;
    }
  }

  if (Object.keys(diffDict).length === 0) return null;
  return JSON.stringify(diffDict);
}

const CACHE_DIR = process.env.CACHE_DIR || './public/cache';
const PFP_DIR = path.join(CACHE_DIR, 'pfp');

export async function saveMediaFile(mediaHash: string, base64Data: string): Promise<void> {
  const filePath = path.join(PFP_DIR, `${mediaHash}.jpg`);
  
  try {
    if (fs.existsSync(filePath)) {
      return;
    }
  } catch {}

  if (!fs.existsSync(PFP_DIR)) {
    await fs.promises.mkdir(PFP_DIR, { recursive: true });
  }
  
  const buffer = Buffer.from(base64Data, 'base64');
  await fs.promises.writeFile(filePath, buffer);
}

export function isMediaCached(mediaHash: string): boolean {
  const filePath = path.join(PFP_DIR, `${mediaHash}.jpg`);
  return fs.existsSync(filePath);
}