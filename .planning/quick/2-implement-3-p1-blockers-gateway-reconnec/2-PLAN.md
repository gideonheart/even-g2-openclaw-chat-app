---
phase: quick-2
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/events.ts
  - src/__tests__/events.test.ts
  - src/api/gateway-client.ts
  - src/__tests__/gateway-client.test.ts
  - src/main.ts
  - src/app-wiring.ts
  - src/__tests__/app-wiring.test.ts
  - src/types.ts
autonomous: true
requirements: [BRDG-01, API-03]
must_haves:
  truths:
    - "Event bus dispatches typed events to subscribers and unsubscribe works"
    - "Gateway client retries sendVoiceTurn on transient failure with exponential backoff"
    - "Gateway client gives up after maxReconnectAttempts and sets status to error"
    - "Core app wiring functions (show, filterLogs, connectGlasses, addLog) are testable in isolation"
  artifacts:
    - path: "src/events.ts"
      provides: "Typed event bus with subscribe/publish/unsubscribe"
      exports: ["createEventBus", "EventBus", "AppEventMap"]
    - path: "src/__tests__/events.test.ts"
      provides: "Event bus test suite"
      min_lines: 50
    - path: "src/api/gateway-client.ts"
      provides: "Gateway client with working reconnection"
      contains: "sendVoiceTurn"
    - path: "src/app-wiring.ts"
      provides: "Extracted testable app functions from main.ts"
      exports: ["filterLogs", "connectGlasses", "disconnectGlasses"]
    - path: "src/__tests__/app-wiring.test.ts"
      provides: "Tests for extracted main.ts logic"
      min_lines: 40
  key_links:
    - from: "src/events.ts"
      to: "src/types.ts"
      via: "AppEventMap type definition"
      pattern: "AppEventMap"
    - from: "src/api/gateway-client.ts"
      to: "sendVoiceTurn"
      via: "recursive retry loop"
      pattern: "sendVoiceTurn.*settings.*request"
---

<objective>
Fix 3 P1 blockers identified in quick-task-1 review before Phase 2 begins:
1. Create a lightweight typed event bus for inter-module communication
2. Make gateway reconnect actually retry instead of being a no-op
3. Extract testable logic from main.ts monolith and add targeted tests

Purpose: Phase 2 (Even Bridge & Input Pipeline) requires a working event bus for bridge/gesture/audio communication, reliable gateway reconnection for voice turns, and testable app wiring so refactoring has a safety net.
Output: 3 new/modified modules with test coverage, committed in logical steps.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/api/gateway-client.ts
@src/main.ts
@src/types.ts
@src/__tests__/gateway-client.test.ts
@src/logs.ts
@src/settings.ts
@src/utils.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create typed event bus module</name>
  <files>src/events.ts, src/__tests__/events.test.ts, src/types.ts</files>
  <action>
Create `src/events.ts` with a `createEventBus<TMap>()` factory function using the closure pattern (matches existing codebase style -- see `createLogStore`, `createGatewayClient`).

**In `src/types.ts`, add the event map interface:**
```typescript
export interface AppEventMap {
  'bridge:connected': { deviceName: string };
  'bridge:disconnected': { reason: string };
  'gesture:tap': { timestamp: number };
  'gesture:double-tap': { timestamp: number };
  'gesture:scroll-up': { timestamp: number };
  'gesture:scroll-down': { timestamp: number };
  'audio:recording-start': { sessionId: string };
  'audio:recording-stop': { sessionId: string; blob: Blob };
  'gateway:status': { status: ConnectionStatus };
  'gateway:chunk': VoiceTurnChunk;
  'log': { level: LogLevel; msg: string; cid?: string };
}
```

