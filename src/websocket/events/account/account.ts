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
            await prisma.user.delete({
                where: {
                    id: device.userId,
                },
            });
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

export async function handleDeleteAccount(
    ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
    const ip = ws.ip || 'unknown';
    const baselineDelay = new Promise(r => setTimeout(r, 50 + Math.random() * 50));

    if (await checkRateLimit(redis, `rl:auth:${ip}`, 5, 3600)) {
        await baselineDelay;
        ws.sendError('delete_account', 'Too many attempts');
        return;
    }

    const deviceId = ws.deviceId;

    if (!deviceId) {
        ws.sendError('delete_account', 'Device not authenticated');
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
        ws.sendError('delete_account', 'Device not found');
        return;
    }

    if (!device.userId) {
        ws.sendError('delete_account', 'Device is not associated with any account');
        return;
    }

    if (device.userId !== ws.accountId) {
        ws.sendError('delete_account', 'Device is not associated with your account');
        return;
    }

    const deviceCount = await prisma.device.count({
        where: {
            userId: device.userId,
        },
    });

    if (deviceCount === 1) {
        await prisma.user.delete({
            where: {
                id: device.userId,
            },
        });

        await prisma.device.update({
            where: {
                id: deviceId,
            },
            data: {
                userId: null,
            },
        });

        ws.isAuth = false;
        ws.accountId = undefined;
        ws.sendSuccess('delete_account', 'Account deleted successfully', { accountId: device.userId });
        return;
    } else if (deviceCount > 1) {
        ws.sendError('delete_account', 'Cannot delete account with multiple devices. Remove other devices first.');
        return;
    } else {
        ws.sendError('delete_account', 'Unexpected error occurred while deleting account');
    }
}