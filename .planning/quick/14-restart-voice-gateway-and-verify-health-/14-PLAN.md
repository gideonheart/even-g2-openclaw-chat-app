---
phase: quick-14
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-14]

must_haves:
  truths:
    - "Voice gateway process is restarted with CORS_ORIGINS from .env"
    - "GET /readyz returns 200 with status:ready"
    - "CORS headers present for app origin (https://bibele.kingdom.lv)"
    - "STT and OpenClaw checks show healthy in readyz response"
  artifacts: []
  key_links:
    - from: "gateway .env CORS_ORIGINS"
      to: "server.ts handleCors()"
      via: "config-loader.ts corsOrigins array"
      pattern: "CORS_ORIGINS.*bibele"
---

<objective>
Restart the voice gateway service so the .env CORS_ORIGINS takes effect, then verify
from the app side that Voice Gateway health is no longer Unreachable (readyz + STT checks green).

Purpose: The running voice gateway process (PID on port 4400) was started inline without
sourcing the .env file, so CORS_ORIGINS is empty (dev mode: allow-all). While this
happens to work, the task asks to restart with proper .env so CORS is strict, then verify
health endpoints respond correctly with CORS headers for the app origin.

Output: Concise verification results confirming gateway health is green.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/debug/resolved/health-readyz-unreachable.md

Gateway repo: /home/forge/openclaw-even-g2-voice-gateway
Gateway .env: /home/forge/openclaw-even-g2-voice-gateway/.env
  - CORS_ORIGINS=http://localhost:3001,https://bibele.kingdom.lv
  - PORT=4400
Gateway process: `node services/gateway-api/dist/index.js` (port 4400, PID 407264)
  - Currently running WITHOUT CORS_ORIGINS env var (empty = dev allow-all mode)
  - Started from a Claude Code bash session, not a systemd service

App default gateway URL: http://localhost:4400 (src/settings.ts DEFAULT_SETTINGS)
App health check: GET /readyz (src/api/gateway-client.ts checkHealth)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Restart voice gateway with .env sourced</name>
  <files></files>
  <action>
1. Kill the current voice gateway process on port 4400 (PID 407264, or whatever is
   currently listening on 4400).

2. Start a new voice gateway process from the gateway repo directory, sourcing the
   .env file so CORS_ORIGINS and all other config is loaded:

   ```bash
   cd /home/forge/openclaw-even-g2-voice-gateway
   # Export all vars from .env, then start the server in background
   set -a && source .env && set +a
   nohup node services/gateway-api/dist/index.js > /tmp/voice-gateway.log 2>&1 &
   ```

3. Wait 3-5 seconds for the server to be ready, then confirm port 4400 is listening:
   ```bash
   ss -tlnp | grep 4400
   ```

4. Verify the process has CORS_ORIGINS in its environment:
   ```bash
   cat /proc/$(lsof -ti:4400)/environ | tr '\0' '\n' | grep CORS_ORIGINS
   ```

IMPORTANT: Do NOT touch any files in the chat app repo. This is purely an operational
restart of the external gateway service.
  </action>
  <verify>
    <automated>curl -s -o /dev/null -w "%{http_code}" http://localhost:4400/readyz</automated>
    <manual>Port 4400 is listening with a fresh process that has CORS_ORIGINS set</manual>
  </verify>
  <done>Voice gateway is running on port 4400 with CORS_ORIGINS=http://localhost:3001,https://bibele.kingdom.lv loaded from .env</done>
</task>

<task type="auto">
  <name>Task 2: Verify health endpoints with CORS and readyz detail</name>
  <files></files>
  <action>
Run the following verification checks and collect results:

1. **Readyz basic check** -- confirm 200 and status:ready:
   ```bash
   curl -s http://localhost:4400/readyz | python3 -m json.tool
   ```
   Expected: `{"status": "ready", "checks": {"stt": {"healthy": true, ...}, "openclaw": {"healthy": true, ...}}}`

2. **CORS with app production origin** -- confirm Access-Control-Allow-Origin header:
   ```bash
   curl -s -D- -H "Origin: https://bibele.kingdom.lv" http://localhost:4400/readyz | head -12
   ```
   Expected: `Access-Control-Allow-Origin: https://bibele.kingdom.lv`

3. **CORS with localhost dev origin** -- confirm dev origin also allowed:
   ```bash
   curl -s -D- -H "Origin: http://localhost:3001" http://localhost:4400/readyz | head -12
   ```
   Expected: `Access-Control-Allow-Origin: http://localhost:3001`

4. **CORS with disallowed origin** -- confirm strict rejection:
   ```bash
   curl -s -D- -H "Origin: http://evil.example.com" http://localhost:4400/readyz | head -5
   ```
   Expected: 403 CORS_REJECTED (since corsOrigins is now non-empty and evil.example.com is not in the allowlist)

5. **Preflight OPTIONS** -- confirm preflight works for allowed origin:
   ```bash
   curl -s -D- -X OPTIONS -H "Origin: https://bibele.kingdom.lv" -H "Access-Control-Request-Method: GET" http://localhost:4400/readyz | head -10
   ```
   Expected: 204 with CORS headers

Collect all results into a concise verification summary.
  </action>
  <verify>
    <automated>curl -sf -H "Origin: https://bibele.kingdom.lv" http://localhost:4400/readyz | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ready' and d['checks']['stt']['healthy'] and d['checks']['openclaw']['healthy'], f'unhealthy: {d}'; print('ALL GREEN')"</automated>
    <manual>All 5 checks pass: readyz 200+ready, CORS allowed for bibele+localhost, CORS rejected for evil origin, preflight 204</manual>
  </verify>
  <done>Voice Gateway readyz returns 200/ready with STT+OpenClaw healthy, CORS strict mode active (bibele.kingdom.lv and localhost:3001 allowed, others rejected)</done>
</task>

</tasks>

<verification>
- Gateway process running on port 4400 with CORS_ORIGINS env var set
- GET /readyz returns HTTP 200 with {"status": "ready"}
- STT check healthy: true
- OpenClaw check healthy: true
- CORS headers present for https://bibele.kingdom.lv
- CORS headers present for http://localhost:3001
- Disallowed origins receive 403 CORS_REJECTED
</verification>

<success_criteria>
Voice gateway restarted with proper .env config. All readyz + CORS verification checks pass.
Health no longer shows Unreachable from the app's perspective.
</success_criteria>

<output>
After completion, create `.planning/quick/14-restart-voice-gateway-and-verify-health-/14-SUMMARY.md`
</output>
