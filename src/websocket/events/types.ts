import { WebSocket } from 'ws';

export interface AuthenticatedWebSocket extends WebSocket {
  isAuth: boolean;
  accountId?: string;
  deviceId?: string;
  ip?: string;
  sendSuccess(event: string, message: string, extraFields?: Record<string, unknown>): void;
  sendError(event: string, message: string): void;
}
