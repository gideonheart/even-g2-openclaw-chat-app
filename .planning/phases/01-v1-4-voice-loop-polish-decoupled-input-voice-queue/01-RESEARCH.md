# Phase 1: v1.4 Voice Loop Polish -- Decoupled Input + Voice Queue - Research

**Researched:** 2026-03-02
**Domain:** FSM architecture, event-driven concurrency, voice turn queuing (TypeScript/Vitest)
**Confidence:** HIGH

## Summary

This phase completes the decoupling of the input FSM from the gateway response lifecycle and introduces a typed voice turn queue. Quick tasks 19 and 20 have already partially addressed this: Quick-19 added `thinking+tap->recording`, `response_end` reset to idle, and transcript chunk emission. Quick-20's FSM changes (adding `sent+tap->recording` and `sent+double-tap->menu`) are committed in the codebase. However, Quick-20's critical Tasks 2 and 3 (state-aware reset logic and voice turn queue) were **not executed** -- only the plan exists, no summary file.

The current codebase has a key architectural gap: the `gateway:chunk` handler in `gesture-handler.ts` (lines 175-183) still performs **unconditional** resets on `response_end` and `error` chunks, meaning a `response_end` arriving while the user is recording a new turn will abort that recording by resetting FSM to idle. The voice-loop-controller also sends turns immediately without queuing, so concurrent recordings would trigger the gateway client's `abort()` call (line 209 in `gateway-client.ts`), cancelling in-flight requests. These are the two primary problems this phase must solve.

The proposed architecture from the PRD (separate Input FSM module, Pipeline state module, Queue module, Orchestrator, Gateway adapter) is overengineered for the current codebase size (~14,400 LOC, 78 files). The existing closure-based module pattern works well. The recommended approach is: (1) make `gesture-handler.ts` state-aware for resets, (2) add a voice turn queue to `voice-loop-controller.ts`, (3) clean up dead paths, (4) comprehensive tests. No new files or modules are strictly necessary -- the existing modules just need targeted modifications.

**Primary recommendation:** Implement the state-aware reset guard in gesture-handler and voice turn queue in voice-loop-controller as targeted modifications to existing modules, following the Quick-20 plan patterns. Extract separate Input FSM and Pipeline state modules only if complexity warrants it during implementation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VLQ-01 | Input FSM governs only gesture/UI input states (idle, recording, menu) -- no backend lifecycle states | FSM already has correct transitions after Quick-19/20 commits. The `sent` and `thinking` states are now tappable. Remaining work: ensure FSM type/docs reflect that `sent`/`thinking` are transient pipeline states, not input-blocking states. |
| VLQ-02 | Response pipeline state is separate (idle, in_flight, streaming, error) and never blocks start_recording | The state-aware reset guard (Quick-20 Task 2, not yet implemented) prevents response_end/error from aborting active recordings. Gateway client already tracks its own status. No separate pipeline state module needed -- the existing gateway health + state-aware guard achieves this. |
| VLQ-03 | Typed VoiceTurnQueue (FIFO, bounded, deterministic dequeue, duplicate guard by turn id) | Voice turn queue implementation in voice-loop-controller (Quick-20 Task 3 pattern, not yet implemented). Add bounded size, turn ID generation, and duplicate guard on top of the basic queue pattern from the plan. |
| VLQ-04 | stop_recording enqueues turn; sender drains queue whenever pipeline is available | Follows from VLQ-03. The existing `audio:recording-stop` handler in voice-loop-controller is the enqueue point. Queue drains on `response_end`/`error` chunks. |
| VLQ-05 | Preserve transcript-first rendering on glasses right side and persist user transcript deterministically | Already working after Quick-19: gateway-client emits transcript chunk before response_start, display-controller renders via renderer.addUserMessage, auto-save persists. Verify no regression during queue refactor. |
| VLQ-06 | Full test coverage for queue ordering, concurrency races, cancel/error recovery, no dropped taps | New tests needed in voice-loop-controller.test.ts and gesture-handler.test.ts. Quick-20 Task 3 has good test patterns. Add bounded queue, duplicate guard, and multi-turn race condition tests. |
| VLQ-07 | Remove obsolete legacy state transitions/dead paths after refactor | Audit gesture-fsm.ts, gesture-handler.ts, voice-loop-controller.ts for dead code after changes. Update hint text for `sent` state. Remove any obsolete comments. |
| VLQ-08 | Strict type-safety (npm run typecheck clean, no any added) | All new types should be explicit. VoiceTurnQueue interface, PendingTurn type, queue bounds config. Verify with `npm run typecheck` after each change. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.7.0 | Type-safe implementation | Project standard, strict mode |
| Vitest | ^3.0.0 | Unit testing | Already configured in vite.config.ts, 582 passing tests |
| Vite | ^6.1.0 | Build/dev tooling | Project bundler |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsdom | ^25.0.0 | Test environment | Vitest test env for DOM APIs |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline queue in voice-loop-controller | Separate queue module file | Separate file adds indirection; inline keeps queue logic co-located with its only consumer. Extract only if queue grows beyond ~50 lines. |
| Separate pipeline-state.ts module | State-aware guard in gesture-handler | Full pipeline module is overkill; the gateway client already tracks its own state. A simple guard clause achieves VLQ-02 with zero new files. |
| XState/robot for FSM | Existing pure function FSM | XState would be a massive dependency for a 72-line pure function. The existing table-driven FSM is already testable and working. |