**In `src/events.ts`, implement:**
```typescript
export type EventHandler<T> = (payload: T) => void;

export function createEventBus<TMap extends Record<string, unknown>>() {
  // Use a Map<string, Set<EventHandler>> internally
  // Methods:
  //   on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): () => void
  //     - Returns unsubscribe function (matches gateway client pattern)
  //   emit<K extends keyof TMap>(event: K, payload: TMap[K]): void
  //     - Calls all handlers for event synchronously
  //   off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void
  //     - Removes specific handler
  //   clear(): void
  //     - Removes all handlers for all events
  //   listenerCount<K extends keyof TMap>(event: K): number
  //     - Returns number of handlers for event (useful for diagnostics)
  return { on, emit, off, clear, listenerCount };
}

export type EventBus<TMap extends Record<string, unknown>> = ReturnType<typeof createEventBus<TMap>>;
```

Key constraints:
- No external dependencies (zero new packages)
- Synchronous dispatch only (async not needed for UI events)
- The `on()` return value is the unsubscribe function (same pattern as `onChunk`/`onStatusChange` in gateway-client.ts)
- Do NOT add wildcard/glob matching -- keep it simple for now

**In `src/__tests__/events.test.ts`, write tests for:**
1. `on()` subscribes and `emit()` calls handler with correct payload
2. `on()` returns unsubscribe function that removes the handler
3. `off()` removes a specific handler
4. Multiple handlers on same event all fire
5. Emitting an event with no handlers does not throw
6. `clear()` removes all handlers
7. `listenerCount()` returns correct count after add/remove
8. Handler receives typed payload (test with a typed event map in the test)
9. Unsubscribe is idempotent (calling twice does not throw)

Commit message: `feat(events): add typed event bus module with tests`
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/events.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
    - `src/events.ts` exports `createEventBus` factory
    - `src/types.ts` exports `AppEventMap` interface
    - All event bus tests pass (9+ tests)
    - `tsc --noEmit` passes with no errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Fix gateway reconnect no-op -- implement actual retry</name>
  <files>src/api/gateway-client.ts, src/__tests__/gateway-client.test.ts</files>
  <action>
Fix the no-op reconnect logic in `sendVoiceTurn` (lines 253-263 of `src/api/gateway-client.ts`). Currently the catch block waits with exponential backoff but never retries. The comment says "Caller should retry" but no caller does.

**Implementation approach -- recursive retry inside sendVoiceTurn:**

Replace the catch block (lines 245-263) with:

```typescript
} catch (err: unknown) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return; // Intentional cancellation
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  emitChunk({ type: 'error', error: message });

  // Auto-reconnect with exponential backoff
  if (health.reconnectAttempts < opts.maxReconnectAttempts) {
    health.reconnectAttempts++;
    setStatus('connecting');
    const delay = opts.reconnectBaseDelayMs * Math.pow(2, health.reconnectAttempts - 1);
    await new Promise((r) => setTimeout(r, delay));
    // Actually retry the request (recursive call)
    return sendVoiceTurn(settings, request);
  } else {
    setStatus('error');
  }
}
```

Key differences from current code:
- Line `return sendVoiceTurn(settings, request);` is the actual fix -- replaces the comment-only no-op
- On success (line 197), `health.reconnectAttempts = 0` already resets -- this is correct
- AbortError still returns early (no retry on intentional cancel)
- Each retry creates a fresh `AbortController` because `abort()` is called at line 167

Also fix the SSE parser to handle `\r\n` line endings (P3 but trivial):
- Line 16: change `raw.split('\n')` to `raw.split(/\r?\n/)`

**In `src/__tests__/gateway-client.test.ts`, add these test cases:**

Create a `describe('sendVoiceTurn', ...)` block using `vi.stubGlobal('fetch', ...)` to mock fetch:

1. **Successful voice turn**: Mock fetch returning 200 with a ReadableStream containing SSE data. Verify `onChunk` receives parsed chunks in order and status transitions to `connected`.

2. **Retry on network error**: Mock fetch to reject first call (network error), succeed on second call. Use `{ maxReconnectAttempts: 3, reconnectBaseDelayMs: 10 }` (fast tests). Verify:
   - Status goes to `connecting` during retry
   - `reconnectAttempts` increments
   - Second call succeeds and status becomes `connected`
   - `reconnectAttempts` resets to 0

