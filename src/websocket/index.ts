import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { Redis } from 'ioredis';
import url from 'url';
import { AuthenticatedWebSocket } from './events/types.js';
import { routeWSEvent } from './router.js';

export const connections = new Map<string, AuthenticatedWebSocket>();

export function setupWebSocket(server: http.Server, redis: Redis): void {
  const wss = new WebSocketServer({ noServer: true });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const c = ws as any;
      if (c._alive === false) { c.terminate(); return; }
      c._alive = false;
      c.ping();
    });
  }, 30_000);
  interval.unref();

  
server.on('upgrade', async (request, socket, head) => {
    const parsedUrl = url.parse(request.url || '', true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/ws') {
      const ip = (request.headers['x-forwarded-for'] as string) || request.socket.remoteAddress || 'unknown';

      wss.handleUpgrade(request, socket, head, (ws) => {
        const authedWs = ws as AuthenticatedWebSocket;
        
        authedWs.isAuth = false; 
        authedWs.accountId = undefined;
        authedWs.deviceId = undefined;
        authedWs.ip = ip;
        
        wss.emit('connection', authedWs, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws: WebSocket) => {
    const authedWs = ws as AuthenticatedWebSocket;
    console.log('Websocket client connected');
    (authedWs as any)._alive = true;

    authedWs.on('pong', () => {
      (authedWs as any)._alive = true;
    });

    authedWs.sendSuccess = (event: string, message: string, extraFields?: Record<string, unknown>) => {
      if (authedWs.readyState === authedWs.OPEN) {
        const payload: any = { status: 'success', data: message };
        if (extraFields) {
          Object.assign(payload, extraFields);
        }
        authedWs.send(JSON.stringify({ event, payload }));
      }
    };

    authedWs.sendError = (event: string, message: string) => {
      if (authedWs.readyState === authedWs.OPEN) {
        authedWs.send(JSON.stringify({ event, payload: { status: 'failed', error: message } }));
      }
    };

    const challenge = crypto.randomUUID(); 
    
    await redis.set(`challenge:${challenge}`, 'valid', 'EX', 30);

    if (authedWs.readyState === authedWs.OPEN) {
      authedWs.send(JSON.stringify({
        event: 'auth_challenge',
        payload: { challenge }
      }));
    }

    authedWs.on('message', async (message) => {
      let incoming: any;
      try {
        incoming = JSON.parse(message.toString());
      } catch (err) {
        console.error('Failed to parse WS message:', err);
        authedWs.sendError('error', 'Malformed JSON payload');
        return;
      }

      const { event, payload } = incoming;
      console.log(`Received WS event: ${event}`);

      try {
        await routeWSEvent(event, payload, authedWs, redis, wss);
      } catch (err: any) {
        console.error(`Error processing event ${event}:`, err);
        authedWs.sendError(event, err.message);
      }
    });

    authedWs.on('close', () => {
      console.log('Websocket client disconnected');
      if (authedWs.deviceId) {
        connections.delete(authedWs.deviceId);
      }
    });
  });
}