**Installation:**
```bash
# No new packages needed -- all dependencies are already installed
```

## Architecture Patterns

### Current Project Structure (relevant files)
```
src/
  gestures/
    gesture-fsm.ts           # Pure FSM transition table (ALREADY UPDATED by Quick-19/20)
    gesture-handler.ts        # Wires bus events to FSM + bridge (NEEDS state-aware reset)
  api/
    gateway-client.ts         # HTTP gateway client (NO changes needed)
  voice-loop-controller.ts    # Gateway-to-bus bridge (NEEDS voice turn queue)
  types.ts                    # Shared types (NEEDS VoiceTurnQueue types)
  events.ts                   # Typed event bus (NO changes needed)
  display/
    display-controller.ts     # Bus-to-renderer wiring (VERIFY no regression)
  __tests__/
    gesture-fsm.test.ts       # (ALREADY UPDATED)
    gesture-handler.test.ts   # (NEEDS new state-aware reset tests)
    voice-loop-controller.test.ts  # (NEEDS voice turn queue tests)
    display-controller.test.ts     # (VERIFY no regression)
```

### Pattern 1: State-Aware Reset Guard
**What:** The gesture-handler's `gateway:chunk` listener checks the current FSM state before resetting. Only `sent` and `thinking` states are eligible for reset on `response_end`/`error`. Recording, idle, and menu states are immune.
**When to use:** Whenever external events (gateway lifecycle) could interfere with user-initiated state.
**Example:**
```typescript
// In gesture-handler.ts, replace unconditional reset with guard
unsubs.push(bus.on('gateway:chunk', (chunk) => {
  if (chunk.type === 'error' || chunk.type === 'response_end') {
    // Only reset if in sent/thinking -- do NOT abort active recording or clobber idle/menu
    if (state === 'sent' || state === 'thinking') {
      handleInput('reset', Date.now());
    }
  } else if (chunk.type === 'response_delta') {
    startWatchdog(); // Keep watchdog alive during active streaming
  }
}));
```

### Pattern 2: FIFO Voice Turn Queue with Busy Flag
**What:** Voice turns are enqueued on `audio:recording-stop`. A `busy` flag prevents concurrent sends. Queue drains one turn at a time when the gateway signals completion (`response_end` or `error`).
**When to use:** Any time multiple async operations must execute sequentially without aborting in-flight work.
**Example:**
```typescript
// In voice-loop-controller.ts
interface PendingTurn {
  id: string;        // Unique turn ID for duplicate guard
  sessionId: string;
  blob: Blob;
}

const MAX_QUEUE_SIZE = 5;
const pendingTurns: PendingTurn[] = [];
let busy = false;

function generateTurnId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function enqueue(sessionId: string, blob: Blob): void {
  const id = generateTurnId();
  if (pendingTurns.length >= MAX_QUEUE_SIZE) {
    bus.emit('log', { level: 'warn', msg: `Voice queue full (${MAX_QUEUE_SIZE}), dropping oldest` });
    pendingTurns.shift(); // Drop oldest to make room
  }
  // Duplicate guard: skip if same turn ID already queued (edge case: rapid re-emit)
  if (!pendingTurns.some(t => t.id === id)) {
    pendingTurns.push({ id, sessionId, blob });
  }
  processQueue();
}

function processQueue(): void {
  if (busy || pendingTurns.length === 0) return;
  busy = true;
  const turn = pendingTurns.shift()!;
  const s = settings();
  gateway.sendVoiceTurn(s, {
    sessionId: turn.sessionId,
    audio: turn.blob,
    sttProvider: s.sttProvider,
  });
}

// On response_end or error, mark not busy and drain next
// (in the onChunk handler)
if (chunk.type === 'response_end' || chunk.type === 'error') {
  busy = false;
  processQueue();
}
```

