# Phase 17: FSM & Gateway Resilience - Research

**Researched:** 2026-03-01
**Domain:** Finite state machine watchdog timer, gateway error classification (connection vs mid-stream), receivedAnyData flag, fsm:watchdog-reset event type
**Confidence:** HIGH

## Summary

Phase 17 addresses two related problems: (1) the gesture FSM can get stuck in transient states (`recording`, `sent`, `thinking`) indefinitely if an error path fails to emit a `reset` signal, and (2) the gateway client retries mid-stream failures identically to connection failures, causing duplicate backend requests and lost partial responses.

The FSM watchdog is a straightforward `setTimeout` pattern that fires after 45 seconds in any transient state and forces a reset to `idle`. The gateway error classification requires adding a `receivedAnyData` boolean flag inside `streamSSEResponse()` that is set to `true` when any SSE chunk is parsed. When the reader throws after receiving data, the error is classified as "mid-stream" and NOT auto-retried. When the reader throws (or `fetch` rejects) before any data arrives, the error is classified as "connection" and retried normally.

Both features require zero new runtime dependencies. The FSM watchdog adds a single `setTimeout`/`clearTimeout` pair. The gateway error classification modifies existing `handleTurnError()` logic by adding a `receivedAnyData` parameter. The only new AppEventMap event type is `fsm:watchdog-reset` (completing the RES-20 FSM events subset).

**Primary recommendation:** Implement the FSM watchdog as a new concern within `gesture-handler.ts` (co-located with existing FSM driving logic). Implement gateway error classification by adding a `receivedAnyData` flag to `streamSSEResponse()` and threading it through to `handleTurnError()`. Both changes are additive -- they wrap existing behavior without modifying the core FSM pure function or the SSE parsing logic.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RES-13 | FSM watchdog timer: 45-second timeout for any transient state (recording, sent, thinking). Auto-reset to idle if no transition fires. Emit fsm:watchdog-reset event. | Watchdog timer pattern documented. Integration point is `gesture-handler.ts` where FSM state changes happen. Timer starts on entering transient states, clears on any state transition. Uses existing `handleInput('reset', ...)` for recovery. |
| RES-14 | Gateway error classification: distinguish connection errors (safe to auto-retry) from mid-stream errors (show partial response, prompt user). Add `receivedAnyData` flag in `streamSSEResponse`. Do NOT auto-retry mid-stream failures (Pitfall P7). | Error classification pattern documented. `receivedAnyData` flag set inside `streamSSEResponse()`. Threaded to `handleTurnError()` via catch block context. Mid-stream errors emit error chunk with "Response interrupted" message. Connection errors retain existing retry logic. |
| RES-20 (fsm events only) | Add `fsm:watchdog-reset` event type to `src/types.ts` AppEventMap. Additive, no breaking changes. | Single new event type: `{ previousState: string; elapsed: number }`. Added alongside existing Phase 14 and Phase 16 event types already in AppEventMap. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native `setTimeout`/`clearTimeout` | Browser built-in | FSM watchdog timer, timeout detection | Already used throughout codebase (settle timer in display-controller.ts, turn timeout in gateway-client.ts). Zero bundle cost. |
| Native `AbortController`/`AbortSignal` | Browser built-in | Gateway request lifecycle management | Already used in `gateway-client.ts` for turn timeout. No changes needed to abort mechanism. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | ^3.0 (already installed) | Testing watchdog timer with `vi.useFakeTimers()`, testing error classification with mock fetch | All unit tests for this phase. Existing gateway-client.test.ts provides exact test patterns. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| setTimeout-based watchdog | FSM state timeout as a new state property | Over-engineers the pure FSM. The watchdog is an external safety net, not FSM logic. Keeping it separate preserves the pure-function nature of `gesture-fsm.ts`. |
| Manual `receivedAnyData` flag | ReadableStream byte count tracking | Byte counting is more complex, provides no additional benefit. A boolean flag is sufficient to distinguish "got any response" from "got nothing". |
| Error type parameter in `handleTurnError` | Separate error handler functions per error type | Current single `handleTurnError` is clean. Adding a single parameter is simpler than splitting into multiple functions. |

