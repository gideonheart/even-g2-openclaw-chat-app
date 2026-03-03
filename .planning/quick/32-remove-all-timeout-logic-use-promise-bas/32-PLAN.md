---
phase: quick-32
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/api/gateway-client.ts
  - src/gestures/gesture-handler.ts
  - src/__tests__/gateway-client.test.ts
  - src/__tests__/gesture-handler.test.ts
autonomous: true
requirements: [QUICK-32]

must_haves:
  truths:
    - "No setTimeout-based timeouts exist in sendVoiceTurn or sendTextTurn"
    - "AbortError from manual abort is handled silently (not shown as timeout)"
    - "Health tab status does not show Connecting on every request"
    - "Watchdog uses a single 120s constant for all transient states"
    - "npm run build succeeds with zero errors"
  artifacts:
    - path: "src/api/gateway-client.ts"
      provides: "Timeout-free gateway client with promise-based error propagation"
      contains: "handleTurnError"
    - path: "src/gestures/gesture-handler.ts"
      provides: "Unified 120s watchdog for all transient states"
      contains: "WATCHDOG_MS"
    - path: "src/__tests__/gateway-client.test.ts"
      provides: "Updated tests without timeout assertions"
    - path: "src/__tests__/gesture-handler.test.ts"
      provides: "Updated watchdog tests using 120s for all states"
  key_links:
    - from: "src/api/gateway-client.ts"
      to: "fetch"
      via: "AbortController signal (manual abort only, no timeout)"
      pattern: "abortController = new AbortController"
    - from: "src/gestures/gesture-handler.ts"
      to: "watchdog timer"
      via: "single WATCHDOG_MS constant"
      pattern: "WATCHDOG_MS = 120_000"
---

<objective>
Remove all timeout logic from gateway client and gesture handler. Use promise-based error propagation (fetch naturally resolves/rejects). Fix Health tab status by removing setStatus('connecting') from turn functions. Unify watchdog to single 120s constant.

Purpose: Eliminate artificial timeouts that mask real errors, fix misleading "Connecting..." status on every request, simplify watchdog coordination.
Output: Clean gateway client and gesture handler with updated tests, passing build.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/api/gateway-client.ts
@src/gestures/gesture-handler.ts
@src/__tests__/gateway-client.test.ts
@src/__tests__/gesture-handler.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove timeout logic from gateway-client.ts and fix status handling</name>
  <files>src/api/gateway-client.ts, src/__tests__/gateway-client.test.ts</files>
  <action>
In `src/api/gateway-client.ts`:

1. **Delete lines 123-147 entirely** (the timeout constants block):
   - Delete `TEXT_TURN_TIMEOUT_MS = 30_000` (line 126)
   - Delete `VOICE_TURN_BASE_TIMEOUT_MS = 60_000` (line 139)
   - Delete `VOICE_TURN_MAX_TIMEOUT_MS = 180_000` (line 140)
   - Delete `PCM_BYTES_PER_SECOND = 32_000` (line 141)
   - Delete `voiceTurnTimeout()` function (lines 143-147)
   - Delete all associated JSDoc comments (lines 123-138)

2. **Simplify `sendVoiceTurn`** (currently lines 238-263):
   - Remove `const timeoutMs = voiceTurnTimeout(request.audio);` (line 246)
   - Remove `const timeoutId = setTimeout(...)` block (lines 247-249)
   - Remove `setStatus('connecting');` (line 251)
   - Remove both `clearTimeout(timeoutId);` calls (lines 255, 260)
   - Keep `abort()` + `abortController = new AbortController()` (manual abort still needed)
   - Keep `setStatus('connected')` on success (recovers from heartbeat-detected error)
   - Keep `health.reconnectAttempts = 0` on success

   Result should look like:
   ```typescript
   async function sendVoiceTurn(settings: AppSettings, request: VoiceTurnRequest): Promise<void> {
     if (!settings.gatewayUrl) {
       emitChunk({ type: 'error', error: 'Gateway URL not configured' });
       return;
     }
     abort();
     abortController = new AbortController();
     try {
       const reply = await postVoiceTurn(settings, request.audio);
       setStatus('connected');
       health.reconnectAttempts = 0;
       emitFromGatewayReply(reply);
     } catch (err) {
       handleTurnError(err);
     }
   }
   ```

