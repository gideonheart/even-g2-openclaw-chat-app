---
phase: quick-29
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/api/gateway-client.ts
  - src/__tests__/gateway-client.test.ts
  - src/app-wiring.ts
  - src/__tests__/app-wiring.test.ts
  - src/types.ts
  - .planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-ANALYSIS.md
autonomous: true
requirements: [QUICK-29]

must_haves:
  truths:
    - "sendVoiceTurn and sendTextTurn share a single error-handling function instead of duplicated catch blocks"
    - "Deprecated connectGlasses/disconnectGlasses functions are removed from source and tests"
    - "Unused parseSSELines function and SSEEvent type are removed from production code"
    - "All existing tests pass after cleanup"
  artifacts:
    - path: "src/api/gateway-client.ts"
      provides: "Gateway client with DRY error handling, no dead SSE code"
    - path: "src/__tests__/gateway-client.test.ts"
      provides: "Tests updated to remove parseSSELines tests"
    - path: "src/app-wiring.ts"
      provides: "App wiring without deprecated glasses functions"
    - path: "src/__tests__/app-wiring.test.ts"
      provides: "Tests without deprecated glasses function tests"
    - path: ".planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-ANALYSIS.md"
      provides: "Root cause analysis of why disconnect-on-record bug persisted"
  key_links:
    - from: "sendVoiceTurn"
      to: "handleTurnError (new)"
      via: "shared catch handler"
      pattern: "handleTurnError"
    - from: "sendTextTurn"
      to: "handleTurnError (new)"
      via: "shared catch handler"
      pattern: "handleTurnError"
---

<objective>
DRY/SRP cleanup of recent gateway error-distinction changes, removal of dead legacy code, and root cause analysis of why the disconnect-on-record bug persisted.

Purpose: The recent checkpoint (dda6b19) introduced correct error classification in gateway-client.ts, but the fix duplicated the identical catch block between sendVoiceTurn and sendTextTurn (DRY violation). Additionally, three pieces of dead code remain: deprecated connectGlasses/disconnectGlasses wrappers, unused parseSSELines function (SSE is no longer used -- gateway is pure HTTP POST + JSON), and the SSEEvent type. This plan consolidates error handling, removes dead code, and documents the root cause analysis.

Output: Cleaned gateway-client.ts, cleaned app-wiring.ts, removed dead tests, root cause analysis document.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/api/gateway-client.ts
@src/__tests__/gateway-client.test.ts
@src/app-wiring.ts
@src/__tests__/app-wiring.test.ts
@src/types.ts
@.planning/debug/resolved/gateway-disconnect-on-record.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract shared error handler and remove dead SSE/deprecated code</name>
  <files>
    src/api/gateway-client.ts
    src/__tests__/gateway-client.test.ts
    src/app-wiring.ts
    src/__tests__/app-wiring.test.ts
    src/types.ts
  </files>
  <action>
    **DRY fix in gateway-client.ts:**
    Extract the duplicated catch block from sendVoiceTurn (lines 255-270) and sendTextTurn (lines 314-329) into a shared private function:

    ```ts
    function handleTurnError(err: unknown): void {
      if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        emitChunk({ type: 'error', error: 'Request timed out. Tap to retry.' });
        setStatus('error');
      } else if (err instanceof GatewayAppError) {
        emitChunk({ type: 'error', error: err.message });
        setStatus('connected');
      } else {
        emitChunk({ type: 'error', error: err instanceof Error ? err.message : 'Gateway request failed' });
        setStatus('error');
      }
    }
    ```

    Then both sendVoiceTurn and sendTextTurn catch blocks become:
    ```ts
    } catch (err) {
      clearTimeout(timeoutId);
      handleTurnError(err);
    }
    ```

    Preserve all existing comments inside handleTurnError explaining the three error categories.

    **Dead code removal in gateway-client.ts:**
    1. Remove the `parseSSELines` function entirely (lines 13-56). It was for SSE streaming which the gateway no longer uses (pure HTTP POST + JSON reply). Only used in tests.
    2. Remove the `SSEEvent` import from the type imports at top of file (line 5).
    3. Remove the comment "SSE line parser (kept for tests/backward compatibility)" (line 12).

    **Dead code removal in types.ts:**
    Remove the `SSEEvent` interface (around line 70). Verify no other file imports it first (confirmed: only gateway-client.ts uses it for parseSSELines).

    **Dead code removal in gateway-client.test.ts:**
    1. Remove the entire `describe('parseSSELines', ...)` block (lines 6-70).
    2. Update the import to remove `parseSSELines`: change to `import { createGatewayClient } from '../api/gateway-client';`

    **Dead code removal in app-wiring.ts:**
    1. Remove the deprecated `connectGlasses` function (lines 82-88) and its JSDoc.
    2. Remove the deprecated `disconnectGlasses` function (lines 91-97) and its JSDoc.
    3. Remove the "DEPRECATED" section comment (lines 79-80).
    These functions are not used in any production code -- only in tests that explicitly test the deprecated wrappers.

    **Dead code removal in app-wiring.test.ts:**
    1. Remove `connectGlasses` and `disconnectGlasses` from the import statement.
    2. Remove the two describe blocks: `describe('connectGlasses (deprecated)', ...)` and `describe('disconnectGlasses (deprecated)', ...)` (approximately lines 131-162).
    3. Remove the `// -- Deprecated (backward compat) --` comment.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run --reporter=verbose 2>&1 | tail -20</automated>
    <manual>Verify test count decreased by the removed test cases (parseSSELines: 9 tests, connectGlasses: 1 test, disconnectGlasses: 1 test = 11 fewer tests) but all remaining tests pass</manual>
  </verify>
  <done>
    - sendVoiceTurn and sendTextTurn use shared handleTurnError -- zero duplicated catch logic
    - parseSSELines removed from gateway-client.ts (dead code -- SSE no longer used)
    - SSEEvent interface removed from types.ts
    - parseSSELines test block removed from gateway-client.test.ts
    - connectGlasses/disconnectGlasses removed from app-wiring.ts and their tests removed from app-wiring.test.ts
    - All remaining tests pass (count reduced by ~11)
    - Build succeeds
  </done>
