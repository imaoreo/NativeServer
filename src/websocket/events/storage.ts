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

const SYNC_LOCATION_PATTERN = /^sync\/[0-9]{1,20}\/[A-Za-z]{1,32}\/[A-Za-z0-9_-]{8,128}$/;
const SYNC_PREFIX_PATTERN = /^sync\/[0-9]{1,20}\/$/;
const MAX_PUSH_ITEMS = 100;
const MAX_PUSH_BYTES = 8 * 1024 * 1024;
const MAX_PULL_ITEMS = 100;

export async function handleSyncPush(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const accountId = ws.accountId;
    const deviceId = ws.deviceId;

    if (!accountId || !ws.isAuth || !deviceId) {
        ws.sendError('sync_push', 'Account not authenticated');
        return;
    }

    const items = payload?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_PUSH_ITEMS) {
        ws.sendError('sync_push', 'Invalid payload');
        return;
    }

    let totalBytes = 0;
    for (const item of items) {
        if (typeof item?.location !== 'string' || !SYNC_LOCATION_PATTERN.test(item.location) || typeof item?.encryptedPayload !== 'string') {
            ws.sendError('sync_push', 'Invalid payload');
            return;
        }
        totalBytes += item.encryptedPayload.length;
    }
    if (totalBytes > MAX_PUSH_BYTES) {
        ws.sendError('sync_push', 'Payload too large');
        return;
    }

    if (await checkRateLimit(redis, `rl:sync:${accountId}`, 120, 60)) {
        ws.sendError('sync_push', 'Too many attempts');
        return;
    }

    try {
        await prisma.$transaction(items.map((item: { location: string; encryptedPayload: string }) =>
            prisma.storage.upsert({
                where: { userId_location: { userId: accountId, location: item.location } },
                update: { encryptedPayload: item.encryptedPayload, lastModifiedById: deviceId },
                create: { location: item.location, encryptedPayload: item.encryptedPayload, userId: accountId, lastModifiedById: deviceId }
            })
        ));
    } catch (error) {
        console.error('sync_push failed:', error);
        ws.sendError('sync_push', 'Failed to save');
        return;
    }

    ws.sendSuccess('sync_push', 'Synced', { count: items.length });

    for (const [otherDeviceId, otherWs] of connections.entries()) {
        if (otherDeviceId !== deviceId && otherWs.accountId === accountId && otherWs.readyState === otherWs.OPEN) {
            otherWs.send(JSON.stringify({ event: 'sync_changed', payload: { status: 'success', message: 'Data changed on another device' } }));
        }
    }
}

export async function handleSyncPull(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const accountId = ws.accountId;

    if (!accountId || !ws.isAuth || !ws.deviceId) {
        ws.sendError('sync_pull', 'Account not authenticated');
        return;
    }

    const { prefix, cursor } = payload || {};
    if (typeof prefix !== 'string' || !SYNC_PREFIX_PATTERN.test(prefix)) {
        ws.sendError('sync_pull', 'Invalid payload');
        return;
    }

    const since = typeof cursor?.updatedAt === 'number' ? new Date(cursor.updatedAt) : new Date(0);
    const afterId = typeof cursor?.id === 'string' ? cursor.id : '';

    if (await checkRateLimit(redis, `rl:sync:${accountId}`, 120, 60)) {
        ws.sendError('sync_pull', 'Too many attempts');
        return;
    }

    const rows = await prisma.storage.findMany({
        where: {
            userId: accountId,
            location: { startsWith: prefix },
            OR: [
                { updatedAt: { gt: since } },
                { updatedAt: since, id: { gt: afterId } }
            ]
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: MAX_PULL_ITEMS + 1
    });

    const page = rows.slice(0, MAX_PULL_ITEMS);
    const last = page[page.length - 1];

    ws.sendSuccess('sync_pull', 'Pulled', {
        items: page.map(row => ({
            location: row.location,
            encryptedPayload: row.encryptedPayload,
            updatedAt: row.updatedAt.getTime()
        })),
        cursor: last ? { updatedAt: last.updatedAt.getTime(), id: last.id } : (cursor ?? null),
        hasMore: rows.length > MAX_PULL_ITEMS
    });
}