### Pattern 3: Existing Project Patterns to Follow
**What:** The project consistently uses closure-based factories, typed event bus, and `unsubs` array cleanup pattern.
**When to use:** Always -- maintain consistency.
**Key patterns from codebase:**
- Factory functions (`createXxx`) returning interface objects
- `unsubs: Array<() => void>` for subscription cleanup
- `destroy()` method that drains unsubs and resets state
- `vi.fn()` mocks in tests with `simulateXxx` test helpers
- Synchronous event bus dispatch

### Anti-Patterns to Avoid
- **Creating a separate orchestrator module:** The PRD suggests a `voice-loop-orchestrator.ts`. This would add an unnecessary abstraction layer. The existing `voice-loop-controller.ts` IS the orchestrator. Keep it there.
- **Making the queue async/Promise-based:** The gateway client's `sendVoiceTurn` is fire-and-forget from the queue's perspective (it signals completion via chunks on the callback). Do NOT await `sendVoiceTurn` in the queue -- use the chunk callback to advance the queue.
- **Adding pipeline state tracking to gesture-handler:** The gesture-handler should NOT know about pipeline states. It only needs to know "am I in a state where reset is appropriate?" -- which is a simple set membership check on its own FSM state.
- **Removing sent/thinking from GestureState type:** These states still exist in the FSM and are needed for hint text and icon state. They just no longer block taps.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Turn ID generation | UUID library | `Date.now()` + random suffix | UUIDs are overkill for local queue dedup. Turns never leave the device as IDs. |
| Concurrency control | Mutex/semaphore library | Simple `busy` boolean flag | The event bus is synchronous, single-threaded. A boolean is the correct primitive. No race conditions possible with synchronous dispatch. |
| Event bus | Custom pub/sub replacement | Existing `createEventBus` | Already typed, tested, and used everywhere. 67 lines, zero dependencies. |
| Queue data structure | Linked list or priority queue | JavaScript array with shift/push | Queue size is bounded at ~5 items. Array operations are O(n) but n is tiny. |

**Key insight:** The event bus is synchronous and single-threaded. This eliminates entire categories of concurrency bugs. The `busy` flag + synchronous chunk callback pattern is correct and sufficient. No mutexes, locks, or async coordination needed.

## Common Pitfalls

### Pitfall 1: Gateway Client abort() on Concurrent Sends
**What goes wrong:** `sendVoiceTurn` calls `abort()` at line 209 before every request, which cancels any in-flight fetch. If the queue sends turn 2 while turn 1's HTTP response is still in transit, turn 1 gets aborted.
**Why it happens:** The gateway client was designed for single-turn-at-a-time usage.
**How to avoid:** The queue MUST wait for `response_end` or `error` chunk before sending the next turn. The `busy` flag pattern enforces this. Do NOT call `gateway.sendVoiceTurn()` for a queued turn until the previous turn's response cycle is complete.
**Warning signs:** If tests show `sendVoiceTurn` being called twice without an intervening `response_end`/`error`, the queue is broken.

### Pitfall 2: Reset During Active Recording Aborts User Input
**What goes wrong:** User taps to record while a previous turn is streaming. `response_end` fires for the old turn and resets FSM to idle, aborting the new recording.
**Why it happens:** The current `gateway:chunk` listener in gesture-handler.ts does unconditional resets (lines 176-182).
**How to avoid:** State-aware reset guard -- only reset from `sent` or `thinking` states. Recording, idle, and menu are immune.
**Warning signs:** If `handler.getState()` returns `idle` after a `response_end` when the user was actively recording.

### Pitfall 3: Watchdog Timer Interaction with Queue
**What goes wrong:** The 45s watchdog in gesture-handler fires while a queued turn is waiting to be sent, resetting FSM to idle and potentially losing the queued turn's context.
**Why it happens:** The watchdog runs on `sent` and `thinking` states. If the user is in `idle` or `recording` after the state-aware guard, the watchdog correctly does NOT fire. But if the FSM is somehow stuck in `sent` (e.g., queue has items but gateway never responds), the watchdog is the safety net.
**How to avoid:** Ensure `processQueue` is called on both `response_end` AND `error`. The watchdog is the last resort. Add a log message when the watchdog fires while queue has pending items.
**Warning signs:** Watchdog fires with items in the queue.