3. **Simplify `sendTextTurn`** (currently lines 286-310): Same pattern as sendVoiceTurn:
   - Remove `const timeoutId = setTimeout(...)` block (lines 294-296)
   - Remove `setStatus('connecting');` (line 298)
   - Remove both `clearTimeout(timeoutId);` calls (lines 302, 307)

4. **Update `handleTurnError`** (currently lines 204-215):
   - The DOMException branch (line 205): AbortError now ONLY means manual abort (user started a new request). TimeoutError is impossible.
   - Change line 205-207 to: silently return on AbortError (no error chunk, no status change). The user initiated a new request; the old one being cancelled is expected.
   - Remove 'TimeoutError' from the condition since it can no longer occur.

   Updated handleTurnError:
   ```typescript
   function handleTurnError(err: unknown): void {
     if (err instanceof DOMException && err.name === 'AbortError') {
       // Manual abort -- user started a new request. Silent, no error shown.
       return;
     } else if (err instanceof GatewayAppError) {
       emitChunk({ type: 'error', error: err.message });
       setStatus('connected');
     } else {
       emitChunk({ type: 'error', error: err instanceof Error ? err.message : 'Gateway request failed' });
       setStatus('error');
     }
   }
   ```

5. **Update the JSDoc above `handleTurnError`** (lines 190-203): Remove references to timeout. Change category 1 description:
   - From: "DOMException (AbortError / TimeoutError) -- request was cancelled or timed out"
   - To: "DOMException (AbortError) -- request was cancelled by a newer request. Silent."

6. **Update `GatewayAppError` JSDoc** (line 181): Remove "and timeouts (DOMException) which mean the gateway is genuinely unreachable" -- timeouts no longer exist.

In `src/__tests__/gateway-client.test.ts`:

1. **Delete the two voice turn timeout tests** (lines 369-452):
   - Delete "voice turn timeout scales with audio blob size" test
   - Delete "voice turn with small audio blob uses base timeout of 60s" test
   These tests verify timeout behavior that no longer exists.

2. **Update the TimeoutError test** (lines 245-270, "does not retry on TimeoutError and emits timeout error chunk"):
   - Rename to "silently handles AbortError from manual abort (no error chunk)"
   - Change the mock to reject with `new DOMException('Aborted', 'AbortError')`
   - Assert: `chunks` array is EMPTY (no error chunk emitted)
   - Assert: fetch called once (no retry)
   - Assert: status does NOT change (no 'error' status set). Since we never called setStatus('connecting') and the abort is silent, `statuses` should be empty.

3. **Update the existing AbortError test** (lines 272-290, "emits error on AbortError"):
   - Update to assert that AbortError is handled silently:
   - Assert: `chunks` is empty (no error chunk)
   - Assert: health.reconnectAttempts stays 0

4. **Update status assertions across ALL sendVoiceTurn tests**:
   - In "successful voice turn emits chunks" (line 167): `statuses` should be `['connected']` (no 'connecting' before it).
   - In "emits error on network failure" (line 223): `statuses` should be `['error']` (no 'connecting' before it).

5. **Update status assertions across ALL sendTextTurn tests**:
   - In "emits error chunk on gateway failure" (line 605): `statuses` should be `['connected']` (GatewayAppError path, no 'connecting').
   - In "surfaces gateway JSON error message" (line 627): same, `['connected']`.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>
    - Zero timeout constants, setTimeout calls, or clearTimeout calls in sendVoiceTurn/sendTextTurn
    - handleTurnError silently returns on AbortError (no error chunk, no status change)
    - No setStatus('connecting') in sendVoiceTurn or sendTextTurn
    - setStatus('connected') remains on success path
    - All gateway-client tests pass with updated assertions
  </done>
</task>

<task type="auto">
  <name>Task 2: Simplify gesture-handler watchdog to unified 120s and update tests</name>
  <files>src/gestures/gesture-handler.ts, src/__tests__/gesture-handler.test.ts</files>
  <action>
In `src/gestures/gesture-handler.ts`:

1. **Replace the two watchdog constants and function** (lines 65-70):
   - Delete `WATCHDOG_RECORDING_MS = 120_000` (line 65)
   - Delete `WATCHDOG_SENT_MS = 210_000` (line 66)
   - Delete `watchdogMs()` function (lines 68-70)
   - Add single constant: `const WATCHDOG_MS = 120_000; // 2 min for all transient states`

2. **Update the JSDoc** (lines 59-64): Simplify to:
   ```
   /** Watchdog timeout: resets FSM if stuck in any transient state for 2 minutes. */
   ```