### Installation

```bash
# No new dependencies. Zero changes to package.json.
```

## Architecture Patterns

### Recommended Module Changes

```
src/
  gestures/
    gesture-handler.ts   # MODIFIED: add watchdog timer logic
    gesture-fsm.ts       # UNCHANGED: pure function stays pure
  api/
    gateway-client.ts    # MODIFIED: add receivedAnyData flag, error classification
  types.ts               # MODIFIED: add fsm:watchdog-reset to AppEventMap
```

### Pattern 1: FSM Watchdog Timer (External Safety Net)

**What:** A `setTimeout` that fires after 45 seconds in any transient FSM state (`recording`, `sent`, `thinking`), forcing a reset to `idle`.

**When to use:** Any time the gesture handler transitions to a transient state. The timer is cleared whenever any state transition occurs (including the watchdog reset itself).

**Why external to FSM:** The gesture FSM (`gesture-fsm.ts`) is a pure function with zero side effects, zero imports, and zero timers. Adding timeout logic would break this property. The watchdog belongs in `gesture-handler.ts` where side effects are already managed (bus subscriptions, bridge calls, audio capture).

**Integration point:**

```typescript
// In gesture-handler.ts, alongside the existing handleInput function:
const WATCHDOG_MS = 45_000;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function startWatchdog(fromState: GestureState): void {
  clearWatchdog();
  // Only watch transient states -- idle and menu are stable
  if (fromState === 'recording' || fromState === 'sent' || fromState === 'thinking') {
    watchdogTimer = setTimeout(() => {
      const elapsed = WATCHDOG_MS;
      const previousState = state;  // capture before reset
      bus.emit('fsm:watchdog-reset', { previousState, elapsed });
      bus.emit('log', {
        level: 'warn',
        msg: `FSM watchdog: stuck in ${previousState} for ${elapsed / 1000}s, resetting`,
      });
      handleInput('reset', Date.now());
    }, WATCHDOG_MS);
  }
}

function clearWatchdog(): void {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

// Modified handleInput:
function handleInput(input: GestureInput, timestamp: number): void {
  // ... existing debounce logic ...
  const transition = gestureTransition(state, input);
  state = transition.nextState;

  // Watchdog: restart on every state change, clear if returning to stable state
  startWatchdog(state);

  if (transition.action !== null) {
    dispatchAction(transition.action);
  }
}
```

**Key invariant:** `startWatchdog()` is called after every state transition. If the new state is idle or menu (stable), the timer is not set. If the new state is transient, a fresh 45-second timer begins. This means the watchdog resets on EVERY transition -- if the user taps during recording, the watchdog for `sent` starts fresh.

**Cleanup:** `clearWatchdog()` must be called in `destroy()` to prevent dangling timers.

### Pattern 2: Gateway Error Classification (receivedAnyData Flag)

**What:** A boolean flag inside `streamSSEResponse()` that tracks whether any SSE data has been successfully parsed. This flag is used to classify errors in the catch block of `sendVoiceTurn`/`sendTextTurn`.

**When to use:** Every time the SSE response reader processes chunks. The flag is checked when an error occurs during streaming.

**Three error categories (from Pitfall P7):**

1. **Connection error** (`fetch` rejects before response, or response is not ok): Safe to auto-retry with backoff. This is the existing behavior.
2. **Mid-stream error** (reader throws after `receivedAnyData === true`): NOT safe to auto-retry. Show partial response, prompt user. The partial response is already saved by auto-save's RES-08 error handler.
3. **Timeout/Abort** (existing handling): Not changed.

**Integration point:**

