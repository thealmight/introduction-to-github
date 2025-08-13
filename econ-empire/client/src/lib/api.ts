import axios from 'axios';

const API_BASE_RAW = (import.meta as any).env?.VITE_API_BASE || '';
const API_BASE = API_BASE_RAW ? API_BASE_RAW.replace(/\/+$/, '') : '';

export const api = axios.create({ baseURL: API_BASE ? `${API_BASE}/api` : '/api' });

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

export async function getDashboard(gameId: number) {
  const res = await api.get(`/games/${gameId}/dashboard`);
  return res.data as {
    game: any; countries: any[]; products: any[]; rounds: any[];
    assignments: any[]; productions: any[]; demands: any[]; tariffs: any[];
  };
}

export async function getTariffChanges(gameId: number, round: number) {
  const res = await api.get(`/games/${gameId}/tariff-changes`, { params: { round } });
  return res.data as { round: number; changes: Array<{ product: string; fromCountry: string; toCountry: string; previous: number; current: number }>} ;
}

export async function getChat(gameId: number, since?: string) {
  const res = await api.get(`/games/${gameId}/chat`, { params: since ? { since } : {} });
  return res.data as Array<{ id: number; timestamp: string; sender: string; toCountry: string|null; content: string }>;
}

export async function sendChat(gameId: number, content: string, toCountryCode?: string) {
  const res = await api.post(`/games/${gameId}/chat`, { content, toCountryCode });
  return res.data as { id: number };
}

export async function downloadCsv(gameId: number, type: 'production'|'demand'|'tariffs'|'chat') {
  const res = await api.get(`/games/${gameId}/export/${type}.csv`, { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${type}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}