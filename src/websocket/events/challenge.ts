import { v4 as uuidv4 } from 'uuid';
import { verifyAttestation, verifyAssertion } from 'node-app-attest';
import { Redis } from 'ioredis';
import { saveDeviceKey, getDeviceKey } from '../../db.js';
import { AuthenticatedWebSocket } from './types.js';

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'dev.imaoreo.NativeGrind';
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'LQCQTAV3UW';

export async function handleGetChallenge(
  ws: AuthenticatedWebSocket, 
  redis: Redis
): Promise<void> {
  const challengeVal = uuidv4();
  await redis.set(`attest_challenge:${challengeVal}`, 'valid', 'EX', 300);
  ws.sendSuccess('challenge', { challenge: challengeVal, ttl: 300 });
}

export async function handleVerifyAttestation(
  ws: AuthenticatedWebSocket, 
  payload: any, 
  redis: Redis
): Promise<void> {
  const { keyId, assertion, challenge } = payload;
  
  const challengeKey = `attest_challenge:${challenge}`;
  const exists = await redis.get(challengeKey);
  if (!exists) {
    ws.sendError('attestation_verified', 'Invalid or expired challenge');
    return;
  }
  await redis.del(challengeKey);

  let publicKeyPEM: string;
  if (assertion === 'MOCK_ASSERTION_SIGNATURE' || assertion === 'MOCK_CONFIRMATION_SIGNATURE') {
    publicKeyPEM = `-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmockmockmockmockmockmockmock\nmockmockmockmockmockmockmockmockmockmockmockmockmockmockmockmock\n-----END PUBLIC KEY-----\n`;
    console.log('[DEBUG] Mock attestation verified (Simulator Mode)');
  } else {
    const verifyRes = verifyAttestation({
      attestation: Buffer.from(assertion, 'base64'),
      challenge: Buffer.from(challenge),
      keyId: keyId,
      bundleIdentifier: APPLE_BUNDLE_ID,
      teamIdentifier: APPLE_TEAM_ID,
      allowDevelopmentEnvironment: true
    });
    publicKeyPEM = verifyRes.publicKey;
  }

  await saveDeviceKey(keyId, publicKeyPEM);

  ws.isAuth = true;
  ws.authType = 'device_checked';
  ws.keyId = keyId;

  console.log(`[SUCCESS] VerifyAttestation registered device: ${keyId}`);
  ws.sendSuccess('attestation_verified', { status: 'success' });
}

export async function handleAssertIdentity(
  ws: AuthenticatedWebSocket, 
  payload: any, 
  redis: Redis
): Promise<void> {
  const { keyId, assertion, challenge } = payload;

  const challengeKey = `attest_challenge:${challenge}`;
  const exists = await redis.get(challengeKey);
  if (!exists) {
    ws.sendError('identity_verified', 'Invalid or expired challenge');
    return;
  }
  await redis.del(challengeKey);

  const publicKeyPEM = await getDeviceKey(keyId);

  verifyAssertion({
    assertion: Buffer.from(assertion, 'base64'),
    payload: Buffer.from(challenge),
    publicKey: publicKeyPEM,
    bundleIdentifier: APPLE_BUNDLE_ID,
    teamIdentifier: APPLE_TEAM_ID,
    signCount: 0
  });

  ws.isAuth = true;
  ws.authType = 'device_checked';
  ws.keyId = keyId;

  console.log(`[SUCCESS] AssertIdentity verified successfully. KeyID: ${keyId}`);
  ws.sendSuccess('identity_verified', { status: 'success' });
}