```typescript
// In gateway-client.ts, modified streamSSEResponse:
async function streamSSEResponse(
  resp: Response,
  timeoutId: ReturnType<typeof setTimeout>,
): Promise<{ receivedAnyData: boolean }> {
  const reader = resp.body?.getReader();
  if (!reader) {
    emitChunk({ type: 'error', error: 'No response body stream' });
    return { receivedAnyData: false };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let receivedAnyData = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    receivedAnyData = true;

    // ... existing SSE parsing logic unchanged ...
  }

  // ... existing buffer flush logic unchanged ...

  clearTimeout(timeoutId);
  return { receivedAnyData };
}

// Modified handleTurnError to accept receivedAnyData:
function handleTurnError(
  err: unknown,
  timeoutId: ReturnType<typeof setTimeout>,
  receivedAnyData: boolean = false,
): 'abort' | 'timeout' | 'retry' | 'mid-stream' | 'fatal' {
  clearTimeout(timeoutId);

  // ... existing AbortError/TimeoutError handling unchanged ...

  const message = err instanceof Error ? err.message : 'Unknown error';

  if (receivedAnyData) {
    // Mid-stream failure -- do NOT retry (Pitfall P7)
    emitChunk({
      type: 'error',
      error: 'Response interrupted — tap to ask again',
    });
    setStatus('error');
    return 'mid-stream';
  }

  // Connection error -- existing retry logic
  emitChunk({ type: 'error', error: message });

  if (health.reconnectAttempts < opts.maxReconnectAttempts) {
    return 'retry';
  } else {
    setStatus('error');
    return 'fatal';
  }
}

// Modified sendVoiceTurn catch block:
try {
  // ... existing fetch + status handling ...
  const result = await streamSSEResponse(resp, timeoutId);
  // streamSSEResponse completed successfully; result.receivedAnyData
  // is informational only on success.
} catch (err: unknown) {
  // streamSSEResponse threw (reader.read() failure)
  const result = handleTurnError(err, timeoutId, true);
  // ^ receivedAnyData = true because we entered streamSSEResponse
  // after a successful fetch (response.ok was true)
  if (result === 'retry') {
    // ... existing retry logic ...
  }
  // 'mid-stream' case: no retry, error chunk already emitted
}
```

**Important nuance:** When `streamSSEResponse` throws, we know data was being received because we only reach `streamSSEResponse` after a successful `fetch()` with `resp.ok === true`. So the `receivedAnyData` parameter in the catch block can be set to `true` unconditionally. However, it is more precise to actually track it inside the function and return/propagate it, because the reader might throw on the very first `reader.read()` call before any bytes arrive. This edge case is a connection-level failure masquerading as a stream read failure -- and should be retried.

**Refined approach:** Store `receivedAnyData` in a variable scoped outside the try/catch, set by `streamSSEResponse`'s progress:

```typescript
let receivedAnyData = false;
try {
  // ... fetch + ok check ...
  const result = await streamSSEResponse(resp, timeoutId);
  receivedAnyData = result.receivedAnyData;
} catch (err: unknown) {
  const result = handleTurnError(err, timeoutId, receivedAnyData);
  // ...
}
```

Wait -- this does not work because `streamSSEResponse` threw, so `receivedAnyData` is never assigned from its return value. The flag needs to be mutated from inside `streamSSEResponse` via a shared reference. Simplest approach:

```typescript
// Use object reference for mutation visibility in catch block
const streamState = { receivedAnyData: false };
try {
  await streamSSEResponseWithState(resp, timeoutId, streamState);
} catch (err: unknown) {
  const result = handleTurnError(err, timeoutId, streamState.receivedAnyData);
  // ...
}
```

Or alternatively, the cleaner pattern used in this codebase: catch inside `streamSSEResponse` and re-throw with context:

```typescript
async function streamSSEResponse(
  resp: Response,
  timeoutId: ReturnType<typeof setTimeout>,
): Promise<void> {
  // ... existing logic ...
  // receivedAnyData tracked internally, error re-thrown with flag
}
```

The recommended approach is the `streamState` object pattern -- it is explicit, requires minimal changes, and avoids custom error classes.

### Pattern 3: Hub Gateway Error Classification

