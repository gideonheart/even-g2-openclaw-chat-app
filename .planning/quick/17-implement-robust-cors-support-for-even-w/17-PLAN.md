---
phase: quick-17
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.ts
  - /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.test.ts
  - /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.ts
  - /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.test.ts
  - /home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/config.ts
  - /home/forge/openclaw-even-g2-voice-gateway/.env
autonomous: false
requirements: [QUICK-17]

must_haves:
  truths:
    - "Gateway accepts requests from Even WebView which sends Origin: null"
    - "Gateway still rejects disallowed origins (e.g. http://evil.example.com) with 403"
    - "Gateway still allows configured origins (bibele.kingdom.lv, localhost:3001)"
    - "Chat app health check (GET /readyz) succeeds from WebView context (no CORS block)"
  artifacts:
    - path: "/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.ts"
      provides: "handleCors with null origin support"
      contains: "allowNullOrigin"
    - path: "/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.test.ts"
      provides: "CORS unit tests for allowed, disallowed, and null origin"
      contains: "handleCors"
    - path: "/home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/config.ts"
      provides: "allowNullOrigin field in ServerConfig"
      contains: "allowNullOrigin"
  key_links:
    - from: "config-loader.ts CORS_ALLOW_NULL_ORIGIN env var"
      to: "ServerConfig.allowNullOrigin"
      via: "loadConfig()"
      pattern: "CORS_ALLOW_NULL_ORIGIN"
    - from: "ServerConfig.allowNullOrigin"
      to: "handleCors() null origin branch"
      via: "configStore.get().server.allowNullOrigin"
      pattern: "allowNullOrigin.*null"
---

<objective>
Add robust CORS support for Even G2 WebView origins to the voice gateway server.

Purpose: The Even App loads the chat app inside `flutter_inappwebview`, which sends
`Origin: null` (the literal string "null") for cross-origin requests. The current
strict CORS policy rejects this, causing health checks and API calls to fail with
CORS errors in the WebView context. This fix adds explicit safe handling for
`Origin: null` behind a configuration flag, while maintaining strict rejection of
truly disallowed origins.

Output: Updated gateway server with null-origin CORS support, comprehensive CORS
unit tests, restarted gateway verified healthy from app context.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/14-restart-voice-gateway-and-verify-health-/14-SUMMARY.md

Gateway repo: /home/forge/openclaw-even-g2-voice-gateway
Chat app repo: /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app

Key files in gateway:
- /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.ts (handleCors function, lines 362-413)
- /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.test.ts (currently only has RateLimiter tests, NO CORS tests)
- /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.ts (loads CORS_ORIGINS from env)
- /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.test.ts
- /home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/config.ts (ServerConfig type)
- /home/forge/openclaw-even-g2-voice-gateway/.env (CORS_ORIGINS=http://localhost:3001,https://bibele.kingdom.lv)

Current CORS behavior:
- `handleCors()` in server.ts checks `req.headers["origin"]` against `corsOrigins` array
- If `corsOrigins` non-empty and origin not in list -> 403 CORS_REJECTED
- If `corsOrigins` empty -> dev mode, allow all
- No origin header (server-to-server) -> pass through without CORS headers
- Problem: WebView sends `Origin: null` (literal string), which is NOT in the
  corsOrigins allowlist, so it gets 403'd

Browser/WebView behavior:
- flutter_inappwebview loading local/packaged files sends `Origin: null`
- This is per RFC 6454: opaque origins serialize to "null"
- The fix must treat "null" origin specially: when allowed, respond with
  `Access-Control-Allow-Origin: null` (NOT `*`)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add allowNullOrigin to ServerConfig, config-loader, and handleCors</name>
  <files>
    /home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/config.ts
    /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.ts
    /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.test.ts
    /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.ts
    /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/server.test.ts
  </files>
  <action>
**Step 1 -- Add `allowNullOrigin` to ServerConfig type**

In `/home/forge/openclaw-even-g2-voice-gateway/packages/shared-types/src/config.ts`, add to `ServerConfig`:
```ts
readonly allowNullOrigin: boolean;
```

**Step 2 -- Load `CORS_ALLOW_NULL_ORIGIN` env var in config-loader**

In `/home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/src/config-loader.ts`, in the `server` object inside `loadConfig()`, add:
```ts
allowNullOrigin: (env["CORS_ALLOW_NULL_ORIGIN"] ?? "").toLowerCase() === "true",
```

**Step 3 -- Add config-loader test for CORS_ALLOW_NULL_ORIGIN**

In `config-loader.test.ts`, add these tests:
- `CORS_ALLOW_NULL_ORIGIN=true` -> `allowNullOrigin: true`
- `CORS_ALLOW_NULL_ORIGIN` not set -> `allowNullOrigin: false`
- `CORS_ALLOW_NULL_ORIGIN=false` -> `allowNullOrigin: false`

**Step 4 -- Update handleCors() in server.ts to handle Origin: null**

The `handleCors()` function signature currently receives `allowedOrigins: readonly string[]`. Change it to also accept `allowNullOrigin: boolean`:

```ts
function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[],
  allowNullOrigin: boolean,
): boolean {
```

Update the call site (line 113) to pass `deps.configStore.get().server.allowNullOrigin`.

Inside the function, add a new branch BEFORE the existing origin checks in strict mode. After `const origin = req.headers["origin"];`, add:

```ts
// WebView/file:// origins send the literal string "null" per RFC 6454.
// When allowNullOrigin is true, treat this as a permitted origin.
if (origin === "null" && allowNullOrigin) {
  res.setHeader("Access-Control-Allow-Origin", "null");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Language-Hint, X-Session-Key",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
```

This MUST be placed at the top of handleCors, before the `if (allowedOrigins.length > 0)` block, so it fires regardless of whether strict mode is active. This way:
- `Origin: null` + `allowNullOrigin: true` -> allowed with CORS headers
- `Origin: null` + `allowNullOrigin: false` -> falls through to the existing strict check, which will 403 it (correct security default)

**Step 5 -- Add CORS unit tests to server.test.ts**

Add a new `describe("handleCors")` block to `server.test.ts`. Since `handleCors` is not exported, test it through the HTTP server. Create a minimal `createGatewayServer` test helper that:
1. Creates a `ConfigStore` with known `corsOrigins` and `allowNullOrigin`
2. Creates a server with mock deps (the existing `makeTestConfig` helper)
3. Sends HTTP requests with various `Origin` headers

Tests to add (use node:http to make requests against the test server):

a) **Allowed origin gets CORS headers**: Request with `Origin: http://localhost:3001`, `corsOrigins: ["http://localhost:3001"]` -> response has `Access-Control-Allow-Origin: http://localhost:3001`