3. **Gives up after max attempts**: Mock fetch to always reject. Set `maxReconnectAttempts: 2, reconnectBaseDelayMs: 10`. Verify:
   - Status ends at `error`
   - Error chunks are emitted for each attempt
   - Total attempts = maxReconnectAttempts (2)

4. **No retry on AbortError**: Mock fetch to reject with `new DOMException('Aborted', 'AbortError')`. Verify no retry occurs and no error chunk is emitted.

5. **SSE parser handles \\r\\n**: Add test `parseSSELines('data: hello\\r\\n\\r\\n')` returns event with data `'hello'` (no trailing \\r).

Helper for creating a mock ReadableStream of SSE data:
```typescript
function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(evt));
      }
      controller.close();
    },
  });
}
```

Use `vi.useFakeTimers()` for backoff delay tests, advancing time with `vi.advanceTimersByTimeAsync()` to avoid real waits. Alternatively, use `reconnectBaseDelayMs: 1` for minimal real delays since tests are fast enough.

Commit message: `fix(gateway): implement actual reconnect retry with exponential backoff`
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
    - `sendVoiceTurn` actually retries on transient failure (recursive call after backoff)
    - After `maxReconnectAttempts` failures, status is `error` and no more retries
    - AbortError does not trigger retry
    - SSE parser handles `\r\n` line endings
    - All existing gateway-client tests still pass
    - 5+ new tests pass for sendVoiceTurn and reconnection behavior
    - `tsc --noEmit` passes
  </done>
</task>

<task type="auto">
  <name>Task 3: Extract testable wiring from main.ts and add targeted tests</name>
  <files>src/app-wiring.ts, src/__tests__/app-wiring.test.ts, src/main.ts</files>
  <action>
Extract the pure/testable logic from `src/main.ts` into `src/app-wiring.ts`, leaving `main.ts` as a thin init shell that wires DOM events to the extracted functions.

**Create `src/app-wiring.ts` with these extracted functions:**

1. **`createAppState(settings: AppSettings)`** -- Factory that returns the mutable app state object:
   ```typescript
   export function createAppState(initialSettings: AppSettings) {
     return {
       settings: initialSettings,
       glassesConnected: false,
       activeSession: 'gideon',
       currentLogFilter: 'all' as LogLevel | 'all',
       pendingConfirm: null as (() => void) | null,
       currentEditField: null as string | null,
     };
   }
   export type AppState = ReturnType<typeof createAppState>;
   ```

2. **`connectGlasses(state: AppState, logFn: LogFn)`** -- Sets `glassesConnected = true`, calls logFn. Returns updated state fields (no DOM access).
   ```typescript
   export type LogFn = (level: LogLevel, msg: string, cid?: string | null) => void;

   export function connectGlasses(state: AppState, log: LogFn): { connected: true; battery: string } {
     state.glassesConnected = true;
     log('info', 'Glasses connected (mock)', 'conn-' + Date.now());
     return { connected: true, battery: '87 %' };
   }
   ```

3. **`disconnectGlasses(state: AppState, logFn: LogFn)`** -- Sets `glassesConnected = false`, calls logFn. Returns updated state.

4. **`switchSession(state: AppState, sessionId: string, log: LogFn)`** -- Validates session exists via `findSession()`, returns `{ switched: true, session }` or `{ switched: false, reason: string }`. Does NOT touch DOM.

5. **`resolveLogFilter(filter: LogLevel | 'all', logStore: LogStore)`** -- Returns filtered log entries. Pure function wrapping `logStore.filter()`.

