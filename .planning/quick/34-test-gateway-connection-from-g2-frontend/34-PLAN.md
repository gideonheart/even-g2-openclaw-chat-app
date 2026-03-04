---
phase: quick-34
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-34]
must_haves:
  truths:
    - "Gateway /readyz endpoint responds with 200 and JSON body from the production URL"
    - "STT and OpenClaw subsystems report healthy in readyz response"
    - "Voice turn endpoint /api/voice/turn is reachable (accepts POST)"
    - "Text turn endpoint /api/text/turn is reachable (accepts POST)"
    - "CORS headers allow requests from the G2 frontend origin"
  artifacts: []
  key_links:
    - from: "G2 frontend (src/settings.ts)"
      to: "https://bibele.kingdom.lv/gateway"
      via: "DEFAULT_SETTINGS.gatewayUrl"
      pattern: "bibele\\.kingdom\\.lv/gateway"
---

<objective>
Test gateway connection from the G2 frontend app. Verify the production gateway at https://bibele.kingdom.lv/gateway is reachable, healthy, and responding correctly on all endpoints the frontend uses.

Purpose: After the gateway-502 incident (quick debug task) and systemd service setup, confirm the gateway is fully operational from the frontend's perspective -- readyz, voice turn, and text turn endpoints.

Output: Pass/fail connectivity report with exact errors if failing. No files modified.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/api/gateway-client.ts
@src/settings.ts
@.planning/debug/resolved/gateway-502-on-audio.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Test gateway readyz health endpoint</name>
  <files></files>
  <action>
Run connectivity checks against the production gateway at https://bibele.kingdom.lv/gateway. This is the default gatewayUrl from src/settings.ts.

Step 1 -- /readyz health check (the endpoint the frontend's checkHealth() calls):
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\nTIME_MS:%{time_total}\n" https://bibele.kingdom.lv/gateway/readyz
```

Expected: HTTP 200 with JSON body `{"status":"ready","checks":{"stt":{"healthy":true},"openclaw":{"healthy":true}}}`.

If failing: Record the exact HTTP status, response body, and curl error. Check if the systemd service is running:
```bash
systemctl --user status voice-gateway 2>&1 | head -15
ss -tlnp | grep 4400
```

Step 2 -- CORS preflight check (the G2 frontend runs in a WebView with Origin: null):
```bash
curl -s -D - -o /dev/null -X OPTIONS \
  -H "Origin: null" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,X-Session-Key" \
  https://bibele.kingdom.lv/gateway/readyz
```

Expected: Response includes `Access-Control-Allow-Origin` header (either `*` or `null`).

Step 3 -- /api/voice/turn endpoint reachability (POST without audio body -- expect a 400-level error, NOT a 502/network error):
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST \
  -H "Content-Type: audio/wav" \
  https://bibele.kingdom.lv/gateway/api/voice/turn
```

Expected: HTTP 400 (bad request due to empty body) with a JSON error from the gateway. A 400/422 means the endpoint IS reachable and the gateway is processing the request. A 502/503/timeout means the gateway is down.

Step 4 -- /api/text/turn endpoint reachability (POST with minimal JSON body):
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"text":"ping"}' \
  https://bibele.kingdom.lv/gateway/api/text/turn
```

Expected: HTTP 200 with a JSON gateway reply containing turnId and assistant response. If no session key, may get 400/401 -- either way, a non-502 response means the endpoint is reachable.

Compile all results into a clear pass/fail report:
- PASS criteria: /readyz returns ready, both subsystems healthy, all endpoints return non-502 responses, CORS allows null origin
- FAIL criteria: Any endpoint returns 502, network error, or timeout

Print the report to stdout. Do NOT modify any source files.
  </action>
  <verify>
    <automated>curl -sf https://bibele.kingdom.lv/gateway/readyz | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ready', f'Not ready: {d}'; assert d['checks']['stt']['healthy'], 'STT unhealthy'; assert d['checks']['openclaw']['healthy'], 'OpenClaw unhealthy'; print('PASS: gateway readyz healthy')"</automated>
    <manual>Review the full connectivity report printed to stdout</manual>
  </verify>
  <done>All 4 connectivity checks completed with pass/fail status. /readyz returns ready with both subsystems healthy. Voice and text turn endpoints are reachable (non-502 responses). CORS headers present for null origin.</done>
</task>

</tasks>

<verification>
- `curl -sf https://bibele.kingdom.lv/gateway/readyz` returns 200 with status: ready
- All endpoints respond (no 502, no network timeout)
- CORS preflight succeeds for Origin: null
</verification>

<success_criteria>
- Gateway readyz confirms status=ready, stt.healthy=true, openclaw.healthy=true
- /api/voice/turn responds with a gateway error (400-level), not a proxy error (502)
- /api/text/turn responds with a gateway reply or meaningful error, not a proxy error
- CORS headers allow the G2 WebView origin (null)
- Clear pass/fail report with latency and exact error details if any check fails
</success_criteria>

<output>
After completion, create `.planning/quick/34-test-gateway-connection-from-g2-frontend/34-SUMMARY.md`
</output>