</task>

<task type="auto">
  <name>Task 2: Root cause analysis document</name>
  <files>
    .planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-ANALYSIS.md
  </files>
  <action>
    Create a root cause analysis document at the specified path covering:

    **1. Why the disconnect-on-record bug persisted (architectural root cause):**

    The bug persisted because of a **Single Responsibility violation** in the error handling path:
    - `setStatus('error')` in the catch block served two different semantic roles: (a) "gateway is unreachable" (network error), and (b) "gateway rejected the request" (4xx/5xx).
    - `buildHealthViewModel` mapped ANY `status === 'error'` to the label "Unreachable" -- it had no way to distinguish "unreachable" from "request rejected".
    - When the gateway returned a 400 ("Transcription returned empty text"), the UI showed "Unreachable" even though the gateway was perfectly reachable. This made debugging focus on connectivity (CORS, network, WebSocket misconceptions) rather than the actual audio/STT issue.
    - The catch-all `setStatus('error')` was the original design from Phase 4 (API client). At that time, non-OK HTTP responses were genuinely unexpected. As the gateway matured and started returning structured 4xx errors (empty transcription, invalid config), the single error bucket became misleading.

    **2. Why it wasn't caught earlier:**
    - Tests verified the surface behavior ("emits error chunk on non-ok response") without asserting the STATUS SIDE-EFFECT ("and status should remain connected"). The tests were green but incomplete.
    - The bug was invisible in development: the gateway rarely returns 4xx during dev (controlled inputs, local network). It manifests under real-world conditions (short/noisy audio, CORS misconfiguration).
    - "Unreachable" label misdirected investigation toward network/CORS (quick-13, 14, 16, 17) instead of error classification.

    **3. DRY violations found and fixed:**
    - sendVoiceTurn and sendTextTurn had identical 15-line catch blocks -- extracted to handleTurnError.
    - postVoiceTurn and postTextTurn share the `throw new GatewayAppError(await readGatewayError(resp))` pattern but differ enough in request construction (audio blob vs JSON body, different Content-Type) that extracting further would over-abstract. Leave as-is.

    **4. Dead code removed:**
    - `parseSSELines` + `SSEEvent`: Vestigial from when gateway used SSE streaming. Gateway has been pure HTTP POST + JSON reply since Phase 4. Only used by tests.
    - `connectGlasses` / `disconnectGlasses`: Superseded by `setGlassesConnected` / `setGlassesDisconnected` in Phase 10. Wrappers with hardcoded mock values ("Even G2 (mock)", "87 %"). Not used in production code.

    **5. Pattern observation for future:**
    - When adding error classification to a shared client, always assert both the user-facing effect (error chunk emitted) AND the internal state effect (status value). Test both dimensions.
    - When multiple callers share identical error handling, extract immediately -- duplication signals the logic is a policy, not a one-off.

    Format as a clean markdown document with sections. Keep it concise -- this is for the developer's reference, not external documentation.
  </action>
  <verify>
    <automated>test -f /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app/.planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-ANALYSIS.md && echo "PASS: analysis exists"</automated>
  </verify>
  <done>
    - 29-ANALYSIS.md exists with root cause analysis covering: why the bug persisted (SRP violation in error classification), why it wasn't caught (incomplete test assertions + misdirected debugging), DRY violations found, dead code removed, and pattern lessons for future
  </done>
</task>

</tasks>

<verification>
- `npx vitest run` -- all remaining tests pass
- `npx vite build` -- production build succeeds
- `grep -c 'parseSSELines' src/api/gateway-client.ts` returns 0
- `grep -c 'connectGlasses\|disconnectGlasses' src/app-wiring.ts` returns 0
- `grep -c 'SSEEvent' src/types.ts` returns 0
- `grep -c 'handleTurnError' src/api/gateway-client.ts` returns at least 3 (definition + 2 call sites)
</verification>

<success_criteria>
- Zero duplicated catch blocks between sendVoiceTurn and sendTextTurn
- Dead code removed: parseSSELines, SSEEvent, connectGlasses, disconnectGlasses
- All remaining tests pass (count reduced by ~11 removed dead-code tests)
- Build succeeds
- Root cause analysis document exists
</success_criteria>

<output>
After completion, create `.planning/quick/29-analyze-recent-changes-for-dry-srp-remov/29-SUMMARY.md`
</output>
