import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    const API_BASE_RAW = (import.meta as any).env?.VITE_API_BASE || '';
    const WS_BASE_RAW = (import.meta as any).env?.VITE_WS_BASE || '';
    const API_BASE = API_BASE_RAW ? API_BASE_RAW.replace(/\/+$/, '') : '';
    const WS_BASE = WS_BASE_RAW ? WS_BASE_RAW.replace(/\/+$/, '') : '';
    const base = WS_BASE || API_BASE || '/';
    socket = io(base, { transports: ['websocket'] });
  }
  return socket;
}

export function joinGameRoom(gameId: number) {
  const s = getSocket();
  s.emit('presence:join', { gameId });
}

export function leaveGameRoom(gameId: number) {
  const s = getSocket();
  s.emit('presence:leave', { gameId });
}