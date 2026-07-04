import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { Redis } from 'ioredis';
import url from 'url';
import { validateCompanionApiKey } from '../db.js';
import { AuthenticatedWebSocket } from './events/types.js';
import { handleGetChallenge, handleVerifyAttestation, handleAssertIdentity } from './events/challenge.js';
import { handleAuth, handleGetAuthStatus } from './events/companion.js';
import { handleInitiatePairing, handleAuthorizeCompanion, handleConfirmAuthorization, pairingSessions } from './events/pairing.js';

export function setupWebSocket(server: http.Server, redis: Redis): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const parsedUrl = url.parse(request.url || '', true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/ws') {
      let authVal = (parsedUrl.query.token as string) || (parsedUrl.query.apiKey as string) || '';
      if (!authVal) {
        authVal = (request.headers['x-companion-api-key'] as string) || '';
      }
      if (!authVal && request.headers['authorization']) {
        const authHeader = request.headers['authorization'] as string;
        if (authHeader.startsWith('Bearer ')) {
          authVal = authHeader.substring(7);
        }
      }

      let isAuthenticated = false;
      let authType = 'none';

      if (authVal) {
        if (authVal.startsWith('ws_auth_')) {
          const tokenKey = `ws_token:${authVal}`;
          const exists = await redis.exists(tokenKey);
          if (exists > 0) {
            await redis.del(tokenKey);
            isAuthenticated = true;
            authType = 'device_checked';
          }
        } else if (authVal.startsWith('ng_mac_') || authVal.startsWith('ng_mac_force_')) {
          const valid = await validateCompanionApiKey(authVal);
          if (valid) {
            isAuthenticated = true;
            authType = 'companion_or_manual_api';
          }
        }
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const authedWs = ws as AuthenticatedWebSocket;
        authedWs.isAuth = isAuthenticated;
        authedWs.authType = authType;
        authedWs.keyId = '';
        wss.emit('connection', authedWs, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const authedWs = ws as AuthenticatedWebSocket;
    console.log('Websocket client connected');

    authedWs.sendSuccess = (event: string, payload: any) => {
      if (authedWs.readyState === authedWs.OPEN) {
        authedWs.send(JSON.stringify({ event, payload }));
      }
    };

    authedWs.sendError = (event: string, message: string) => {
      if (authedWs.readyState === authedWs.OPEN) {
        authedWs.send(JSON.stringify({ event, payload: { status: 'failed', error: message } }));
      }
    };

    authedWs.on('message', async (message) => {
      let incoming: any;
      try {
        incoming = JSON.parse(message.toString());
      } catch (err) {
        console.error('Failed to parse WS message:', err);
        authedWs.sendError('error', 'Malformed JSON payload');
        return;
      }

      const { event, payload, clientTime } = incoming;
      const startTime = Date.now();
      console.log(`Received WS event: ${event}`);

      if (clientTime > 0) {
        const clientDate = new Date(clientTime);
        const serverDate = new Date(startTime);
        console.log(`[TIMING] Event: ${event} | Client Sent: ${clientDate.toISOString()} | Server Received: ${serverDate.toISOString()} | Transmission Time: ${startTime - clientTime}ms`);
      }

      try {
        switch (event) {
          case 'get_challenge':
            await handleGetChallenge(authedWs, redis);
            break;

          case 'verify_attestation':
            await handleVerifyAttestation(authedWs, payload, redis);
            break;

          case 'assert_identity':
            await handleAssertIdentity(authedWs, payload, redis);
            break;

          case 'auth':
            await handleAuth(authedWs, payload);
            break;

          case 'initiate_pairing':
            await handleInitiatePairing(authedWs, payload);
            break;

          case 'authorize_companion':
            await handleAuthorizeCompanion(authedWs, payload, redis);
            break;

          case 'confirm_authorization':
            await handleConfirmAuthorization(authedWs, payload, redis);
            break;

          case 'get_auth_status':
            handleGetAuthStatus(authedWs);
            break;

          default:
            authedWs.sendError(event, 'Unknown event');
            break;
        }
      } catch (err: any) {
        console.error(`Error processing event ${event}:`, err);
        authedWs.sendError(event, err.message);
      }

      const elapsed = Date.now() - startTime;
      console.log(`[TIMING] Event: ${event} | Server Process Time: ${elapsed}ms | Client Auth State: Authed=${authedWs.isAuth}, Type=${authedWs.authType}, KeyID=${authedWs.keyId}`);
    });

    authedWs.on('close', () => {
      console.log('Websocket client disconnected');
      // Clean up any pairing session registered by this closed socket
      for (const [sid, session] of pairingSessions.entries()) {
        if (session.ws === authedWs) {
          pairingSessions.delete(sid);
        }
      }
    });
  });
}
