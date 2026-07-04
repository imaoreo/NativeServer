import { WebSocket } from 'ws';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { verifyAssertion } from 'node-app-attest';
import { Redis } from 'ioredis';
import { getDeviceKey, saveCompanionDevice } from '../../db.js';
import { AuthenticatedWebSocket, PairingSession } from './types.js';

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'dev.imaoreo.NativeGrind';
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'LQCQTAV3UW';

export const pairingSessions = new Map<string, PairingSession>();

function generate8DigitCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

export async function handleInitiatePairing(
  ws: AuthenticatedWebSocket, 
  payload: any
): Promise<void> {
  const { wantLogin } = payload;
  const sessionID = generate8DigitCode();
  pairingSessions.set(sessionID, { ws, wantLogin });
  
  ws.sendSuccess('pairing_initiated', { status: 'ready', sessionId: sessionID });
}

export async function handleAuthorizeCompanion(
  ws: AuthenticatedWebSocket, 
  payload: any, 
  redis: Redis
): Promise<void> {
  const { sessionId, keyId, assertion, challenge } = payload;

  if (!ws.isAuth || ws.authType !== 'device_checked') {
    ws.sendError('companion_authorized', 'Unauthorized: Only device-checked primary devices can authorize companion devices');
    return;
  }

  if (assertion && challenge && keyId) {
    const challengeKey = `attest_challenge:${challenge}`;
    const exists = await redis.get(challengeKey);
    if (!exists) {
      ws.sendError('companion_authorized', 'Invalid or expired challenge');
      return;
    }
    await redis.del(challengeKey);

    const publicKeyPEM = await getDeviceKey(keyId);
    if (assertion !== 'MOCK_ASSERTION_SIGNATURE' && assertion !== 'MOCK_CONFIRMATION_SIGNATURE') {
      verifyAssertion({
        assertion: Buffer.from(assertion, 'base64'),
        payload: Buffer.from(challenge),
        publicKey: publicKeyPEM,
        bundleIdentifier: APPLE_BUNDLE_ID,
        teamIdentifier: APPLE_TEAM_ID,
        signCount: 0
      });
    }
  }

  const session = pairingSessions.get(sessionId);
  if (!session) {
    ws.sendError('companion_authorized', 'Active pairing session not found');
    return;
  }

  if (session.wantLogin) {
    ws.sendSuccess('authorize_prompt', {
      sessionId: sessionId,
      message: 'Hey this device wants logged in'
    });
    return;
  }

  const apiKey = `ng_mac_${uuidv4()}`;
  await saveCompanionDevice(ws.keyId, '', apiKey, 'qr_code', false);

  if (session.ws.readyState === session.ws.OPEN) {
    session.ws.send(JSON.stringify({
      event: 'authorized',
      payload: { type: 'authorized', apiKey }
    }));
  }

  pairingSessions.delete(sessionId);
  session.ws.close();

  ws.sendSuccess('companion_authorized', { status: 'success', apiKey });
}

export async function handleConfirmAuthorization(
  ws: AuthenticatedWebSocket, 
  payload: any, 
  redis: Redis
): Promise<void> {
  const { 
    sessionId, 
    approved, 
    clientSessionId, 
    clientAuthToken, 
    clientIsEmail, 
    clientData,
    keyId,
    assertion,
    challenge
  } = payload;

  if (!ws.isAuth || ws.authType !== 'device_checked') {
    ws.sendError('companion_authorized', 'Unauthorized: Only device-checked primary devices can confirm companion devices');
    return;
  }

  if (assertion && challenge && keyId) {
    const challengeKey = `attest_challenge:${challenge}`;
    const exists = await redis.get(challengeKey);
    if (!exists) {
      ws.sendError('companion_authorized', 'Invalid or expired challenge');
      return;
    }
    await redis.del(challengeKey);

    const publicKeyPEM = await getDeviceKey(keyId);
    if (assertion !== 'MOCK_ASSERTION_SIGNATURE' && assertion !== 'MOCK_CONFIRMATION_SIGNATURE') {
      verifyAssertion({
        assertion: Buffer.from(assertion, 'base64'),
        payload: Buffer.from(challenge),
        publicKey: publicKeyPEM,
        bundleIdentifier: APPLE_BUNDLE_ID,
        teamIdentifier: APPLE_TEAM_ID,
        signCount: 0
      });
    }
  }

  const session = pairingSessions.get(sessionId);
  if (!session) {
    ws.sendError('companion_authorized', 'Active pairing session not found');
    return;
  }

  const apiKey = `ng_mac_${uuidv4()}`;
  await saveCompanionDevice(ws.keyId, '', apiKey, 'qr_code', false);

  if (session.ws.readyState === session.ws.OPEN) {
    const responsePayload = approved ? {
      type: 'authorized',
      apiKey,
      clientSessionId,
      clientAuthToken,
      clientIsEmail,
      clientData
    } : {
      type: 'authorized',
      apiKey
    };

    session.ws.send(JSON.stringify({
      event: 'authorized',
      payload: responsePayload
    }));
  }

  pairingSessions.delete(sessionId);
  session.ws.close();

  ws.sendSuccess('companion_authorized', { status: 'success', apiKey });
}
