import { describe, it, expect } from 'vitest';
import { computeStorageHealth, computeSyncHealth } from '../health-indicator';

describe('computeStorageHealth', () => {
  it('returns ok below 80%', () => {
    const result = computeStorageHealth(50, 50 * 1_048_576, 100 * 1_048_576, true);
    expect(result).toEqual({ level: 'ok', dot: 'ok', label: expect.any(String) });
    expect(result.level).toBe('ok');
    expect(result.dot).toBe('ok');
  });

  it('returns degraded at exactly 80%', () => {
    const result = computeStorageHealth(80, 80 * 1_048_576, 100 * 1_048_576, true);
    expect(result.level).toBe('degraded');
    expect(result.dot).toBe('warn');
  });

  it('returns degraded between 80-95%', () => {
    const result = computeStorageHealth(85, 85 * 1_048_576, 100 * 1_048_576, true);
    expect(result.level).toBe('degraded');
    expect(result.dot).toBe('warn');
  });

  it('returns error at 95% or above', () => {
    const result = computeStorageHealth(95, 95 * 1_048_576, 100 * 1_048_576, true);
    expect(result.level).toBe('error');
    expect(result.dot).toBe('err');
  });

  it('returns degraded when not persisted (below 80%)', () => {
    const result = computeStorageHealth(50, 50 * 1_048_576, 100 * 1_048_576, false);
    expect(result.level).toBe('degraded');
    expect(result.dot).toBe('warn');
  });

  it('label contains percent and MB values', () => {
    const result = computeStorageHealth(23.5, 23.5 * 1_048_576, 100 * 1_048_576, true);
    expect(result.label).toContain('23.5%');
    expect(result.label).toContain('MB');
  });

  it('label includes "not persisted" suffix when isPersisted=false', () => {
    const result = computeStorageHealth(10, 10 * 1_048_576, 100 * 1_048_576, false);
    expect(result.label).toContain('not persisted');
  });
});

describe('computeSyncHealth', () => {
  it('returns error when not alive', () => {
    const result = computeSyncHealth(false, 0, 0);
    expect(result).toEqual({ level: 'error', dot: 'err', label: 'Peer disconnected' });
  });

  it('returns ok when alive and no gaps', () => {
    const result = computeSyncHealth(true, 0, Date.now() - 5000);
    expect(result.level).toBe('ok');
    expect(result.dot).toBe('ok');
  });

  it('returns degraded when alive with gaps', () => {
    const result = computeSyncHealth(true, 3, Date.now() - 5000);
    expect(result.level).toBe('degraded');
    expect(result.dot).toBe('warn');
  });

  it('label mentions gap count', () => {
    const result = computeSyncHealth(true, 2, Date.now() - 5000);
    expect(result.label).toContain('2 gaps');
  });

  it('label mentions "1 gap" (singular)', () => {
    const result = computeSyncHealth(true, 1, Date.now() - 5000);
    expect(result.label).toContain('1 gap');
  });

  it('returns ok with dot=off when alive but no heartbeat ever received (lastReceivedAt=0)', () => {
    const result = computeSyncHealth(true, 0, 0);
    expect(result.dot).toBe('off');
    expect(result.level).toBe('ok');
  });
});
