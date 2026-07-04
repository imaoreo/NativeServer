import { validateCompanionApiKey } from '../../db.js';
import { AuthenticatedWebSocket } from './types.js';

export async function handleAuth(
  ws: AuthenticatedWebSocket, 
  payload: any
): Promise<void> {
  const { apiKey } = payload;
  const valid = await validateCompanionApiKey(apiKey);
  if (!valid) {
    ws.sendError('auth', 'Invalid API key');
    return;
  }

  ws.isAuth = true;
  ws.authType = 'companion_or_manual_api';
  ws.keyId = '';

  ws.sendSuccess('authenticated', { status: 'success' });
}

export function handleGetAuthStatus(ws: AuthenticatedWebSocket): void {
  ws.sendSuccess('auth_status', {
    isAuthed: ws.isAuth,
    authType: ws.authType
  });
}