b) **Disallowed origin gets 403**: Request with `Origin: http://evil.example.com`, `corsOrigins: ["http://localhost:3001"]` -> response is 403 with `CORS_REJECTED`

c) **Null origin allowed when allowNullOrigin=true**: Request with `Origin: null`, `allowNullOrigin: true` -> response has `Access-Control-Allow-Origin: null`, status is NOT 403

d) **Null origin rejected when allowNullOrigin=false**: Request with `Origin: null`, `allowNullOrigin: false`, `corsOrigins: ["http://localhost:3001"]` -> 403 CORS_REJECTED

e) **No origin header (server-to-server) passes through**: No `Origin` header, strict mode -> request proceeds (not 403)

f) **Preflight OPTIONS with allowed origin**: `OPTIONS` with allowed origin -> 204 with CORS headers

g) **Preflight OPTIONS with null origin + allowNullOrigin=true**: `OPTIONS` with `Origin: null` -> 204 with CORS headers including `Access-Control-Allow-Origin: null`

For each test: create a server on port 0, listen, make request, verify, close server.

Use lightweight mock deps: `sttProviders: new Map()`, `openclawClient` with stub `healthCheck`, `ready: true`, and a `logger` with no-op methods.

**Step 6 -- Fix all existing test fixtures**

Any existing test that constructs a `ServerConfig` object will need the new `allowNullOrigin` field. Add `allowNullOrigin: false` to:
- `server.test.ts` `makeTestConfig` (inside the server object default)
- `config-store.test.ts` fixtures
- `provider-rebuilder.test.ts` fixtures
- `openclaw-rebuilder.test.ts` fixtures
- Integration test fixtures in `test/integration/*.test.ts`

Search all `.test.ts` files for `corsOrigins:` and add `allowNullOrigin: false` next to each occurrence.

**Step 7 -- Rebuild the gateway**

After all source changes, run:
```bash
cd /home/forge/openclaw-even-g2-voice-gateway && npm run build
```

Then run all tests:
```bash
cd /home/forge/openclaw-even-g2-voice-gateway && npm test
```

All existing tests must pass, plus the new CORS tests.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npm test 2>&1 | tail -20</automated>
    <manual>New CORS tests appear in output: allowed origin, disallowed origin, null origin allowed, null origin rejected, no origin, preflight</manual>
  </verify>
  <done>Gateway server handles Origin:null when allowNullOrigin=true, rejects when false; all existing + new tests pass; gateway builds cleanly</done>
</task>

<task type="auto">
  <name>Task 2: Update .env, restart gateway, verify CORS from all origin types</name>
  <files>
    /home/forge/openclaw-even-g2-voice-gateway/.env
  </files>
  <action>
**Step 1 -- Add CORS_ALLOW_NULL_ORIGIN=true to gateway .env**

Append to `/home/forge/openclaw-even-g2-voice-gateway/.env`:
```
CORS_ALLOW_NULL_ORIGIN=true
```

**Step 2 -- Kill existing gateway process and restart with updated .env**

