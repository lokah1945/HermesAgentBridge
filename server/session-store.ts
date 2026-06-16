import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(process.cwd(), 'data', 'sessions.json');

export interface SessionStore {
  [sessionId: string]: {
    id: string;
    workspace: any;
    profile: string;
    history: Array<{ role: string; content: string }>;
    createdAt: number;
    updatedAt: number;
    pendingStep?: {
      stepId: string;
      action: string;
      target: string;
      after: string;
    };
  };
}

export function loadSessions(): SessionStore {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveSession(id: string, data: any): void {
  const store = loadSessions();
  if (data && Array.isArray(data.history)) {
    if (data.history.length > 10) {
      data.history = data.history.slice(-10);
    }
  }
  store[id] = { ...data, updatedAt: Date.now() };
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getSession(id: string): any | null {
  return loadSessions()[id] ?? null;
}

export function deleteSession(id: string): void {
  const store = loadSessions();
  delete store[id];
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function cleanOldSessions(ttlMinutes = 60): void {
  const store = loadSessions();
  const cutoff = Date.now() - ttlMinutes * 60 * 1000;
  let changed = false;
  for (const id in store) {
    if (store[id].updatedAt < cutoff) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}
