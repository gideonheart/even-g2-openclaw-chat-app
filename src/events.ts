// ── Typed event bus ─────────────────────────────────────────

export type EventHandler<T> = (payload: T) => void;

/**
 * Creates a lightweight typed event bus using the closure/factory pattern.
 * Synchronous dispatch only -- no external dependencies.
 *
 * Usage:
 *   const bus = createEventBus<AppEventMap>();
 *   const unsub = bus.on('bridge:connected', (p) => console.log(p.deviceName));
 *   bus.emit('bridge:connected', { deviceName: 'Even G2' });
 *   unsub(); // unsubscribe
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function createEventBus<TMap extends {}>() {
  const handlers = new Map<keyof TMap, Set<EventHandler<never>>>();

  function getSet<K extends keyof TMap>(event: K): Set<EventHandler<never>> {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    return set;
  }

  function on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): () => void {
    const set = getSet(event);
    set.add(handler as EventHandler<never>);
    let removed = false;
    return () => {
      if (removed) return; // idempotent unsubscribe
      removed = true;
      set.delete(handler as EventHandler<never>);
    };
  }

  function emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as EventHandler<TMap[K]>)(payload);
    }
  }

  function off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    const set = handlers.get(event);
    if (!set) return;
    set.delete(handler as EventHandler<never>);
  }

  function clear(): void {
    handlers.clear();
  }

  function listenerCount<K extends keyof TMap>(event: K): number {
    const set = handlers.get(event);
    return set ? set.size : 0;
  }

  return { on, emit, off, clear, listenerCount };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type EventBus<TMap extends {}> = ReturnType<typeof createEventBus<TMap>>;