3. **Update `startWatchdog`** (line 86): Replace `const ms = watchdogMs();` with `const ms = WATCHDOG_MS;`

In `src/__tests__/gesture-handler.test.ts`:

1. **Update the describe block comment** (line 558): Change from "State-dependent watchdog: recording = 120s, sent/thinking = 210s" to "Unified watchdog: 120s for all transient states (recording, sent, thinking)"

2. **Update "resets FSM to idle after 210s in sent state" test** (lines 578-586):
   - Rename to "resets FSM to idle after 120s in sent state"
   - Change `vi.advanceTimersByTime(210_000)` to `vi.advanceTimersByTime(120_000)`

3. **Update "does NOT reset FSM before 210s in sent state" test** (lines 588-596):
   - Rename to "does NOT reset FSM before 120s in sent state"
   - Change `vi.advanceTimersByTime(209_999)` to `vi.advanceTimersByTime(119_999)`

4. **Update "resets watchdog timer on response_delta chunks" test** (lines 648-667):
   - The test currently advances 200s, sends a delta, advances 200s more, then 10s (total 210s since delta).
   - Change: advance 100s, send delta, advance 100s more (should NOT fire since only 100s since delta), advance 20s (now 120s since delta, SHOULD fire).
   - Updated flow:
     ```
     bus.emit tap -> recording, tap -> sent
     vi.advanceTimersByTime(100_000);  // 100s into sent
     bus.emit response_delta
     vi.advanceTimersByTime(100_000);  // 100s since delta -- NOT fired
     expect(spy).not.toHaveBeenCalled();
     vi.advanceTimersByTime(20_000);   // 120s since delta -- fires
     expect(spy).toHaveBeenCalledOnce();
     ```

5. **Update "clears watchdog on state transition to idle" test** (lines 669-684):
   - Change `vi.advanceTimersByTime(210_000)` to `vi.advanceTimersByTime(120_000)` (just needs to be >= watchdog to prove it was cleared)

6. **Update "emits fsm:watchdog-reset event" test** (lines 598-611): The test already uses recording state with 120_000, so no change needed. But verify the `elapsed` assertion still expects `120_000`.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gesture-handler.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>
    - Single WATCHDOG_MS = 120_000 constant, no watchdogMs() function
    - All transient states (recording, sent, thinking) use 120s watchdog
    - All gesture-handler tests pass with updated 120s assertions
  </done>
</task>

<task type="auto">
  <name>Task 3: Build verification and full test suite</name>
  <files></files>
  <action>
Run the full build and test suite to verify everything compiles and all tests pass:

1. Run `npm run build` -- must succeed with zero errors
2. Run `npx vitest run` -- all tests must pass (expect ~622 tests, none failing)
3. If any failures, diagnose and fix. Common issues:
   - TypeScript errors from leftover references to removed constants/functions
   - Test assertions that still expect 'connecting' status
   - Test assertions that still expect timeout error messages
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm run build 2>&1 | tail -5 && npx vitest run 2>&1 | tail -10</automated>
  </verify>
  <done>
    - npm run build exits 0
    - All tests pass (zero failures)
    - No TypeScript errors related to removed timeout constants
  </done>
</task>

</tasks>

<verification>
1. `npm run build` succeeds
2. `npx vitest run` -- all tests pass
3. `grep -n 'TIMEOUT\|timeout\|setTimeout\|clearTimeout' src/api/gateway-client.ts` returns no matches in sendVoiceTurn/sendTextTurn (setTimeout may still exist in checkHealth for AbortSignal.timeout -- that is fine, it is unrelated)
4. `grep -n "setStatus('connecting')" src/api/gateway-client.ts` returns zero matches
5. `grep -n 'watchdogMs\|WATCHDOG_RECORDING\|WATCHDOG_SENT' src/gestures/gesture-handler.ts` returns zero matches
6. `grep -n 'WATCHDOG_MS' src/gestures/gesture-handler.ts` returns exactly one match
</verification>

<success_criteria>
- Zero timeout logic in sendVoiceTurn and sendTextTurn (no setTimeout, no clearTimeout, no timeout constants)
- AbortError handled silently in handleTurnError (manual abort only)
- No setStatus('connecting') in turn functions
- setStatus('connected') preserved on success
- Single WATCHDOG_MS = 120_000 in gesture-handler
- npm run build succeeds
- All tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/32-remove-all-timeout-logic-use-promise-bas/32-SUMMARY.md`
</output>
