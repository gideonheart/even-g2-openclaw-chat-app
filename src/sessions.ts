import type { Session } from './types';

// ── Demo sessions ────────────────────────────────────────────

export const SESSIONS: Session[] = [
  { id: 'gideon', name: 'Gideon', desc: 'Coding assistant' },
  { id: 'atlas', name: 'Atlas', desc: 'Research agent' },
  { id: 'helper', name: 'Helper', desc: 'General assistant' },
];

// ── Session operations ───────────────────────────────────────

export function findSession(sessionId: string): Session | undefined {
  return SESSIONS.find((s) => s.id === sessionId);
}

export function isActiveSession(
  sessionId: string,
  activeId: string,
): boolean {
  return sessionId === activeId;
}
