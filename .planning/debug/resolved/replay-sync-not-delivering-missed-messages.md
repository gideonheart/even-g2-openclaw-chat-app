---
status: verified
trigger: "replay-sync-not-delivering-missed-messages"
created: 2026-03-12T00:00:00Z
updated: 2026-03-12T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED and FIXED
test: All 93 chat-app tests pass, all 28 gateway tests pass (6 new tests added)
expecting: N/A
next_action: Archive session

## Symptoms

expected: After closing and reopening the glasses app, the resume sync should call the gateway replay endpoint, fetch missed events, and display the response that OpenClaw generated while the app was closed.
actual: The response from OpenClaw is visible in the OpenClaw UI/logs but never appears in the chat-app or on the glasses after reopening.
errors: No error messages reported -- it silently fails to show the missed message.
reproduction: 1) Speak a message on G2 glasses, 2) Close/leave the app before response arrives, 3) Reopen the app -- response is missing.
timeline: This is the first test of the just-built resume sync feature (quick-50 chat-app + quick-26 gateway).

## Eliminated

(none -- first hypotheses were correct)

## Evidence

- timestamp: 2026-03-12T00:00:30Z
  checked: gateway-client.ts - handleServerSentEvent() and parseServerSentEventsFromResponse()
  found: SSE parsing never calls setLastSeq(). The comment at line 48-49 confirms "Only updated via setLastSeq() after processing replay events. Normal SSE streams do not carry seq numbers."
  implication: lastEventSeq stays null forever until a successful replay -- but replay requires lastSeq != null. Chicken-and-egg deadlock.

- timestamp: 2026-03-12T00:00:40Z
  checked: glasses-main.ts lines 545-567 (resume sync block)
  found: Guard `if (lastSeq != null)` at line 547 skips replay entirely when getLastSeq() returns null. Since setLastSeq() is only called AFTER a successful replay (line 555), and replay is only attempted when lastSeq is not null, the first replay can NEVER trigger. Boot-strap deadlock.
  implication: ROOT CAUSE 1 -- Resume sync is dead on arrival. It can never execute on first reconnect.

- timestamp: 2026-03-12T00:00:50Z
  checked: server.ts line 452-454 (handleSessionEventsReplay) vs replay-client.ts line 24
  found: Gateway returns `{ sessionKey, events }` (object with events array inside). But fetchSessionReplay casts the response directly as `ReplayEvent[]` -- it does NOT unwrap `.events`. The result is an object, not an array, so `.length` is undefined and iteration fails silently.
  implication: ROOT CAUSE 2 -- Even if lastSeq were seeded, the replay response would never be parsed correctly.

- timestamp: 2026-03-12T00:00:55Z
  checked: server.ts line 433-435 (handleTurnEventsReplay)
  found: Turn replay also returns `{ turnId, events, turn }` -- same wrapping pattern. fetchTurnReplay also does direct cast.
  implication: ROOT CAUSE 2 affects both turn and session replay endpoints.

## Resolution

root_cause: |
  Two independent bugs prevent resume sync from ever working:

  BUG 1 (Bootstrap deadlock): lastEventSeq is never seeded during normal SSE streaming.
  setLastSeq() is only called after a successful replay, but replay is guarded by
  `if (lastSeq != null)` which is always false on first boot. The gateway SSE events
  didn't include seq numbers, and no code path seeds the initial value. Result: replay
  is never attempted.

  BUG 2 (Response shape mismatch): The gateway session replay endpoint returns
  `{ sessionKey, events: [...] }` but fetchSessionReplay() casts the entire response
  as `ReplayEvent[]` instead of unwrapping `.events`. Same issue for turn replay.
  Result: even if replay were attempted, the events array would never be extracted.

fix: |
  FIX 1 (gateway + chat-app): Gateway now includes `seq` watermark in the `done` SSE event.
  The gateway's onComplete callback stores the done event first to get the seq from TurnStore,
  then includes it in the SSE payload `{ turnId, timing, seq }`. On the client side,
  handleServerSentEvent passes seq through on response_end chunks. glasses-main adds a
  gateway:chunk listener that calls setLastSeq(seq) whenever a response_end with seq arrives.
  This seeds the cursor during normal voice turns, breaking the bootstrap deadlock.

  FIX 2 (chat-app): fetchSessionReplay and fetchTurnReplay now unwrap the gateway envelope.
  They check if the response body is a raw array (backward-compatible) or an object with
  an `.events` property, and extract accordingly. Defensive: returns [] if neither shape matches.

verification: |
  - 93/93 chat-app tests pass (replay-client, gateway-client, glasses-main)
  - 28/28 gateway server tests pass
  - 19/19 voice-loop-controller tests pass
  - 6 new tests added covering: envelope unwrapping (session + turn), seq pass-through (present + absent)

files_changed:
  - src/types.ts (chat-app): Added optional `seq` field to VoiceTurnChunk
  - src/api/gateway-client.ts (chat-app): Pass seq from done SSE event to response_end chunk
  - src/api/replay-client.ts (chat-app): Unwrap gateway envelope in fetchSessionReplay/fetchTurnReplay
  - src/glasses-main.ts (chat-app): Add seq watermark tracking listener on gateway:chunk
  - src/__tests__/replay-client.test.ts: 4 new tests for envelope unwrapping
  - src/__tests__/gateway-client.test.ts: 2 new tests for seq pass-through
  - services/gateway-api/src/server.ts (gateway): Include seq in done SSE event, reorder write-through
