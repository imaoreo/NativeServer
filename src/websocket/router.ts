import { Redis } from 'ioredis';
import { AuthenticatedWebSocket } from './events/types.js';
import {
  handleGenerateLinkCode,
  handleLinkDeviceViaCode,
  handleListDevices,
  handleRemoveDevice,
  handleAuthenticate,
  handleCreateAccount,
  handleLinkDeviceGetPublicKey
} from './events/account.js';

export async function routeWSEvent(
  event: string,
  payload: any,
  authedWs: AuthenticatedWebSocket,
  redis: Redis,
  wss: any
): Promise<void> {
  switch (event) {
    case 'generate_link_code':
      await handleGenerateLinkCode(authedWs, redis);
      break;

    case 'authorize_device':
      await handleAuthenticate(authedWs, payload, redis);
      break;

    case 'link_device_get_public_key':
      await handleLinkDeviceGetPublicKey(authedWs, payload, redis);
      break;

    case 'link_device_via_code':
      await handleLinkDeviceViaCode(authedWs, payload, redis);
      break;

    case 'create_account':
      await handleCreateAccount(authedWs, payload, redis);
      break;

    case 'list_devices':
      await handleListDevices(authedWs);
      break;

    case 'remove_device':
      await handleRemoveDevice(authedWs, payload, wss);
      break;

    case 'get_account_info':
      if (authedWs.isAuth && authedWs.accountId) {
        authedWs.sendSuccess('get_account_info', 'Account info retrieved successfully', { accountId: authedWs.accountId });
      } else if (authedWs.deviceId) {
        authedWs.sendSuccess('get_account_info', 'Device ID retrieved successfully', { deviceId: authedWs.deviceId });
      } else {
        authedWs.sendError('get_account_info', 'Unauthorized');
      }
      break;

    default:
      authedWs.sendError(event, 'Unknown event');
      break;
  }
}
