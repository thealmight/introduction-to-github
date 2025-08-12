import { create } from 'zustand';

type Role = 'operator'|'player'|null;

interface AppState {
  token: string | null;
  role: Role;
  userId: number | null;
  gameId: number | null;
  roundId: number | null;
  setAuth: (t: string|null, r: Role, u: number|null) => void;
  setGame: (g: number|null) => void;
  setRound: (r: number|null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  token: null,
  role: null,
  userId: null,
  gameId: null,
  roundId: null,
  setAuth: (token, role, userId) => set({ token, role, userId }),
  setGame: (gameId) => set({ gameId }),
  setRound: (roundId) => set({ roundId }),
}));