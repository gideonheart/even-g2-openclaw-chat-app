// ── Tests for mock bridge keyboard shortcuts ────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEventBus } from '../events';
import type { AppEventMap } from '../types';
import { createBridgeMock } from '../bridge/bridge-mock';

describe('BridgeMock', () => {
  let bus: ReturnType<typeof createEventBus<AppEventMap>>;
  let service: Awaited<ReturnType<typeof createBridgeMock>>;

  beforeEach(async () => {
    bus = createEventBus<AppEventMap>();
    service = createBridgeMock(bus);
    await service.init();
  });

  afterEach(async () => {
    await service.destroy();
  });

  function dispatchKey(key: string): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  }

  it('emits gesture:tap on spacebar', () => {
    const handler = vi.fn();
    bus.on('gesture:tap', handler);

    dispatchKey(' ');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toHaveProperty('timestamp');
  });

  it('emits gesture:double-tap on "d" key', () => {
    const handler = vi.fn();
    bus.on('gesture:double-tap', handler);

    dispatchKey('d');

    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits gesture:scroll-up on ArrowUp key', () => {
    const handler = vi.fn();
    bus.on('gesture:scroll-up', handler);

    dispatchKey('ArrowUp');

    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits gesture:scroll-down on ArrowDown key', () => {
    const handler = vi.fn();
    bus.on('gesture:scroll-down', handler);

    dispatchKey('ArrowDown');

    expect(handler).toHaveBeenCalledOnce();
  });

  it('ignores unrecognized keys', () => {
    const tapHandler = vi.fn();
    const dtHandler = vi.fn();
    bus.on('gesture:tap', tapHandler);
    bus.on('gesture:double-tap', dtHandler);

    dispatchKey('x');
    dispatchKey('Enter');

    expect(tapHandler).not.toHaveBeenCalled();
    expect(dtHandler).not.toHaveBeenCalled();
  });

  it('stops emitting after destroy()', async () => {
    const handler = vi.fn();
    bus.on('gesture:tap', handler);

    await service.destroy();
    dispatchKey(' ');

    expect(handler).not.toHaveBeenCalled();
  });

  it('startAudio() returns true (no-op)', async () => {
    expect(await service.startAudio()).toBe(true);
  });

  it('stopAudio() returns true (no-op)', async () => {
    expect(await service.stopAudio()).toBe(true);
  });
});
