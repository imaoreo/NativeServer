import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedWebSocket } from '../types.js';
import { checkRateLimit } from '../helper.js';
import { prisma } from '../../../db.js';

export async function handleCreateAccount(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const ip = ws.ip || 'unknown';
    const baselineDelay = new Promise(r => setTimeout(r, 50 + Math.random() * 50));

    if (await checkRateLimit(redis, `rl:auth:${ip}`, 5, 3600)) {
        await baselineDelay;
        ws.sendError('create_account', 'Too many attempts');
        return;
    }

    const accountId = uuidv4();
    const deviceId = ws.deviceId;

    if (!deviceId) {
        ws.sendError('create_account', 'Device not authenticated');
        return;
    }

    const device = await prisma.device.findUnique({
        where: {
            id: deviceId,
        },
    });

    if (!device) {
        ws.deviceId = undefined;
        ws.accountId = undefined;
        ws.isAuth = false;
        ws.sendError('create_account', 'Device not found');
        return;
    }

    if (device.userId) {
        const deviceCount = await prisma.device.count({
            where: {
                userId: device.userId,
            },
        });


        if (deviceCount == 1) {
            return ws.sendError('create_account', 'Device is already associated with an account with only itself.');
        }

        if (deviceCount > 1 ) {
            await prisma.device.update({
                where: {
                    id: deviceId,
                },
                data: {
                    userId: null,
                },
            })
        }
    }

    await prisma.user.create({
        data: {
            id: accountId,
        },
    });

    await prisma.device.update({
        where: {
            id: deviceId,
        },
        data: {
            userId: accountId,
        },
    });

    ws.isAuth = true;
    ws.accountId = accountId;

    ws.sendSuccess('create_account', 'Account created successfully', { accountId });
}