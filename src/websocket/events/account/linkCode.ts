import { Redis } from 'ioredis';
import crypto from 'crypto';
import { AuthenticatedWebSocket } from '../types.js';
import { checkRateLimit } from '../helper.js';
import { connections } from '../../index.js';
import { prisma } from '../../../db.js';

export async function handleGenerateLinkCode(ws: AuthenticatedWebSocket, redis: Redis): Promise<void> {
  if (!ws.deviceId) {
    ws.sendError('link_code_generated', 'No device ID on this connection');
    return;
  }

  const deviceId = ws.deviceId;
  if (await checkRateLimit(redis, `rl:gen_code:${deviceId}`, 3, 180)) {
    ws.sendError('link_code_generated', 'Too many requests');
    return;
  }

  for (let i = 0; i < 10; i++) {
    const code = crypto.randomInt(10_000_000, 99_999_999).toString();
    const ok = await redis.set(`link_token:device:${code}`, ws.deviceId!, 'EX', 180, 'NX');
    if (ok === 'OK') {
      ws.sendSuccess('link_code_generated', 'Link code generated successfully', { code, ttl: 180 });
      return;
    }
  }

  ws.sendError('link_code_generated', 'Could not generate unique code. Try again.');
}

export async function handleLinkDeviceGetPublicKey(
  ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
  if (!ws.isAuth || !ws.accountId) {
    ws.sendError('link_device_public_key', 'Unauthorized');
    return;
  }

  const { code } = payload || {};
  if (typeof code !== 'string' || !/^\d{8}$/.test(code)) {
    ws.sendError('link_device_public_key', 'Code must be an 8-digit number');
    return;
  }

  const deviceId = await redis.get(`link_token:device:${code}`);
  if (!deviceId) {
    ws.sendError('link_device_public_key', 'Invalid or expired code');
    return;
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
  });
  
  if (!device) {
    ws.sendError('link_device_public_key', 'Device not found in database');
    return;
  }

  ws.sendSuccess('link_device_public_key', 'Public key retrieved successfully', { publicKey: device.publicKey });
}

export async function handleLinkDeviceViaCode(
  ws: AuthenticatedWebSocket, payload: any, redis: Redis
): Promise<void> {
  if (!ws.isAuth || !ws.accountId) {
    ws.sendError('device_linked', 'Unauthorized');
    return;
  }

  const { code, key } = payload || {};
  let devId: string | null = null;

  if (typeof code === 'string' && /^\d{8}$/.test(code)) {
    const deviceId = ws.deviceId;
    const baselineDelay = new Promise(r => setTimeout(r, 50 + Math.random() * 50));

    if (await checkRateLimit(redis, `rl:link_device:${deviceId}`, 5, 3600)) {
      await baselineDelay;
      ws.sendError('device_linked', 'Too many attempts from this device');
      return;
    }

    if (await checkRateLimit(redis, `rl:link_code:${code}`, 3, 180)) {
      await baselineDelay;
      ws.sendError('device_linked', 'Code blocked after too many attempts');
      return;
    }

    devId = await redis.get(`link_token:device:${code}`);
    if (!devId) {
      await baselineDelay;
      ws.sendError('device_linked', 'Invalid or expired code');
      return;
    }

    await redis.del(`link_token:device:${code}`);

  } else {
    ws.sendError('device_linked', 'Code must be an 8-digit number');
    return;
  }

  const targetWs = connections.get(devId);
  if (!targetWs) {
    ws.sendError('device_linked', 'Target device not connected');
    return;
  }
  
  const accountId = ws.accountId;
  if (!accountId) {
    ws.sendError('device_linked', 'Your account ID is missing');
    return;
  }

  const device = await prisma.device.findUnique({
    where: { id: devId },
  });

  if (!device) {
    ws.sendError('device_linked', 'Target device not found in database');
    return;
  }

  if (device.userId) {
    const deviceCount = await prisma.device.count({
      where: { userId: device.userId },
    });

    if (deviceCount === 1) {
      await prisma.user.delete({
        where: { id: device.userId },
      });
    }

    await prisma.device.update({
      where: { id: devId },
      data: { userId: null },
    });
  }

  await prisma.device.update({
    where: { id: devId },
    data: { userId: accountId },
  });

  targetWs.sendSuccess('device_connected', 'Device linked successfully', {
    accountId: accountId,
    key: key,
  });

  ws.sendSuccess('device_linked', 'Device linked successfully');
}
