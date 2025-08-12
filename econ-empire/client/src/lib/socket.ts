import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    socket = io('/', { transports: ['websocket'] });
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