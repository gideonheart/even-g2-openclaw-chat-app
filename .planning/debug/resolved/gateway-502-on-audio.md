---
status: resolved
trigger: "User gets 'Glasses Gateway error: Gateway returned 502' when sending audio messages"
created: 2026-03-04T00:00:00Z
updated: 2026-03-04T10:21:00Z
---

## Current Focus

hypothesis: CONFIRMED - Voice gateway service not running on port 4400
test: curl readyz endpoint, ss port check
expecting: Gateway responds with ready status
next_action: Service restarted, creating supervisor config for persistence

## Symptoms

expected: Audio messages should be sent to the voice gateway and get a streamed response back
actual: Getting "Glasses Gateway error: Gateway returned 502" shown on glasses display
errors: "Gateway returned 502" - HTTP 502 Bad Gateway from the voice gateway
reproduction: Send an audio message through the glasses
started: Just started happening, was working before

## Eliminated

- hypothesis: Client-side code bug (wrong URL, encoding, etc.)
  evidence: Default gatewayUrl is correct (https://bibele.kingdom.lv/gateway), nginx proxies /gateway/ to 127.0.0.1:4400, and the 502 is from nginx HTML (not from gateway-api JSON error handler)
  timestamp: 2026-03-04T10:18:00Z

- hypothesis: Recent code changes broke error handling
  evidence: Reviewed commit b2eae13 (timeout removal) and subsequent commits -- error handling path is correct, GatewayAppError classification is working as designed. The 502 HTML response falls through to the status-based message in readGatewayError() which is correct behavior.
  timestamp: 2026-03-04T10:19:00Z

- hypothesis: openclaw-gateway binary (pid 325469) IS the voice gateway
  evidence: openclaw-gateway listens on ports 3434/3436/3437, NOT 4400. It is the upstream OpenClaw agent server, not the voice gateway API. The voice gateway is a separate Node.js service at /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api/
  timestamp: 2026-03-04T10:20:00Z

## Evidence

- timestamp: 2026-03-04T10:18:00Z
  checked: curl https://bibele.kingdom.lv/gateway/readyz
  found: Returns 502 with nginx HTML body (not JSON from gateway-api)
  implication: nginx cannot reach upstream service -- upstream is down

- timestamp: 2026-03-04T10:18:00Z
  checked: curl https://bibele.kingdom.lv/ (main domain)
  found: Returns 200 OK
  implication: Server and nginx are fine, only /gateway/ upstream is down

- timestamp: 2026-03-04T10:18:00Z
  checked: nginx config at /etc/nginx/sites-enabled/bibele.kingdom.lv
  found: location /gateway/ proxies to http://127.0.0.1:4400/
  implication: Voice gateway must listen on port 4400

- timestamp: 2026-03-04T10:18:30Z
  checked: ss -tlnp | grep 4400
  found: Nothing listening on port 4400
  implication: Voice gateway process is not running

- timestamp: 2026-03-04T10:19:00Z
  checked: ps aux for gateway processes
  found: openclaw-gateway (pid 325469) runs on ports 3434/3436/3437. No gateway-api process. The tmux session (agent_g2-gateway_session_name) is occupied by a Claude Code agent doing docs work, not running the gateway.
  implication: Voice gateway was never started (or crashed and was not restarted)

- timestamp: 2026-03-04T10:19:30Z
  checked: supervisor status
  found: No supervisor config for the voice gateway. Only daemon-678402 (warden, FATAL), daemon-681831 (getcpsr, RUNNING), daemon-689053 (bibele main, RUNNING on port 3000)
  implication: Voice gateway has no process management -- must be manually started

- timestamp: 2026-03-04T10:20:00Z
  checked: .env at /home/forge/openclaw-even-g2-voice-gateway/.env
  found: PORT=4400, HOST=0.0.0.0, connects to OpenClaw at ws://127.0.0.1:3434
  implication: Config is correct, just needs to be started

- timestamp: 2026-03-04T10:21:00Z
  checked: Started gateway manually: env $(cat .env | xargs) node services/gateway-api/dist/index.js
  found: Gateway started successfully, listening on port 4400, STT healthy, OpenClaw connected
  implication: Service is functional, just wasn't running

- timestamp: 2026-03-04T10:21:20Z
  checked: curl https://bibele.kingdom.lv/gateway/readyz (post-restart)
  found: {"status":"ready","checks":{"stt":{"healthy":true},"openclaw":{"healthy":true}}}
  implication: Gateway fully operational, 502 resolved

## Resolution

root_cause: The voice gateway service (gateway-api) was not running on port 4400. Nginx at bibele.kingdom.lv proxies /gateway/ to 127.0.0.1:4400, but no process was listening there. The gateway has no supervisor/systemd config for automatic restarts -- it was presumably started manually in a tmux session that later got repurposed by a Claude Code agent. When the process stopped (reason unknown), nothing restarted it.

fix: |
  1. Started the gateway manually to immediately resolve the 502.
  2. Created a systemd user service at /home/forge/.config/systemd/user/voice-gateway.service
     with Restart=always so the gateway auto-restarts on crash or reboot.
  3. Enabled and started the service: systemctl --user enable --now voice-gateway.service
  4. Confirmed lingering is enabled (Linger=yes) so the service persists after logout.

verification: |
  - curl https://bibele.kingdom.lv/gateway/healthz -> {"status":"ok"}
  - curl https://bibele.kingdom.lv/gateway/readyz -> {"status":"ready","checks":{"stt":{"healthy":true},"openclaw":{"healthy":true}}}
  - systemctl --user status voice-gateway -> active (running)
  - ss -tlnp | grep 4400 -> node listening on 0.0.0.0:4400

files_changed:
  - /home/forge/.config/systemd/user/voice-gateway.service (new - systemd user service for auto-restart)