**What:** The hub context uses `handleHubChunk()` in `hub-main.ts` to process gateway SSE events. The hub's gateway client is a separate instance. The same error classification applies -- but the hub has no FSM, so the watchdog is irrelevant. The hub already handles partial response preservation (RES-08) in its error case.

**Hub-specific consideration:** The hub gateway does not need a watchdog because there is no gesture FSM in the hub context. However, the hub gateway DOES need the same error classification to prevent auto-retry of mid-stream failures. Since both glasses and hub use the same `createGatewayClient()` factory, the error classification change in `gateway-client.ts` automatically applies to both contexts.

### Anti-Patterns to Avoid

- **Modifying gesture-fsm.ts:** The pure function must stay pure. No timers, no side effects, no imports. The watchdog is an external concern.
- **Wrapping FSM transitions with try/catch:** The FSM is synchronous and never throws. Error recovery is handled via the `reset` input, not exception handling.
- **Adding new FSM states for errors:** Errors are transient -- they use `idle` state with a temporary status bar indicator. The FSM cycle is idle->recording->sent->thinking->idle. No `error` state needed (Pitfall P8).
- **Auto-retrying mid-stream failures:** The backend already received and processed the request. Retrying creates duplicate agent invocations (Pitfall P7).
- **Resetting reconnectAttempts on mid-stream errors:** Mid-stream errors indicate the connection worked initially. The reconnectAttempts counter should be reset only on fully successful responses, not on mid-stream failures.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FSM timeout detection | Complex timer state machine | Single `setTimeout` + `clearTimeout` | One timer is sufficient. The FSM has only 3 transient states, all with the same 45-second budget. |
| Error type classification | Custom Error subclasses | Boolean `receivedAnyData` flag | A single boolean distinguishes the two retry-relevant cases. Custom error types add complexity for no gain. |
| Retry backoff algorithm | Custom retry library | Existing `handleTurnError` + exponential backoff | The retry logic in `gateway-client.ts` already works correctly for connection errors. Just skip it for mid-stream errors. |

**Key insight:** Both features are minor modifications to existing code, not new modules. The FSM watchdog is ~20 lines added to `gesture-handler.ts`. The error classification is ~15 lines modified in `gateway-client.ts`. The total scope is small because the existing architecture is well-structured.

## Common Pitfalls

### Pitfall 1: Watchdog Timer Outlives Gesture Handler (Memory Leak)

**What goes wrong:** The watchdog `setTimeout` fires after the gesture handler has been destroyed (e.g., tab close, session switch), attempting to call `bus.emit()` on a cleared event bus.

**Why it happens:** `destroy()` clears bus subscriptions but forgets to clear the watchdog timer. The timer callback captures `bus` in its closure and fires 45 seconds later.

**How to avoid:** Add `clearWatchdog()` as the first line of `destroy()`, before clearing bus subscriptions. This is the same pattern used in `display-controller.ts` for `settleTimer`.

**Warning signs:** Console errors 45 seconds after navigating away from glasses view. Timer-based errors in test teardown.

### Pitfall 2: Watchdog Resets During Normal Operation (False Positive)

**What goes wrong:** The 45-second watchdog fires during a legitimately long response. The gateway is still streaming data, but the FSM is in `thinking` state for >45 seconds.

**Why it happens:** Very long AI responses (e.g., code generation, detailed explanations) can take >45 seconds to stream. The watchdog does not know whether the gateway is still actively sending data.

**How to avoid:** Two options:
1. (Recommended) Reset the watchdog timer on every `gateway:chunk` event of type `response_delta`. This means the watchdog only fires if there has been NO new data for 45 seconds, not if the total time exceeds 45 seconds.
2. (Not recommended) Increase the timeout to 120 seconds. This weakens the safety net.

The recommended approach: subscribe to `gateway:chunk` in the gesture handler. On `response_delta` chunks, call `startWatchdog(state)` to reset the 45-second window. This way the watchdog fires only after 45 seconds of silence, which is a genuine stuck-state indicator.

**Warning signs:** Watchdog resets during active streaming. Users see "Response interrupted" for long but working responses.