### Pitfall 4: Display Controller Settle Timer Race
**What goes wrong:** Display controller has a 500ms settle timer after `response_end` that sets icon to idle. If the user starts recording during this 500ms window, the settle timer fires and overwrites the recording icon.
**How to avoid:** Display controller already handles this (lines 111-114 in display-controller.ts): `audio:recording-start` cancels any pending settle timer. Verify this still works with queued turns.
**Warning signs:** Icon flickers from recording to idle after `response_end` arrives for a previous turn.

### Pitfall 5: Queue Not Cleared on Destroy
**What goes wrong:** Voice-loop-controller is destroyed (glasses view hidden) but queued turns persist, causing stale sends on next boot.
**Why it happens:** Queue state is module-local.
**How to avoid:** `destroy()` must clear `pendingTurns` and set `busy = false`. Already addressed in Quick-20 plan.
**Warning signs:** After destroy/reboot cycle, old audio blobs are sent to gateway.

### Pitfall 6: Turn ID Collision in Duplicate Guard
**What goes wrong:** Two turns generated in the same millisecond get the same ID and the duplicate guard drops one.
**Why it happens:** `Date.now()` has millisecond resolution.
**How to avoid:** Add random suffix to turn ID: `t-${Date.now()}-${random}`. Alternatively, use a monotonic counter.
**Warning signs:** Queue length doesn't match expected count after rapid enqueues.

## Code Examples

Verified patterns from the existing codebase:

### Gateway Chunk Handler (current, needs modification)
```typescript
// Source: src/gestures/gesture-handler.ts lines 175-183 (CURRENT -- unconditional reset)
unsubs.push(bus.on('gateway:chunk', (chunk) => {
  if (chunk.type === 'error') {
    handleInput('reset', Date.now());
  } else if (chunk.type === 'response_end') {
    handleInput('reset', Date.now());
  } else if (chunk.type === 'response_delta') {
    startWatchdog();
  }
}));
```

### Voice Loop Controller (current, no queue)
```typescript
// Source: src/voice-loop-controller.ts lines 44-55 (CURRENT -- immediate send)
unsubs.push(bus.on('audio:recording-stop', ({ sessionId, blob }) => {
  const s = settings();
  bus.emit('log', {
    level: 'info',
    msg: `Sending voice turn: ${blob.size} bytes ${blob.type} ...`,
  });
  gateway.sendVoiceTurn(s, {
    sessionId,
    audio: blob,
    sttProvider: s.sttProvider,
  });
}));
```

### Mock Gateway Pattern (for tests)
```typescript
// Source: src/__tests__/voice-loop-controller.test.ts lines 18-43
function createMockGateway() {
  let chunkCb: ((chunk: VoiceTurnChunk) => void) | null = null;
  let statusCb: ((status: ConnectionStatus) => void) | null = null;
  return {
    onChunk: vi.fn((cb) => { chunkCb = cb; return () => { chunkCb = null; }; }),
    onStatusChange: vi.fn((cb) => { statusCb = cb; return () => { statusCb = null; }; }),
    sendVoiceTurn: vi.fn(),
    // Test helpers
    simulateChunk(chunk: VoiceTurnChunk) { chunkCb?.(chunk); },
    simulateStatus(status: ConnectionStatus) { statusCb?.(status); },
    // ...other stubs
  };
}
```

