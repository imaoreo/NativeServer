import { Redis } from 'ioredis';
import { AuthenticatedWebSocket } from './types.js';
import { checkRateLimit } from './helper.js';
import { prisma } from '../../db.js';
import { connections } from '../index.js';

export async function handleSaveData(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const accountId = ws.accountId;
    const deviceId = ws.deviceId;
    const baselineDelay = new Promise(r => setTimeout(r, 50 + Math.random() * 50));

    if (!accountId || !ws.isAuth || !deviceId) {
        ws.sendError('save_data', 'Account not authenticated');
        return;
    }

    const { location, encryptedPayload } = payload || {};

    if (typeof location !== 'string' || typeof encryptedPayload !== 'string') {
        ws.sendError('save_data', 'Invalid payload');
        return;
    }

    if (await checkRateLimit(redis, `rl:storage:${accountId}`, 60, 60)) {
        await baselineDelay;
        ws.sendError('save_data', 'Too many attempts');
        return;
    }

    await prisma.storage.upsert({
      where: {
        userId_location: {
          userId: accountId,
          location: location,
        },
      },
      update: {
        encryptedPayload: encryptedPayload,
        lastModifiedById: deviceId,
      },
      create: {
        location: location,
        encryptedPayload: encryptedPayload,
        userId: accountId,
        lastModifiedById: deviceId,
      },
    })

    ws.sendSuccess('save_data', 'Data saved successfully', { accountId, location, encryptedPayload });

    for (const [otherDeviceId, otherWs] of connections.entries()) {
        if (otherDeviceId !== deviceId && otherWs.accountId === accountId && otherWs.readyState === otherWs.OPEN) {
            otherWs.send(JSON.stringify({
                event: 'save_data',
                payload: {
                    status: 'success',
                    message: 'Data updated by another device',
                    accountId,
                    location
                }
            }));
        }
    }
}

export async function handleGetData(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const accountId = ws.accountId;
    const deviceId = ws.deviceId;
    const baselineDelay = new Promise(r => setTimeout(r, 50 + Math.random() * 50));

    if (!accountId || !ws.isAuth || !deviceId) {
        ws.sendError('get_data', 'Account not authenticated');
        return;
    }

    const { location } = payload || {};

    if (typeof location !== 'string') {
        ws.sendError('get_data', 'Invalid payload');
        return;
    }

    if (await checkRateLimit(redis, `rl:storage:${accountId}`, 60, 60)) {
        await baselineDelay;
        ws.sendError('get_data', 'Too many attempts');
        return;
    }

    const storageRecord = await prisma.storage.findUnique({
      where: {
        userId_location: {
          userId: accountId,
          location: location,
        },
      }
    });

    if (!storageRecord) {
        ws.sendError('get_data', 'Data not found');
        return;
    }

    ws.sendSuccess('get_data', 'Data retrieved successfully', { 
        accountId, 
        location, 
        data: storageRecord.encryptedPayload 
    });
}