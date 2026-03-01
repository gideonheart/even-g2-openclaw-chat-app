---
phase: quick-13
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/api/gateway-client.ts
  - src/types.ts
  - src/app-wiring.ts
  - src/__tests__/gateway-client.test.ts
  - src/__tests__/app-wiring.test.ts
  - index.html
autonomous: true
requirements: [QUICK-13]

must_haves:
  truths:
    - "Health check calls /readyz instead of /healthz"
    - "Gateway health state exposes readyz details (STT + OpenClaw sub-checks)"
    - "Health page shows Voice Gateway with meaningful readyz status details"
    - "All existing tests pass with /readyz references"
  artifacts:
    - path: "src/api/gateway-client.ts"
      provides: "checkHealth using /readyz with parsed readiness details"
      contains: "/readyz"
    - path: "src/types.ts"
      provides: "Extended GatewayHealthState with readyz detail fields"
      contains: "sttReady"
    - path: "src/app-wiring.ts"
      provides: "buildHealthViewModel using readyz detail for richer label"
    - path: "index.html"
      provides: "Voice Gateway label in settings"
      contains: "Voice Gateway URL"
  key_links:
    - from: "src/api/gateway-client.ts"
      to: "/readyz endpoint"
      via: "fetch in checkHealth"
      pattern: "fetch.*readyz"
    - from: "src/app-wiring.ts"
      to: "src/api/gateway-client.ts"
      via: "GatewayHealthState consumed by buildHealthViewModel"
---

<objective>
Switch the gateway health check from the liveness endpoint (/healthz) to the readiness endpoint (/readyz), and surface the richer readyz response (STT + OpenClaw sub-check status) in the health view. Also rename remaining "Gateway URL" label to "Voice Gateway URL" in settings.

Purpose: /healthz always returns 200 (liveness only), making it useless for actual health monitoring. /readyz returns real dependency status (STT ready, OpenClaw ready) with 200/503, giving meaningful health feedback.

Output: Updated gateway-client, types, app-wiring, index.html, and tests.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/api/gateway-client.ts
@src/types.ts
@src/app-wiring.ts
@src/__tests__/gateway-client.test.ts
@src/__tests__/app-wiring.test.ts
@src/hub-main.ts (reference only -- refreshHealthDisplay wiring, do NOT modify)
@src/glasses-main.ts (reference only -- checkHealth call site, do NOT modify)
@index.html
</context>

<tasks>

<task type="auto">
  <name>Task 1: Switch checkHealth to /readyz and extend GatewayHealthState</name>
  <files>
    src/types.ts
    src/api/gateway-client.ts
    src/__tests__/gateway-client.test.ts
  </files>
  <action>
1. In `src/types.ts`, extend `GatewayHealthState` with optional readyz detail fields:
   ```ts
   export interface GatewayHealthState {
     status: ConnectionStatus;
     lastHeartbeat: number | null;
     reconnectAttempts: number;
     latencyMs: number | null;
     // Readyz detail (populated when /readyz returns a parseable body)
     readyStatus?: 'ready' | 'not_ready';
     sttReady?: boolean;
     openclawReady?: boolean;
   }
   ```
   These are optional so existing consumers (glasses-main, hub-main) that only check the boolean return continue to work unchanged.

2. In `src/api/gateway-client.ts`, update `checkHealth`:
   - Change fetch URL from `${gatewayUrl}/healthz` to `${gatewayUrl}/readyz`
   - After `resp.ok` check, attempt to parse the JSON body:
     ```ts
     async function checkHealth(gatewayUrl: string): Promise<boolean> {
       const start = Date.now();
       try {
         const resp = await fetch(`${gatewayUrl}/readyz`, {
           method: 'GET',
           signal: AbortSignal.timeout(5000),
         });
         health.latencyMs = Date.now() - start;
         health.lastHeartbeat = Date.now();

         // Parse readyz body for detail (best-effort, don't fail on parse errors)
         try {
           const body = await resp.json();
           health.readyStatus = body.status === 'ready' ? 'ready' : 'not_ready';
           health.sttReady = body.checks?.stt?.status === 'ok' || body.checks?.stt?.status === 'ready';
           health.openclawReady = body.checks?.openclaw?.status === 'ok' || body.checks?.openclaw?.status === 'ready';
         } catch {
           // Non-JSON response -- clear detail fields
           health.readyStatus = undefined;
           health.sttReady = undefined;
           health.openclawReady = undefined;
         }

         return resp.ok;
       } catch {
         health.latencyMs = null;
         return false;
       }
     }
     ```
   - The `getHealth()` spread already copies all fields, so the new optional fields automatically surface.

3. In `src/__tests__/gateway-client.test.ts`, add a new describe block `'checkHealth'` with tests:
   - Test that checkHealth fetches `/readyz` (not `/healthz`)
   - Test that a 200 response with readyz JSON body populates health.readyStatus, sttReady, openclawReady
   - Test that a 503 response still returns false but parses the body for detail
   - Test that a non-JSON response gracefully clears detail fields
   - Test that a network error returns false

   Mock `globalThis.fetch` as done in the existing test patterns. Use `beforeEach`/`afterEach` to save/restore fetch.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/gateway-client.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    - checkHealth fetches /readyz instead of /healthz
    - GatewayHealthState has readyStatus, sttReady, openclawReady optional fields
    - health.getHealth() exposes parsed readyz detail
    - All gateway-client tests pass including new checkHealth tests
  </done>