### Pitfall 3: Mid-Stream Error Classification Fails on First Reader.read() (Edge Case)

**What goes wrong:** The `fetch()` succeeds with `resp.ok === true`, but the very first `reader.read()` call throws (e.g., network drops immediately after response headers). The `receivedAnyData` flag is `false`. The error is classified as "connection error" and auto-retried. But the backend already received and processed the request.

**Why it happens:** HTTP response headers were received (so `resp.ok` is true), but the response body transfer failed immediately. The server has already begun processing.

**How to avoid:** For `sendVoiceTurn`, the backend processes the audio immediately upon receiving the request, not upon response body completion. So any failure after `resp.ok === true` should be treated as potentially mid-stream. However, if `receivedAnyData === false`, the client has no partial text to save, so there is no user-visible difference between retrying and not retrying in this specific edge case. The safest approach: if `resp.ok` was true (we entered `streamSSEResponse`), set `receivedAnyData = true` after the first successful `reader.read()` yields any value bytes -- but do NOT retry if `resp.ok` was true, regardless of `receivedAnyData`. The refined classification:
- `fetch` rejected (never got response): connection error, safe to retry.
- `resp.ok === false`: HTTP error, show error, no retry.
- `resp.ok === true` + reader throws: mid-stream error, no retry (even if receivedAnyData is false).

This simplifies the implementation: the `receivedAnyData` flag is only needed for the error message ("Response interrupted" vs generic error), not for the retry decision. The retry decision is based on whether `streamSSEResponse` was reached at all.

**Warning signs:** Duplicate backend requests after brief network blips during response headers.

### Pitfall 4: Error Chunk Emitted Twice (Watchdog + Gateway Error)

**What goes wrong:** The gateway emits an error chunk, which triggers FSM reset via `gesture-handler.ts` line 127-131. Meanwhile, the watchdog timer was already running and fires shortly after, emitting another reset. The FSM is reset twice. The `fsm:watchdog-reset` event fires for a state that was already reset.

**Why it happens:** The gateway error arrives and resets the FSM to idle. The watchdog timer was set when the FSM entered `thinking`. The gateway error clears the thinking state but does not clear the watchdog timer (in a naive implementation).

**How to avoid:** `startWatchdog()` is called on EVERY state transition, including the reset triggered by `gateway:chunk` error. When the FSM transitions to `idle`, `startWatchdog('idle')` is called, which calls `clearWatchdog()` first and then does NOT set a new timer (idle is not transient). So the watchdog is automatically cleared. No special handling needed -- the pattern is self-correcting.

**Warning signs:** Two reset-related log entries within milliseconds of each other.

### Pitfall 5: Hub Gateway Auto-Retry of Mid-Stream Errors

**What goes wrong:** The hub context uses `sendTextTurn()` which shares the same retry logic. If a hub text turn fails mid-stream, the text is re-sent, creating a duplicate AI response.

**Why it happens:** Hub and glasses both use `createGatewayClient()`. The retry logic is shared.

**How to avoid:** The error classification change in `gateway-client.ts` applies to both `sendVoiceTurn()` and `sendTextTurn()`. Both methods use the same `streamSSEResponse()` and `handleTurnError()`. The fix is automatic once applied to the shared gateway client code.

**Warning signs:** Duplicate assistant responses in hub text input after network hiccups.

## Code Examples

### 1. AppEventMap Addition (RES-20 FSM Events)

```typescript
// src/types.ts -- add to existing AppEventMap interface:
'fsm:watchdog-reset': {
  previousState: string;
  elapsed: number;
};
```

This is the only new event type for this phase. The `previousState` is the FSM state before reset (recording/sent/thinking). The `elapsed` is always 45000 (the watchdog duration). Phase 18 (Error UX) will subscribe to this event to show a user-visible notification.

### 2. Complete Watchdog Integration in gesture-handler.ts