```bash
# Kill any process on port 4400
kill $(lsof -ti:4400) 2>/dev/null || true
sleep 1

# Start with updated .env
cd /home/forge/openclaw-even-g2-voice-gateway
set -a && source .env && set +a
nohup node services/gateway-api/dist/index.js > /tmp/voice-gateway.log 2>&1 &
sleep 3

# Verify process is listening
ss -tlnp | grep 4400
```

**Step 3 -- Verify CORS behavior with curl**

Run all 6 verification checks:

1. **Allowed origin (bibele.kingdom.lv)**:
```bash
curl -s -D- -H "Origin: https://bibele.kingdom.lv" http://localhost:4400/readyz 2>&1 | head -12
```
Expected: `Access-Control-Allow-Origin: https://bibele.kingdom.lv`, 200/503 (not 403)

2. **Allowed origin (localhost:3001)**:
```bash
curl -s -D- -H "Origin: http://localhost:3001" http://localhost:4400/readyz 2>&1 | head -12
```
Expected: `Access-Control-Allow-Origin: http://localhost:3001`

3. **Null origin (WebView)**:
```bash
curl -s -D- -H "Origin: null" http://localhost:4400/readyz 2>&1 | head -12
```
Expected: `Access-Control-Allow-Origin: null`, status 200 or 503 (NOT 403)

4. **Disallowed origin (evil)**:
```bash
curl -s -D- -H "Origin: http://evil.example.com" http://localhost:4400/readyz 2>&1 | head -5
```
Expected: 403 with CORS_REJECTED

5. **Preflight OPTIONS with null origin**:
```bash
curl -s -D- -X OPTIONS -H "Origin: null" -H "Access-Control-Request-Method: POST" http://localhost:4400/readyz 2>&1 | head -10
```
Expected: 204 with `Access-Control-Allow-Origin: null`

6. **No origin header (server-to-server)**:
```bash
curl -s -D- http://localhost:4400/readyz 2>&1 | head -5
```
Expected: 200/503 (no CORS headers, no 403)
  </action>
  <verify>
    <automated>curl -sf -H "Origin: null" http://localhost:4400/readyz -o /dev/null -w "%{http_code}" && echo " OK (not 403)" || echo " FAIL"</automated>
    <manual>All 6 curl checks pass: bibele allowed, localhost allowed, null allowed, evil rejected, null preflight 204, no-origin pass-through</manual>
  </verify>
  <done>Gateway running with CORS_ALLOW_NULL_ORIGIN=true; Origin:null gets CORS headers; bibele+localhost still allowed; evil origin still 403'd; readyz accessible from WebView context</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Verify CORS works from Even App WebView context</name>
  <files></files>
  <action>
Human verifies that the CORS changes work in the real Even App WebView context.

What was built:
- Voice gateway CORS policy updated to safely handle Origin: null (WebView origins)
- Added allowNullOrigin: boolean to ServerConfig type
- Added CORS_ALLOW_NULL_ORIGIN env var support in config-loader
- Updated handleCors() to allow Origin: null when allowNullOrigin=true
- Added comprehensive CORS unit tests (allowed, disallowed, null, preflight)
- Updated .env and restarted gateway

Security model:
- allowNullOrigin defaults to FALSE (opt-in only)
- Disallowed origins still get 403 CORS_REJECTED
- Origin: null is only allowed when explicitly configured
- The literal string "null" is reflected back (not "*") per CORS spec
  </action>
  <verify>
Human verification steps:
1. Open the Even App on the glasses or phone and navigate to the chat app
2. Check the Health section -- Gateway should show "Reachable" (not "Unreachable")
3. Try sending a voice or text turn -- it should work without CORS errors
4. Check browser DevTools Network tab: requests to the gateway should have
   Access-Control-Allow-Origin: null in response headers (if running from WebView)
5. Alternatively, from a desktop browser dev console, verify:
   fetch('http://localhost:4400/readyz', { headers: { 'Origin': 'null' } })
     .then(r => r.json()).then(console.log)
   Should return readyz JSON, not a CORS error
  </verify>
  <done>Gateway health check accessible from Even App WebView context without CORS errors</done>
</task>

</tasks>

<verification>
- Gateway unit tests pass including new CORS test suite
- Gateway builds cleanly (npm run build)
- curl with Origin: null returns CORS headers (not 403)
- curl with allowed origins (bibele, localhost) returns CORS headers
- curl with disallowed origin returns 403 CORS_REJECTED
- curl with no Origin header passes through
- OPTIONS preflight with null origin returns 204
- Gateway /readyz is accessible from Even App WebView context
</verification>

<success_criteria>
Voice gateway accepts Origin: null requests from Even WebView, all CORS security
guardrails maintained (disallowed origins still rejected), comprehensive test
coverage for CORS behavior, gateway health check accessible from app context.
</success_criteria>

<output>
After completion, create `.planning/quick/17-implement-robust-cors-support-for-even-w/17-SUMMARY.md`
</output>
