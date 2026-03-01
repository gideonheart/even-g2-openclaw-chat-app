---
phase: quick-18
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - /etc/nginx/sites-available/bibele.kingdom.lv
  - src/settings.ts
autonomous: false
requirements: [QUICK-18]

must_haves:
  truths:
    - "https://bibele.kingdom.lv/gateway/readyz returns the gateway health JSON over HTTPS"
    - "App default gateway URL points to https://bibele.kingdom.lv/gateway so new installs work without manual URL entry"
    - "Health indicator in the hub UI shows Connected (not Unreachable) when gateway is healthy"
    - "Voice and text turn API calls route through /gateway/ proxy transparently"
  artifacts:
    - path: "/etc/nginx/sites-available/bibele.kingdom.lv"
      provides: "Reverse proxy location block for /gateway/"
      contains: "location /gateway/"
    - path: "src/settings.ts"
      provides: "Default gateway URL pointing to HTTPS proxy"
      contains: "https://bibele.kingdom.lv/gateway"
  key_links:
    - from: "nginx /gateway/ location"
      to: "http://127.0.0.1:4400/"
      via: "proxy_pass with trailing slash (strip prefix)"
      pattern: "proxy_pass http://127\\.0\\.0\\.1:4400/"
    - from: "src/settings.ts DEFAULT_SETTINGS.gatewayUrl"
      to: "nginx /gateway/"
      via: "HTTPS fetch from gateway-client.ts"
      pattern: "https://bibele\\.kingdom\\.lv/gateway"
---

<objective>
Configure nginx on bibele.kingdom.lv to reverse-proxy /gateway/ to the voice gateway running on http://127.0.0.1:4400/, then update the chat app's default gateway URL to use the HTTPS-proxied path. This eliminates mixed-content issues, removes the need for users to manually discover/enter the gateway URL, and makes the Even WebView CORS situation simpler (same-origin).

Purpose: The voice gateway currently listens on port 4400 (HTTP only). The chat app is served over HTTPS from bibele.kingdom.lv. Browsers (and especially the Even App WebView) block or warn on mixed HTTP/HTTPS content. Proxying through nginx gives the gateway a proper HTTPS endpoint on the same domain.

Output: Working HTTPS proxy at https://bibele.kingdom.lv/gateway/*, updated app default, verified health check.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/settings.ts
@src/api/gateway-client.ts
@/etc/nginx/sites-available/bibele.kingdom.lv
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update app default gateway URL and placeholder to HTTPS proxy path</name>
  <files>src/settings.ts</files>
  <action>
In src/settings.ts, update DEFAULT_SETTINGS.gatewayUrl from empty string '' to 'https://bibele.kingdom.lv/gateway'. This means new installs auto-connect without manual configuration.

Also update FIELD_CONFIG.gatewayUrl.placeholder from 'http://your-server:4400' to 'https://bibele.kingdom.lv/gateway' so the UI hint reflects the production URL.

Update FIELD_CONFIG.gatewayUrl.help to: 'OpenClaw voice gateway endpoint (production: https://bibele.kingdom.lv/gateway)'.

Do NOT change the validation regex -- it already accepts https:// URLs. Do NOT change the isLocalhostUrl function or LOOPBACK_RE.

Ensure existing tests still pass. Some tests create settings with explicit gatewayUrl values (those are fine), but tests that rely on DEFAULT_SETTINGS having gatewayUrl: '' may need updating. Run the full test suite and fix any failures caused by the non-empty default.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Check that src/settings.ts DEFAULT_SETTINGS.gatewayUrl equals 'https://bibele.kingdom.lv/gateway'</manual>
  </verify>
  <done>DEFAULT_SETTINGS.gatewayUrl is 'https://bibele.kingdom.lv/gateway', placeholder updated, all 579+ tests pass</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 2: Add nginx /gateway/ reverse proxy and reload</name>
  <files>/etc/nginx/sites-available/bibele.kingdom.lv</files>
  <action>