```typescript
const WATCHDOG_MS = 45_000;
const TRANSIENT_STATES: ReadonlySet<GestureState> = new Set(['recording', 'sent', 'thinking']);
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

function clearWatchdog(): void {
  if (watchdogTimer !== null) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function startWatchdog(): void {
  clearWatchdog();
  if (TRANSIENT_STATES.has(state)) {
    const watchedState = state; // capture for closure
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      bus.emit('fsm:watchdog-reset', { previousState: watchedState, elapsed: WATCHDOG_MS });
      bus.emit('log', {
        level: 'warn',
        msg: `FSM watchdog: stuck in ${watchedState} for ${WATCHDOG_MS / 1000}s, resetting`,
      });
      handleInput('reset', Date.now());
    }, WATCHDOG_MS);
  }
}

// In handleInput(), after setting state:
function handleInput(input: GestureInput, timestamp: number): void {
  // ... existing debounce logic ...
  const transition = gestureTransition(state, input);
  state = transition.nextState;
  startWatchdog(); // Reset/clear watchdog on every transition
  if (transition.action !== null) {
    dispatchAction(transition.action);
  }
}

// Add gateway:chunk subscription to keep watchdog alive during streaming:
unsubs.push(bus.on('gateway:chunk', (chunk) => {
  if (chunk.type === 'error') {
    handleInput('reset', Date.now());
  } else if (chunk.type === 'response_delta') {
    // Keep watchdog alive during active streaming
    startWatchdog();
  }
}));

// In destroy():
function destroy(): void {
  clearWatchdog();
  for (const unsub of unsubs) { unsub(); }
  unsubs.length = 0;
}
```

### 3. Gateway Error Classification in gateway-client.ts

```typescript
// Modified streamSSEResponse -- returns receivedAnyData via shared state object
async function streamSSEResponse(
  resp: Response,
  timeoutId: ReturnType<typeof setTimeout>,
  streamState: { receivedAnyData: boolean },
): Promise<void> {
  const reader = resp.body?.getReader();
  if (!reader) {
    emitChunk({ type: 'error', error: 'No response body stream' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    streamState.receivedAnyData = true;

    // ... existing SSE parsing unchanged ...
  }

  // ... existing buffer flush unchanged ...
  clearTimeout(timeoutId);
}

// Modified handleTurnError -- adds receivedAnyData parameter
function handleTurnError(
  err: unknown,
  timeoutId: ReturnType<typeof setTimeout>,
  receivedAnyData: boolean = false,
): 'abort' | 'timeout' | 'retry' | 'mid-stream' | 'fatal' {
  clearTimeout(timeoutId);

  if (err instanceof DOMException && err.name === 'AbortError') {
    const reason = abortController?.signal?.reason;
    if (reason instanceof DOMException && reason.name === 'TimeoutError') {
      emitChunk({ type: 'error', error: 'Request timed out. Tap to retry.' });
      setStatus('error');
      return 'timeout';
    }
    return 'abort';
  }

  if (err instanceof DOMException && err.name === 'TimeoutError') {
    emitChunk({ type: 'error', error: 'Request timed out. Tap to retry.' });
    setStatus('error');
    return 'timeout';
  }

  // Mid-stream failure: data was being received, do NOT retry (Pitfall P7)
  if (receivedAnyData) {
    emitChunk({ type: 'error', error: 'Response interrupted \u2014 tap to ask again' });
    setStatus('error');
    return 'mid-stream';
  }

  // Connection error: no data received, safe to retry
  const message = err instanceof Error ? err.message : 'Unknown error';
  emitChunk({ type: 'error', error: message });

  if (health.reconnectAttempts < opts.maxReconnectAttempts) {
    return 'retry';
  } else {
    setStatus('error');
    return 'fatal';
  }
}

// Modified sendVoiceTurn catch block:
async function sendVoiceTurn(settings: AppSettings, request: VoiceTurnRequest): Promise<void> {
  // ... existing setup ...
  const streamState = { receivedAnyData: false };
  try {
    const resp = await fetch(/* ... */);
    if (!resp.ok) {
      // ... existing HTTP error handling unchanged ...
      return;
    }
    setStatus('connected');
    health.reconnectAttempts = 0;
    await streamSSEResponse(resp, timeoutId, streamState);
  } catch (err: unknown) {
    const result = handleTurnError(err, timeoutId, streamState.receivedAnyData);
    if (result === 'retry') {
      health.reconnectAttempts++;
      setStatus('connecting');
      const delay = opts.reconnectBaseDelayMs * Math.pow(2, health.reconnectAttempts - 1);
      await new Promise((r) => setTimeout(r, delay));
      return sendVoiceTurn(settings, request);
    }
    // 'mid-stream': no retry -- error chunk already emitted
    // 'fatal': no retry -- max attempts reached
  }
}

// sendTextTurn receives identical treatment (same catch block pattern)
```

