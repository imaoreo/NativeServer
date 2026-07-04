import { WebSocket } from 'ws';

export interface AuthenticatedWebSocket extends WebSocket {
  isAuth: boolean;
  authType: string;
  keyId: string;
  sendSuccess(event: string, payload: any): void;
  sendError(event: string, message: string): void;
}

export interface PairingSession {
  ws: WebSocket;
  wantLogin: boolean;
}