6. **`buildSettingsViewModel(settings: AppSettings)`** -- Returns display-ready values for all settings fields (masked secrets, truncated URLs, STT labels). Pure function.
   ```typescript
   export function buildSettingsViewModel(settings: AppSettings) {
     return {
       gatewayDisplay: settings.gatewayUrl ? truncate(settings.gatewayUrl, 30) : 'Not set',
       sessionKeyDisplay: maskSecret(settings.sessionKey),
       sttDisplay: STT_LABELS[settings.sttProvider] || settings.sttProvider,
       apiKeyDisplay: maskSecret(settings.apiKey),
     };
   }
   ```

7. **`buildHealthViewModel(settings: AppSettings, activeSession: string)`** -- Returns health dot states and status text. Pure function.

**Update `src/main.ts`:**
- Add `import { createAppState, connectGlasses, disconnectGlasses, switchSession, buildSettingsViewModel, buildHealthViewModel } from './app-wiring';`
- Replace the 7 module-level variables (lines 17-23) with `const appState = createAppState(loadSettings());`
- Update `connectGlasses()` and `disconnectGlasses()` functions to call the extracted versions and apply the return value to DOM
- Update `refreshSettingsDisplay()` to call `buildSettingsViewModel()` and apply to DOM
- Update `refreshHealthDisplay()` to call `buildHealthViewModel()` and apply to DOM
- Keep all DOM manipulation in `main.ts` -- only pure logic moves to `app-wiring.ts`

The goal is surgical extraction: main.ts shrinks by ~50 lines, app-wiring.ts gets ~80-100 lines of testable pure functions. Do NOT attempt a full rewrite of main.ts.

**In `src/__tests__/app-wiring.test.ts`, write tests for:**

1. `createAppState` returns correct defaults
2. `connectGlasses` sets state.glassesConnected to true and calls log
3. `disconnectGlasses` sets state.glassesConnected to false and calls log
4. `switchSession` with valid session ID returns `{ switched: true }`
5. `switchSession` with invalid session ID returns `{ switched: false }`
6. `switchSession` with same-as-current session returns `{ switched: false }`
7. `buildSettingsViewModel` masks secrets and truncates URLs
8. `buildSettingsViewModel` shows 'Not set' for empty gateway URL
9. `buildHealthViewModel` returns correct dot states for configured vs unconfigured
10. `resolveLogFilter` delegates to logStore.filter correctly

Use a mock logFn: `const logs: Array<[LogLevel, string]> = []; const logFn: LogFn = (level, msg) => logs.push([level, msg]);`

Commit message: `refactor(main): extract testable app-wiring from main.ts with tests`
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/app-wiring.test.ts && npx vitest run && npx tsc --noEmit</automated>
  </verify>
  <done>
    - `src/app-wiring.ts` exists with exported pure functions
    - `src/main.ts` imports and delegates to app-wiring functions
    - All app-wiring tests pass (10+ tests)
    - All existing tests still pass (67+ tests total)
    - `tsc --noEmit` passes
    - main.ts still boots correctly (no behavioral change)
  </done>
</task>

</tasks>

<verification>
After all 3 tasks complete:
1. `npx vitest run` -- all test suites pass (events, gateway-client, app-wiring + existing 5 suites)
2. `npx tsc --noEmit` -- zero TypeScript errors
3. New test count: 67 (existing) + ~9 (events) + ~5 (gateway) + ~10 (app-wiring) = ~91 tests
</verification>

<success_criteria>
- Event bus module exists at `src/events.ts` with typed `createEventBus<AppEventMap>()` factory
- Gateway client `sendVoiceTurn` actually retries on transient network failure with exponential backoff
- Gateway client gives up after `maxReconnectAttempts` and transitions to `error` status
- Pure app logic extracted from main.ts into `src/app-wiring.ts` with test coverage
- All tests pass: `npx vitest run` exits 0
- TypeScript clean: `npx tsc --noEmit` exits 0
- 3 logical commits (one per P1 item)
</success_criteria>

<output>
After completion, create `.planning/quick/2-implement-3-p1-blockers-gateway-reconnec/2-SUMMARY.md`
</output>
