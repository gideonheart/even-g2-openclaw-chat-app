---
phase: quick-50
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/api/replay-client.ts
  - src/__tests__/replay-client.test.ts
  - src/api/gateway-client.ts
  - src/__tests__/gateway-client.test.ts
  - src/glasses-main.ts
  - src/__tests__/glasses-main.test.ts
  - src/types.ts
autonomous: true
requirements: [REPLAY-01, REPLAY-02, REPLAY-03]

must_haves:
  truths:
    - "Replayed gateway events are mapped to VoiceTurnChunks and fed through the existing chunk pipeline"
    - "Gateway client tracks lastEventSeq from SSE events and persists it to localStorage"
    - "On visibility reconnect, glasses-main replays missed events after lastEventSeq"
  artifacts:
    - path: "src/api/replay-client.ts"
      provides: "Replay client with fetchSessionReplay, fetchTurnReplay, replayEventsAsChunks"
      exports: ["fetchSessionReplay", "fetchTurnReplay", "replayEventsAsChunks", "ReplayEvent"]
    - path: "src/__tests__/replay-client.test.ts"
      provides: "Tests for all replay-client functions"
      min_lines: 80
    - path: "src/api/gateway-client.ts"
      provides: "lastEventSeq tracking with getLastSeq/setLastSeq"
    - path: "src/glasses-main.ts"
      provides: "Resume sync wiring after boot restore"
  key_links:
    - from: "src/api/replay-client.ts"
      to: "/api/sessions/:sessionKey/events"
      via: "fetch call in fetchSessionReplay"
      pattern: "fetch.*api/sessions.*events"
    - from: "src/api/replay-client.ts"
      to: "VoiceTurnChunk pipeline"
      via: "replayEventsAsChunks maps ReplayEvent to emitChunkCallback"
      pattern: "emitChunkCallback"
    - from: "src/glasses-main.ts"
      to: "src/api/replay-client.ts"
      via: "import and call fetchSessionReplay + replayEventsAsChunks after boot restore"
      pattern: "fetchSessionReplay.*replayEventsAsChunks"
---

<objective>
Add frontend resume sync: track the last event sequence number from SSE streams, create a replay client that calls gateway replay endpoints, and wire reconnect replay into the glasses boot flow.

Purpose: When the glasses WebView goes hidden and comes back visible, any events missed during the hidden period are replayed through the existing chunk pipeline, so auto-save and the renderer catch up naturally.

Output: replay-client.ts module, enhanced gateway-client.ts with seq tracking, glasses-main.ts resume sync wiring, and comprehensive tests for all new code.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/api/gateway-client.ts
@src/glasses-main.ts
@src/types.ts
@src/persistence/auto-save.ts
@src/__tests__/gateway-client.test.ts
@src/__tests__/glasses-main.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create replay-client module with ReplayEvent type, fetch functions, and chunk mapping + tests</name>
  <files>
    src/api/replay-client.ts
    src/__tests__/replay-client.test.ts
    src/types.ts
  </files>
  <action>
1. Add `ReplayEvent` type to `src/types.ts`:
```typescript
export interface ReplayEvent {
  turnId: string;
  sessionKey: string;
  seq: number;
  type: string;       // 'transcript' | 'assistant_delta' | 'done' | 'error'
  payload: unknown;
  timestamp: number;
}
```

2. Create `src/api/replay-client.ts` with three exported functions:

**`fetchSessionReplay(gatewayUrl: string, sessionKey: string, afterSeq?: number): Promise<ReplayEvent[]>`**
- GET `${gatewayUrl}/api/sessions/${sessionKey}/events${afterSeq != null ? '?afterSeq=' + afterSeq : ''}`
- Parse JSON response as `ReplayEvent[]`
- On fetch error or non-ok response, return empty array (silent failure -- replay is best-effort)
- Use `AbortSignal.timeout(10_000)` to prevent hanging

**`fetchTurnReplay(gatewayUrl: string, turnId: string, afterSeq?: number): Promise<ReplayEvent[]>`**
- GET `${gatewayUrl}/api/turns/${turnId}/events${afterSeq != null ? '?afterSeq=' + afterSeq : ''}`
- Same error handling as fetchSessionReplay

