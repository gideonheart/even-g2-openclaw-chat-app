import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../events';

// Typed event map for tests
interface TestEventMap {
  'greet': { name: string };
  'count': { value: number };
  'empty': Record<string, never>;
}

describe('events – createEventBus', () => {
  it('on() subscribes and emit() calls handler with correct payload', () => {
    const bus = createEventBus<TestEventMap>();
    const handler = vi.fn();
    bus.on('greet', handler);

    bus.emit('greet', { name: 'Alice' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ name: 'Alice' });
  });

  it('on() returns unsubscribe function that removes the handler', () => {
    const bus = createEventBus<TestEventMap>();
    const handler = vi.fn();
    const unsub = bus.on('greet', handler);

    unsub();
    bus.emit('greet', { name: 'Bob' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('off() removes a specific handler', () => {
    const bus = createEventBus<TestEventMap>();
    const handler = vi.fn();
    bus.on('count', handler);

    bus.off('count', handler);
    bus.emit('count', { value: 42 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple handlers on the same event all fire', () => {
    const bus = createEventBus<TestEventMap>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    bus.on('greet', h1);
    bus.on('greet', h2);
    bus.on('greet', h3);

    bus.emit('greet', { name: 'Charlie' });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
    expect(h3).toHaveBeenCalledOnce();
  });

  it('emitting an event with no handlers does not throw', () => {
    const bus = createEventBus<TestEventMap>();

    expect(() => bus.emit('greet', { name: 'nobody' })).not.toThrow();
  });

  it('clear() removes all handlers for all events', () => {
    const bus = createEventBus<TestEventMap>();
    const greetHandler = vi.fn();
    const countHandler = vi.fn();
    bus.on('greet', greetHandler);
    bus.on('count', countHandler);

    bus.clear();
    bus.emit('greet', { name: 'Dave' });
    bus.emit('count', { value: 1 });

    expect(greetHandler).not.toHaveBeenCalled();
    expect(countHandler).not.toHaveBeenCalled();
  });

  it('listenerCount() returns correct count after add/remove', () => {
    const bus = createEventBus<TestEventMap>();

    expect(bus.listenerCount('greet')).toBe(0);

    const unsub1 = bus.on('greet', () => {});
    const unsub2 = bus.on('greet', () => {});
    expect(bus.listenerCount('greet')).toBe(2);

    unsub1();
    expect(bus.listenerCount('greet')).toBe(1);

    unsub2();
    expect(bus.listenerCount('greet')).toBe(0);
  });

  it('handler receives typed payload', () => {
    const bus = createEventBus<TestEventMap>();
    let receivedValue: number | undefined;

    bus.on('count', (payload) => {
      // TypeScript should infer payload as { value: number }
      receivedValue = payload.value;
    });

    bus.emit('count', { value: 99 });

    expect(receivedValue).toBe(99);
  });

  it('unsubscribe is idempotent (calling twice does not throw)', () => {
    const bus = createEventBus<TestEventMap>();
    const handler = vi.fn();
    const unsub = bus.on('greet', handler);

    unsub();
    expect(() => unsub()).not.toThrow();

    // Verify handler is still not called
    bus.emit('greet', { name: 'Eve' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('handlers for different events are independent', () => {
    const bus = createEventBus<TestEventMap>();
    const greetHandler = vi.fn();
    const countHandler = vi.fn();
    bus.on('greet', greetHandler);
    bus.on('count', countHandler);

    bus.emit('greet', { name: 'Frank' });

    expect(greetHandler).toHaveBeenCalledOnce();
    expect(countHandler).not.toHaveBeenCalled();
  });
});
