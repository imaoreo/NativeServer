import { Redis } from 'ioredis';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedWebSocket } from '../types.js';
import { checkRateLimit, normalizePublicKey } from '../helper.js';
import { connections } from '../../index.js';
import { prisma } from '../../../db.js';

export async function handleAuthenticate(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const { deviceId, publicKey, signature, challenge, deviceName } = payload || {};

    if (
        typeof deviceId !== 'string' || 
        typeof publicKey !== 'string' || 
        typeof signature !== 'string' ||
        typeof challenge !== 'string'
    ) {
        ws.sendError('device_authenticated', 'Invalid payload');
        return;
    }

    if (deviceId.length !== 36) { 
        ws.sendError('device_authenticated', 'Invalid deviceId format');
        return;
    }

    const ip = ws.ip || 'unknown';
    const baselineDelay = new Promise(r => setTimeout(r, 50 + Math.random() * 50));

    if (await checkRateLimit(redis, `rl:set:${ip}`, 15, 3600)) {
        await baselineDelay;
        ws.sendError('device_authenticated', 'Too many attempts');
        return;
    }

    const challengeKey = `challenge:${challenge}`;
    const isValidChallenge = await redis.get(challengeKey);

    if (!isValidChallenge) {
        ws.sendError('device_authenticated', 'Invalid or expired challenge');
        return;
    }

    await redis.del(challengeKey);

    const normalizedKey = normalizePublicKey(publicKey);

    let isSignatureValid = false;
    try {
        const verifyChallengeOnly = crypto.createVerify('SHA256');
        verifyChallengeOnly.update(challenge);
        verifyChallengeOnly.end();
        isSignatureValid = verifyChallengeOnly.verify(normalizedKey, signature, 'base64');
    } catch (err) {
        ws.sendError('device_authenticated', 'Invalid public key or signature format');
        return;
    }

    if (!isSignatureValid) {
        ws.sendError('device_authenticated', 'Invalid signature');
        return;
    }

    
    let device = await prisma.device.findUnique({
        where: {
            id: deviceId
        }
    })

    if (device) {
        if (normalizePublicKey(device.publicKey) !== normalizedKey) {
            ws.sendError('device_authenticated', 'Public key mismatch for this device');
            return;
        }
    } else {
        device = await prisma.device.create({
            data: {
                id: deviceId,
                publicKey: normalizedKey,
                name: deviceName || 'Unknown Device'
            }
        });
    }

    if (device.name !== deviceName) {
        await prisma.device.update({
            where: { id: deviceId },
            data: { name: deviceName || 'Unknown Device' }
        });
    }

    const userId = device.userId;

    ws.deviceId = deviceId;
    connections.set(deviceId, ws);

    if (userId) {
        ws.isAuth = true;
        ws.accountId = userId;
    }

    ws.sendSuccess('device_authenticated', 'Device authenticated successfully', { accountId: userId });
}