### 4. Test Pattern: FSM Watchdog

```typescript
describe('FSM watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets FSM to idle after 45s in recording state', () => {
    const handler = createHandler();
    bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
    expect(handler.getState()).toBe('recording');

    vi.advanceTimersByTime(45_000);
    expect(handler.getState()).toBe('idle');
  });

  it('emits fsm:watchdog-reset event', () => {
    const handler = createHandler();
    const spy = vi.fn();
    bus.on('fsm:watchdog-reset', spy);

    bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
    vi.advanceTimersByTime(45_000);

    expect(spy).toHaveBeenCalledWith({
      previousState: 'recording',
      elapsed: 45_000,
    });
  });

  it('does not fire watchdog in idle state', () => {
    const handler = createHandler();
    const spy = vi.fn();
    bus.on('fsm:watchdog-reset', spy);

    vi.advanceTimersByTime(60_000);
    expect(spy).not.toHaveBeenCalled();
    expect(handler.getState()).toBe('idle');
  });

  it('resets watchdog timer on response_delta chunks', () => {
    const handler = createHandler();
    bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
    bus.emit('gesture:tap', { timestamp: 1300 }); // recording -> sent

    // Simulate thinking state
    bus.emit('gateway:chunk', { type: 'response_start' });

    // Wait 30s, receive delta (resets watchdog)
    vi.advanceTimersByTime(30_000);
    bus.emit('gateway:chunk', { type: 'response_delta', text: 'hello' });

    // Wait another 30s -- should NOT fire (only 30s since last delta)
    vi.advanceTimersByTime(30_000);
    expect(handler.getState()).not.toBe('idle'); // still thinking (FSM state not reset by delta)
    // Note: the FSM stays in 'sent' because only display-controller transitions to 'thinking'
    // via renderer.setIconState. The gesture FSM goes sent->idle on reset.
  });

  it('clears watchdog on destroy', () => {
    const handler = createHandler();
    bus.emit('gesture:tap', { timestamp: 1000 }); // idle -> recording
    handler.destroy();

    vi.advanceTimersByTime(45_000);
    // No error, no reset event -- timer was cleared
  });
});
```

### 5. Test Pattern: Gateway Error Classification