This task requires root/sudo access to modify the nginx config. The forge user has sudo group membership but sudo requires a password, so Claude cannot do this autonomously.

The user must add a location block to /etc/nginx/sites-available/bibele.kingdom.lv INSIDE the existing server { } block, BEFORE the existing location / { } block (nginx matches the most specific prefix first, so ordering technically does not matter for prefix matches, but placing it before / is clearest).

Add this block after the `include forge-conf/bibele.kingdom.lv/server/*;` line and before `location / {`:

```nginx
    # Voice gateway reverse proxy (quick-18)
    location /gateway/ {
        proxy_pass http://127.0.0.1:4400/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        client_max_body_size 10m;
    }
```

Key details:
- The trailing slash on both `/gateway/` and `proxy_pass http://127.0.0.1:4400/` is CRITICAL -- it strips the /gateway/ prefix when forwarding. So /gateway/readyz becomes /readyz on port 4400.
- client_max_body_size 10m allows voice audio uploads (WAV blobs can be several MB).
- No WebSocket upgrade headers needed -- the gateway uses HTTP POST, not WebSocket.
- No CORS headers in nginx -- the gateway handles its own CORS. With same-origin proxy, CORS headers are not needed at all.

ROLLBACK: If anything breaks, remove the `location /gateway/ { ... }` block and run `sudo systemctl reload nginx`. The app default gateway URL will just fail health checks until the proxy is restored -- no data loss, no crash.
  </action>
  <verify>
    <automated>curl -s -o /dev/null -w "%{http_code}" https://bibele.kingdom.lv/gateway/readyz</automated>
    <manual>Run: sudo /usr/sbin/nginx -t (should say "syntax is ok"), then sudo systemctl reload nginx, then curl -s https://bibele.kingdom.lv/gateway/readyz should return gateway JSON</manual>
  </verify>
  <done>curl https://bibele.kingdom.lv/gateway/readyz returns 200 with {"status":"ready",...} JSON body</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Verify end-to-end health and app connectivity</name>
  <files>n/a</files>
  <action>
Human verifies that the full stack (nginx proxy + app default URL + gateway) works end-to-end. No code changes needed -- this is a verification-only checkpoint.

If the app still shows "Unreachable" after the proxy is live:
- Clear localStorage (the old empty gatewayUrl may be cached in settings) -- go to Settings, clear the Gateway URL field and re-save, or clear site data entirely.
- Existing users with previously saved settings will keep their old gatewayUrl value. The new default only applies to fresh installs or cleared storage.
  </action>
  <verify>
    <automated>curl -s https://bibele.kingdom.lv/gateway/readyz | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ready', f'Not ready: {d}'; print('OK: gateway ready over HTTPS')"</automated>
    <manual>Open https://bibele.kingdom.lv, check Health section shows Connected (green dot), check Settings shows gateway URL, verify no mixed-content warnings in DevTools console</manual>
  </verify>
  <done>Hub UI health indicator shows Connected, gateway readyz returns ready over HTTPS, no mixed-content browser warnings</done>
</task>

</tasks>

<verification>
- `curl -s https://bibele.kingdom.lv/gateway/readyz` returns 200 with JSON `{"status":"ready",...}`
- `npx vitest run` passes all tests (no regressions from default URL change)
- Hub UI health indicator shows Connected when gateway is healthy
- No mixed-content warnings in browser console
</verification>

<success_criteria>
1. https://bibele.kingdom.lv/gateway/readyz returns gateway health JSON over HTTPS
2. App default gateway URL is https://bibele.kingdom.lv/gateway (new installs auto-connect)
3. All existing tests pass with the updated default
4. Hub health indicator shows Connected, not Unreachable
5. Rollback procedure documented (remove nginx location block + reload)
</success_criteria>

<output>
After completion, create `.planning/quick/18-configure-nginx-proxy-for-voice-gateway-/18-SUMMARY.md`
</output>