</task>

<task type="auto">
  <name>Task 2: Enrich health view model with readyz details and rename label</name>
  <files>
    src/app-wiring.ts
    src/__tests__/app-wiring.test.ts
    index.html
  </files>
  <action>
1. In `src/app-wiring.ts`, update `buildHealthViewModel` signature and logic:
   - Add an optional 4th parameter `readyzDetail` to pass in the parsed readyz info:
     ```ts
     export interface ReadyzDetail {
       readyStatus?: 'ready' | 'not_ready';
       sttReady?: boolean;
       openclawReady?: boolean;
     }

     export function buildHealthViewModel(
       settings: AppSettings,
       activeSession: string,
       gatewayLiveStatus?: string,
       readyzDetail?: ReadyzDetail,
     ): HealthViewModel {
     ```
   - In the gateway health section, when `gwDot` is `'ok'` (connected) and `readyzDetail` is provided:
     - If `readyzDetail.readyStatus === 'ready'`, set `gwLabel` to `'Ready'` (or include latency if desired, but keep it simple: just "Ready")
     - If `readyzDetail.readyStatus === 'not_ready'`, set `gwDot = 'warn'` and build a label showing which deps are down, e.g.:
       ```ts
       const down: string[] = [];
       if (readyzDetail.sttReady === false) down.push('STT');
       if (readyzDetail.openclawReady === false) down.push('OpenClaw');
       gwLabel = down.length > 0 ? `Degraded: ${down.join(', ')} down` : 'Not ready';
       ```
     - When `gwDot` is `'err'` (unreachable) and readyzDetail has `readyStatus === 'not_ready'`, keep err dot but enhance label with which deps failed.
   - This is backward-compatible: when `readyzDetail` is undefined (callers not yet updated), behavior is identical to before.

2. In `src/__tests__/app-wiring.test.ts`, add tests for `buildHealthViewModel` with readyz detail:
   - Test: readyzDetail with readyStatus 'ready' shows 'Ready' label when connected
   - Test: readyzDetail with readyStatus 'not_ready' and sttReady=false shows warn dot + "Degraded: STT down"
   - Test: readyzDetail with both sttReady=false and openclawReady=false shows "Degraded: STT, OpenClaw down"
   - Test: readyzDetail undefined (backward compat) behaves exactly as before (existing tests already cover this)

3. In `index.html`, line 414: change the label from "Gateway URL" to "Voice Gateway URL":
   ```html
   <div class="list-item__title">Voice Gateway URL</div>
   ```
   This is the only remaining label that says just "Gateway" -- lines 340 and 410 already say "Voice Gateway".
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/app-wiring.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    - buildHealthViewModel accepts optional readyzDetail and renders enriched labels
    - "Degraded: STT down" or "Degraded: STT, OpenClaw down" shown when /readyz reports not_ready
    - Backward compatible: no readyzDetail = same behavior as before
    - index.html shows "Voice Gateway URL" in settings
    - All app-wiring tests pass including new readyz detail tests
  </done>
</task>

<task type="auto">
  <name>Task 3: Full test suite verification and remaining test updates</name>
  <files>
    src/__tests__/glasses-main.test.ts
  </files>
  <action>
1. Run the full test suite to check for any breakage from the /healthz-to-/readyz change.

2. In `src/__tests__/glasses-main.test.ts`, the mock gateway already uses `checkHealth: vi.fn().mockResolvedValue(true)` which returns a boolean -- this is compatible with the updated signature and does not need changes. Verify this by running the test.

3. Similarly, `src/__tests__/voice-loop-controller.test.ts` has `checkHealth: vi.fn()` which is fine.

4. If any test references the literal string "/healthz", update it to "/readyz". (Grep confirms only `src/api/gateway-client.ts` had the literal "/healthz" string, so no test file updates needed for the URL string itself.)

5. Run full test suite to confirm zero failures.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run --reporter=verbose 2>&1 | tail -40</automated>
  </verify>
  <done>
    - All 528+ tests pass
    - No test references /healthz
    - Gateway health check uses /readyz throughout the codebase
    - Health page displays enriched readyz status when available
  </done>
</task>

</tasks>

<verification>
1. `npx vitest run` -- all tests pass
2. `grep -r '/healthz' src/` -- returns zero matches (only /readyz)
3. `grep 'Voice Gateway URL' index.html` -- returns the settings label
4. `grep 'readyStatus' src/types.ts` -- confirms extended GatewayHealthState
5. `grep '/readyz' src/api/gateway-client.ts` -- confirms endpoint switch
</verification>

<success_criteria>
- Health check endpoint switched from /healthz to /readyz in gateway-client.ts
- GatewayHealthState extended with readyStatus, sttReady, openclawReady fields
- buildHealthViewModel shows degraded status detail when /readyz reports not_ready
- Settings label shows "Voice Gateway URL" instead of "Gateway URL"
- All existing and new tests pass
</success_criteria>

<output>
After completion, create `.planning/quick/13-update-health-section-rename-gateway-to-/13-SUMMARY.md`
</output>