```typescript
describe('mid-stream error classification', () => {
  it('does NOT retry when reader throws after receiving data', async () => {
    // First call: returns a stream that fails mid-read
    let readCount = 0;
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          readCount++;
          if (readCount === 1) {
            controller.enqueue(encoder.encode('data: {"type":"response_delta","text":"hi"}\n\n'));
          } else {
            controller.error(new Error('Connection reset'));
          }
        },
      }),
    });

    const client = createGatewayClient({ maxReconnectAttempts: 3, reconnectBaseDelayMs: 1 });
    const chunks: VoiceTurnChunk[] = [];
    client.onChunk((c) => chunks.push(c));

    await client.sendVoiceTurn(testSettings, testRequest);

    // Should emit the delta chunk + the error chunk
    expect(chunks.some(c => c.type === 'response_delta')).toBe(true);
    const errorChunks = chunks.filter(c => c.type === 'error');
    expect(errorChunks).toHaveLength(1);
    expect(errorChunks[0].error).toContain('interrupted');

    // fetch called only once -- no retry
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries when fetch throws before any response', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('Network failure'));
      return Promise.resolve({
        ok: true,
        body: createSSEStream(['data: {"type":"response_end"}\n\n']),
      });
    });

    const client = createGatewayClient({ maxReconnectAttempts: 3, reconnectBaseDelayMs: 1 });
    await client.sendVoiceTurn(testSettings, testRequest);

    expect(callCount).toBe(2); // retried once, succeeded
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No FSM timeout | Watchdog timer pattern | Standard practice | Prevents stuck states in all event-driven FSMs |
| Retry all errors uniformly | Classify errors before retry | Always best practice | Prevents duplicate server-side processing |

**Deprecated/outdated:**
- None. The patterns used here (setTimeout watchdog, boolean flag error classification) are stable browser APIs with no deprecation concerns.

## Open Questions

1. **Watchdog timeout duration (45s)**
   - What we know: The gateway turn timeout is 30 seconds. A 45-second watchdog (1.5x the gateway timeout) provides a reasonable buffer.
   - What's unclear: Whether 45 seconds is optimal. Very long streaming responses could exceed this if the `response_delta` watchdog reset is not implemented.
   - Recommendation: Implement `response_delta` watchdog reset (Pattern 1 code example). With that in place, 45 seconds of silence is a strong stuck-state indicator.

2. **FSM `sent` -> `thinking` transition ownership**
   - What we know: The FSM pure function has no `sent` -> `thinking` transition. The `display-controller.ts` calls `renderer.setIconState('thinking')` on `response_start`, but this is a display concern -- the gesture FSM state remains `sent` until `reset` is received. The watchdog monitors the gesture FSM state, not the display icon state.
   - What's unclear: Should the watchdog trigger on the gesture FSM's `sent` state (45s in sent without any gateway response at all) or on the display's logical state?
   - Recommendation: Watch the gesture FSM state. `sent` is a transient state that should resolve when the gateway responds (either with data triggering `response_start` or with error triggering `reset`). 45 seconds in `sent` means the gateway never responded at all.

3. **Hub context behavior on mid-stream errors**
   - What we know: Hub text input already saves partial responses (RES-08 implemented in Phase 15). The hub re-enables the send button on error. The hub has no FSM.
   - What's unclear: Should the hub show a different error message for mid-stream vs connection errors?
   - Recommendation: Yes, but defer to Phase 18 (Error UX). Phase 17 only classifies the error and emits the appropriate error chunk message. Phase 18 will decide how to present it.

## Sources

### Primary (HIGH confidence)

- **Codebase source analysis** - Direct inspection of `gesture-fsm.ts`, `gesture-handler.ts`, `gateway-client.ts`, `voice-loop-controller.ts`, `display-controller.ts`, `auto-save.ts`, `glasses-main.ts`, `hub-main.ts`, `types.ts` -- all findings verified against actual code
- **Existing test suites** - `gesture-handler.test.ts` (32 tests), `gateway-client.test.ts` (14 tests), `gesture-fsm.test.ts` (28 tests) -- test patterns documented for consistency
- **PITFALLS.md** - Pitfall P7 (mid-stream SSE retry), Pitfall P8 (error recovery paths missing FSM reset) -- directly inform implementation constraints
- **ARCHITECTURE.md** - Error surface analysis (7 failure surfaces), system overview diagram, component boundaries
- **STACK.md** - Error recovery patterns section, gateway error classification, FSM watchdog pattern, test infrastructure
- **MDN setTimeout/clearTimeout** - Standard timer API, no compatibility concerns
- **MDN AbortController** - Standard fetch abort API, already used in gateway-client.ts

### Secondary (MEDIUM confidence)

- None. All findings are verified against the codebase source code.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Zero new dependencies, browser built-ins only
- Architecture: HIGH - Direct codebase analysis, patterns match existing code
- Pitfalls: HIGH - Pitfall P7 and P8 from research directly apply, verified against source code

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable browser APIs, no version-sensitive dependencies)