### FSM Transition Table (already correct after Quick-19/20)
```typescript
// Source: src/gestures/gesture-fsm.ts lines 40-46 (CURRENT -- already correct)
sent: {
  'tap':        { nextState: 'recording', action: { type: 'START_RECORDING' } },
  'double-tap': { nextState: 'menu',      action: { type: 'TOGGLE_MENU' } },
  'reset':      { nextState: 'idle',      action: null },
},
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic FSM with backend states blocking taps | FSM allows tap in sent/thinking (Quick-19/20) | 2026-03-02 | Taps never blocked, but reset still unconditional |
| Unconditional response_end reset | State-aware reset (THIS PHASE) | Pending | Prevents recording abortion on stale response_end |
| Immediate voice turn send | Queued sequential send (THIS PHASE) | Pending | Multiple turns processed in order without abort |

**What Quick-19 accomplished (COMMITTED, verified in code):**
- `thinking + tap -> recording` transition in FSM
- `response_end` resets FSM to idle via `handleInput('reset')`
- Transcript chunk emission from gateway reply before response_start
- 582 tests pass

**What Quick-20 accomplished (PARTIALLY COMMITTED):**
- `sent + tap -> recording` transition in FSM (COMMITTED in gesture-fsm.ts)
- `sent + double-tap -> menu` transition in FSM (COMMITTED in gesture-fsm.ts)
- State-aware reset in gesture-handler (NOT DONE -- only planned)
- Voice turn queue in voice-loop-controller (NOT DONE -- only planned)

**Remaining work for this phase:**
1. State-aware reset guard in gesture-handler.ts (VLQ-01, VLQ-02)
2. Voice turn queue in voice-loop-controller.ts (VLQ-03, VLQ-04)
3. Hint text update for sent state (VLQ-07)
4. Full test coverage (VLQ-06)
5. Dead code/obsolete path removal (VLQ-07)
6. Typecheck verification (VLQ-08)
7. Verify transcript rendering not regressed (VLQ-05)

## Open Questions

1. **Queue bound size: how many turns?**
   - What we know: PRD says "bounded" but does not specify a number. Quick-20 plan has no bound.
   - What's unclear: What's a reasonable max? Users rarely queue more than 2-3 turns.
   - Recommendation: Use 5 as default bound. Drop oldest on overflow with a log warning. This is generous enough to never drop in normal use, small enough to prevent memory issues with large audio blobs.

2. **Should the queue be exposed for testing/debugging?**
   - What we know: The voice-loop-controller currently returns `{ destroy }` only.
   - What's unclear: Whether to add `getQueueLength()` or similar for tests/debugging.
   - Recommendation: Add `getQueueLength(): number` to the returned interface. Useful for tests and future hub UI queue indicator.

3. **Gateway client abort() behavior with queue**
   - What we know: `sendVoiceTurn` calls `abort()` on every invocation, cancelling any in-flight request.
   - What's unclear: Whether to modify gateway-client to remove the abort(), or keep it and ensure queue never calls sendVoiceTurn concurrently.
   - Recommendation: Do NOT modify gateway-client. The queue's `busy` flag ensures sequential calls. The `abort()` in sendVoiceTurn is harmless when called sequentially (previous request is already complete). This avoids touching a well-tested module.

4. **Turn ID format and duplicate guard semantics**
   - What we know: PRD requires "duplicate guard by turn id". Quick-20 plan uses sessionId, not turn ID.
   - What's unclear: What constitutes a "duplicate" -- same audio blob? Same session?
   - Recommendation: Generate unique turn IDs locally (counter or timestamp+random). Duplicate guard checks turn ID only. In practice, duplicates should never occur since each recording produces a unique blob event. The guard is a safety net.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/gestures/gesture-fsm.ts` -- current FSM transition table (verified line-by-line)
- Codebase analysis: `src/gestures/gesture-handler.ts` -- unconditional reset confirmed at lines 175-183
- Codebase analysis: `src/voice-loop-controller.ts` -- no queue, immediate send confirmed
- Codebase analysis: `src/api/gateway-client.ts` -- abort() on line 209 confirmed
- Codebase analysis: `src/__tests__/*.test.ts` -- 582 tests passing, existing test patterns verified
- Quick-19 summary: `.planning/quick/19-fsm-re-record-after-response-end-queue-d/19-SUMMARY.md`
- Quick-20 plan: `.planning/quick/20-decouple-input-fsm-from-response-lifecyc/20-PLAN.md` (Task 2 and 3 NOT executed)
- Phase PRD: `.planning/analysis/02-voice-loop-decoupled-fsm-queue-phase-prd.md`

### Secondary (MEDIUM confidence)
- Quick-20 Task 2/3 code patterns -- these were planned but not executed, so the exact implementation may need adjustment during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Project already has all dependencies, no new packages needed
- Architecture: HIGH - Full codebase analysis, every relevant file read and understood
- Pitfalls: HIGH - Identified from actual code analysis (abort() behavior, unconditional reset, settle timer race)
- What's already done vs remaining: HIGH - Verified Quick-19 summary, confirmed Quick-20 Task 2/3 not executed by checking for missing summary file and inspecting actual code

**Research date:** 2026-03-02
**Valid until:** 2026-04-01 (stable -- no external dependency changes expected)
