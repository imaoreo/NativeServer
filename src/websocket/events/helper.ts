import { Redis } from 'ioredis';
import crypto from 'crypto';

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