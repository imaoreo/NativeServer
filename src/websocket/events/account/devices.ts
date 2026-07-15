import { prisma } from '../../../db.js';
import { AuthenticatedWebSocket } from '../types.js';

export async function handleListDevices(ws: AuthenticatedWebSocket): Promise<void> {
  if (!ws.isAuth || !ws.accountId) { ws.sendError('device_list', 'Unauthorized'); return; }

  const devices = await prisma.device.findMany({
    where: {
      userId: ws.accountId,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  ws.sendSuccess('device_list', 'Devices retrieved successfully', { devices });
}

export async function handleRemoveDevice(
  ws: AuthenticatedWebSocket, payload: any, wss: any
): Promise<void> {
  if (!ws.isAuth || !ws.accountId) { ws.sendError('device_removed', 'Unauthorized'); return; }

  const { deviceId } = payload || {};
  if (typeof deviceId !== 'string') { ws.sendError('device_removed', 'Invalid deviceId'); return; }
  if (deviceId.length > 256) { ws.sendError('device_removed', 'Payload fields exceed maximum length'); return; }

  const device = await prisma.device.findUnique({
    where: {
      id: deviceId,
    },
  });

  if (!device || device.userId !== ws.accountId) {
    ws.sendError('device_removed', 'Device not found or not associated with your account');
    return;
  }

  await prisma.device.delete({
    where: {
      id: deviceId,
    },
  });

  const connectedWs = Array.from(wss.clients).find((client: any) => client.deviceId === deviceId) as AuthenticatedWebSocket | undefined;
  if (connectedWs) {
    connectedWs.sendError('device_removed', 'Your device has been removed from the account');
    connectedWs.close();
  }

  ws.sendSuccess('device_removed', 'Device removed successfully', { status: 'success' });
}