**`replayEventsAsChunks(events: ReplayEvent[], emitChunkCallback: (chunk: VoiceTurnChunk) => void): number`**
- Iterates events in order (they arrive sorted by seq from gateway)
- Maps each event to VoiceTurnChunk(s) using the same mapping logic as handleServerSentEvent in gateway-client.ts:
  - `transcript` -> `{ type: 'transcript', text: event.payload.transcript, turnId: event.turnId }`
  - `assistant_delta` -> emit `{ type: 'response_start', turnId }` before the FIRST delta per turnId, then `{ type: 'response_delta', text: event.payload.text, turnId }`
  - `done` -> `{ type: 'response_end', turnId }`
  - `error` -> `{ type: 'error', error: event.payload.error }`
- Track "has emitted response_start" PER turnId (replays may span multiple turns)
- Returns the highest `seq` seen (or -1 if events is empty), so the caller can update lastEventSeq
- Cast `event.payload` as `Record<string, unknown>` internally for field access

3. Create `src/__tests__/replay-client.test.ts` with tests:
- `fetchSessionReplay` — successful fetch returns parsed events (mock fetch)
- `fetchSessionReplay` — appends ?afterSeq=N when provided
- `fetchSessionReplay` — returns [] on network error
- `fetchSessionReplay` — returns [] on non-ok response
- `fetchTurnReplay` — successful fetch returns parsed events
- `fetchTurnReplay` — appends ?afterSeq=N when provided
- `replayEventsAsChunks` — maps transcript event to transcript chunk
- `replayEventsAsChunks` — maps assistant_delta events with response_start before first delta
- `replayEventsAsChunks` — maps done event to response_end chunk
- `replayEventsAsChunks` — maps error event to error chunk
- `replayEventsAsChunks` — returns highest seq number seen
- `replayEventsAsChunks` — returns -1 for empty events array
- `replayEventsAsChunks` — multi-turn replay emits response_start per turn (tracks per-turnId)
- `replayEventsAsChunks` — unknown event type is silently skipped

Use the same test patterns as gateway-client.test.ts: save/restore globalThis.fetch in beforeEach/afterEach, vi.fn() mocks.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/replay-client.test.ts</automated>
  </verify>
  <done>
    - ReplayEvent type exists in types.ts
    - fetchSessionReplay and fetchTurnReplay call correct endpoints, handle errors gracefully
    - replayEventsAsChunks maps all 4 event types to correct VoiceTurnChunks with per-turnId response_start tracking
    - All 14 tests pass
  </done>
</task>

<task type="auto">
  <name>Task 2: Add lastEventSeq tracking to gateway-client + wire resume sync in glasses-main + tests</name>
  <files>
    src/api/gateway-client.ts
    src/__tests__/gateway-client.test.ts
    src/glasses-main.ts
    src/__tests__/glasses-main.test.ts
  </files>
  <action>
1. **Enhance `src/api/gateway-client.ts`** with seq cursor tracking:

Add inside the `createGatewayClient` closure:
- `let lastEventSeq: number | null = null;`
- On construction, read from localStorage: `lastEventSeq = Number(localStorage.getItem('openclaw-last-event-seq')) || null;` (wrap in try/catch for localStorage unavailable)
- `function getLastSeq(): number | null { return lastEventSeq; }`
- `function setLastSeq(seq: number): void { lastEventSeq = seq; try { localStorage.setItem('openclaw-last-event-seq', String(seq)); } catch {} }`

Modify `handleServerSentEvent` to accept an optional `seq?: number` parameter. When a seq is provided and is greater than current lastEventSeq (or lastEventSeq is null), call `setLastSeq(seq)`. This requires threading seq through from the SSE parser.

However, the SSE stream from the gateway during normal voice turns does NOT include a seq field in the event data -- seq is only present in replay endpoint responses. So for normal SSE parsing, seq is NOT available and handleServerSentEvent should NOT try to extract it. Instead:

**Simpler approach:** Only update lastEventSeq via the public `setLastSeq` method, called by glasses-main after replay. The SSE stream during normal voice turns does not carry seq numbers. The seq cursor is only meaningful for replay resume and is set after processing replay events.

So the change to gateway-client.ts is minimal:
- Add `lastEventSeq` state variable (initialized from localStorage)
- Add `getLastSeq()` and `setLastSeq(seq)` functions
- Export both in the returned object
- In `destroy()`, do NOT clear lastEventSeq (it should persist across boot cycles)

