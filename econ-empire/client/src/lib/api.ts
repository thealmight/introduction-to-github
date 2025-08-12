import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

export async function login(username: string) {
  const res = await api.post('/login', { username });
  return res.data as { token: string; role: 'operator'|'player'; userId: number };
}

export async function createGame(params: { totalRounds: number; roundDurationSeconds: number }) {
  const res = await api.post('/games', params);
  return res.data as { gameId: number };
}

export async function startGame(gameId: number) {
  const res = await api.post(`/games/${gameId}/start`);
  return res.data;
}

export async function getGameState(gameId: number) {
  const res = await api.get(`/games/${gameId}/state`);
  return res.data as { gameState: string; currentRound: number|null; endsAt: string|null };
}

export async function assignCountry(gameId: number) {
  const res = await api.post(`/games/${gameId}/assign`);
  return res.data as { countryCode: string };
}

export async function getMyData(gameId: number) {
  const res = await api.get(`/games/${gameId}/my-data`);
  return res.data;
}

export async function submitTariffs(gameId: number, roundId: number, items: Array<{productCode: string; toCountryCode: string; ratePercent: number;}>) {
  const res = await api.post(`/games/${gameId}/rounds/${roundId}/tariffs`, items);
  return res.data;
}