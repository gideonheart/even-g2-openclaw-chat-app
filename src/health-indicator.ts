// ── Health indicator pure functions ─────────────────────────
// No DOM, no bus, no project imports — pure data computation.

export type HealthLevel = 'ok' | 'degraded' | 'error';

export interface StorageHealthSnapshot {
  level: HealthLevel;
  label: string;
  dot: 'ok' | 'warn' | 'err' | 'off';
}

export interface SyncHealthSnapshot {
  level: HealthLevel;
  label: string;
  dot: 'ok' | 'warn' | 'err' | 'off';
}

export function computeStorageHealth(
  usagePercent: number,
  usageBytes: number,
  quotaBytes: number,
  isPersisted: boolean,
): StorageHealthSnapshot {
  const pct = usagePercent.toFixed(1);
  const usedMb = (usageBytes / 1_048_576).toFixed(1);
  const quotaMb = (quotaBytes / 1_048_576).toFixed(1);
  const base = `${pct}% used (${usedMb} MB / ${quotaMb} MB)`;
  const suffix = isPersisted ? '' : ' \u2014 not persisted';
  if (usagePercent >= 95) return { level: 'error', label: base + suffix, dot: 'err' };
  if (usagePercent >= 80 || !isPersisted) return { level: 'degraded', label: base + suffix, dot: 'warn' };
  return { level: 'ok', label: base, dot: 'ok' };
}

export function computeSyncHealth(
  isAlive: boolean,
  heartbeatGaps: number,
  lastReceivedAt: number,
): SyncHealthSnapshot {
  if (!isAlive) return { level: 'error', label: 'Peer disconnected', dot: 'err' };
  const gapStr = heartbeatGaps > 0
    ? ` \u00b7 ${heartbeatGaps} gap${heartbeatGaps > 1 ? 's' : ''}`
    : '';
  const lastSeen = lastReceivedAt > 0
    ? `Last heartbeat ${Math.round((Date.now() - lastReceivedAt) / 1000)}s ago`
    : 'Waiting for peer';
  const dot: 'ok' | 'warn' | 'err' | 'off' = heartbeatGaps > 0
    ? 'warn'
    : (lastReceivedAt > 0 ? 'ok' : 'off');
  const level: HealthLevel = heartbeatGaps > 0 ? 'degraded' : 'ok';
  return { level, label: lastSeen + gapStr, dot };
}