2. **Add tests to `src/__tests__/gateway-client.test.ts`** in a new `describe('lastEventSeq tracking')` block:
- `getLastSeq` returns null initially (when no localStorage value)
- `setLastSeq` updates the value and persists to localStorage
- `getLastSeq` reads from localStorage on construction
- `destroy` does not clear lastEventSeq from localStorage

Mock localStorage using vi.spyOn(Storage.prototype, 'getItem') and vi.spyOn(Storage.prototype, 'setItem') patterns, or use the real localStorage in jsdom (vitest default). Clean up in afterEach.

3. **Wire resume sync in `src/glasses-main.ts`**:

Add import at top:
```typescript
import { fetchSessionReplay, replayEventsAsChunks } from './api/replay-client';
```

After the gateway health check block (around line 537, before the cleanup function), add resume sync:
```typescript
// ── Resume sync: replay missed events from gateway ──
// On reboot (visibility hidden -> visible), fetch events after the last
// known seq and feed them through the chunk pipeline. Auto-save and the
// renderer will update naturally from the replayed chunks.
if (settings.gatewayUrl && settings.sessionKey) {
  const lastSeq = gateway.getLastSeq();
  if (lastSeq != null) {
    fetchSessionReplay(settings.gatewayUrl, settings.sessionKey, lastSeq)
      .then((events) => {
        if (events.length > 0) {
          const highestSeq = replayEventsAsChunks(events, (chunk) => {
            bus.emit('gateway:chunk', chunk);
          });
          if (highestSeq > 0) {
            gateway.setLastSeq(highestSeq);
          }
          bus.emit('log', {
            level: 'info',
            msg: `Resume sync: replayed ${events.length} events (seq ${lastSeq} -> ${highestSeq})`,
          });
        }
      })
      .catch(() => {
        bus.emit('log', { level: 'warn', msg: 'Resume sync: replay fetch failed (non-critical)' });
      });
  }
}
```

Key design decisions:
- Emit replayed chunks via `bus.emit('gateway:chunk', chunk)` NOT `gateway.emitChunk()` (emitChunk is internal). The bus is what auto-save and display-controller subscribe to. Actually, looking at the code: auto-save subscribes to `bus.on('gateway:chunk')` and the voice-loop-controller bridges gateway.onChunk -> bus.emit('gateway:chunk'). So we should emit directly to bus for replayed events, bypassing the gateway's internal emitChunk.
- Fire-and-forget (non-blocking) -- don't await the replay, let boot continue
- Silent failure -- replay is best-effort, user doesn't need to know

4. **Add test to `src/__tests__/glasses-main.test.ts`** (if the existing test file has a pattern for this -- add a focused test for replay wiring). Look at the existing test patterns first. If glasses-main.test.ts heavily mocks all modules, add a test that verifies fetchSessionReplay is called when lastSeq is available and settings have a sessionKey. If the test file is too complex to extend, skip this specific integration test and rely on the unit tests from Task 1 + Task 2's gateway-client tests.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts src/__tests__/glasses-main.test.ts</automated>
  </verify>
  <done>
    - gateway-client exposes getLastSeq() and setLastSeq() with localStorage persistence
    - glasses-main.ts imports replay-client and calls fetchSessionReplay + replayEventsAsChunks after boot when lastSeq is available
    - Replayed events are emitted to bus as gateway:chunk so auto-save and renderer process them
    - All existing 681 tests still pass, new lastEventSeq tests pass
  </done>
</task>

</tasks>

<verification>
- `npx vitest run` -- all tests pass (681 existing + new replay-client + lastEventSeq tests)
- `npx tsc --noEmit` -- no type errors
- New ReplayEvent type in types.ts is used by replay-client.ts
- gateway-client.ts exports getLastSeq and setLastSeq
- glasses-main.ts imports and uses fetchSessionReplay and replayEventsAsChunks
</verification>

<success_criteria>
- replay-client.ts correctly fetches from gateway replay endpoints and maps events to VoiceTurnChunks
- Per-turnId response_start tracking works for multi-turn replays
- lastEventSeq persists across boot cycles via localStorage
- Resume sync fires on reboot with a valid lastSeq and sessionKey
- All tests pass, no type errors, no regressions
</success_criteria>

<output>
After completion, create `.planning/quick/50-frontend-resume-sync-track-lasteventseq-/50-SUMMARY.md`
</output>
