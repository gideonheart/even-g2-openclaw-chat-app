---
phase: quick-19
plan: 01
subsystem: gestures, api
tags: [fsm, gesture-handler, gateway-client, voice-turn, transcript, response_end]

# Dependency graph
requires:
  - phase: 02-gesture-system
    provides: gesture FSM transition table and gesture-handler wiring
  - phase: 04-api-client
    provides: gateway-client with emitFromGatewayReply
provides:
  - FSM thinking+tap -> recording transition (interrupt-and-re-record)
  - response_end -> idle FSM reset via gesture-handler
  - transcript chunk emission from gateway reply before response_start
affects: [display-controller, voice-loop]

# Tech tracking
tech-stack:
  added: []
  patterns: [response_end as FSM reset trigger, transcript chunk before response_start]

key-files:
  modified:
    - src/gestures/gesture-fsm.ts
    - src/gestures/gesture-handler.ts
    - src/api/gateway-client.ts
    - src/__tests__/gesture-fsm.test.ts
    - src/__tests__/gesture-handler.test.ts
    - src/__tests__/gateway-client.test.ts

key-decisions:
  - "response_end resets FSM to idle via handleInput('reset') rather than a dedicated input, reusing existing reset path"
  - "transcript chunk emitted before response_start so display-controller renders user bubble before assistant streaming begins"

patterns-established:
  - "Gateway reply transcript field drives user chat bubble without display-controller changes"

requirements-completed: [FSM-RERECORD, TRANSCRIPT-EMIT]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Quick Task 19: FSM Re-record After Response End + Queue During Thinking Summary

**FSM thinking+tap transition for interrupt-and-re-record, response_end idle reset to eliminate 45s watchdog wait, and transcript chunk emission for user chat bubble display**

## Performance

- **Duration:** 3 min 34 sec
- **Started:** 2026-03-02T09:57:26Z
- **Completed:** 2026-03-02T10:01:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- FSM now allows tap during thinking state to immediately start a new recording (interrupt-and-re-record)
- response_end chunk resets FSM to idle, eliminating the 45-second watchdog timeout as the only way to re-record
- Gateway-client emits a transcript chunk (user's speech text) before response_start when the gateway reply includes a transcript field
- Existing display-controller already handles transcript chunks (renderer.addUserMessage) -- no display changes needed
- Backward compatibility preserved: replies without transcript field emit 3 chunks (no transcript chunk)
- 582 tests pass, TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add FSM thinking+tap transition and response_end reset in gesture-handler** - `ff7651b` (feat)
2. **Task 2: Emit transcript chunk from gateway reply before response_start** - `49bd755` (feat)
3. **Task 3: Run full test suite and validate end-to-end chunk flow** - verification only, no code changes

## Files Created/Modified
- `src/gestures/gesture-fsm.ts` - Added thinking + tap -> recording transition in TRANSITIONS table
- `src/gestures/gesture-handler.ts` - Added response_end case to gateway:chunk listener that resets FSM to idle
- `src/api/gateway-client.ts` - Added transcript field to GatewayReply, emit transcript chunk in emitFromGatewayReply
- `src/__tests__/gesture-fsm.test.ts` - Updated thinking+tap test from "ignored" to "recording with START_RECORDING"
- `src/__tests__/gesture-handler.test.ts` - Split non-error test into response_end reset test + response_start/delta no-reset test
- `src/__tests__/gateway-client.test.ts` - Updated voice/text turn tests for 4 chunks with transcript, added backward-compat tests

## Decisions Made
- response_end resets FSM via `handleInput('reset')` reusing the existing reset pathway, keeping the FSM transition table as the single source of truth for state changes
- transcript chunk is emitted before response_start so the user sees their own speech bubble before the assistant response begins streaming
- No display-controller changes needed since the transcript chunk handler was already wired at line 38-41

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Steps
- The gateway backend must include `transcript` in its JSON reply for user bubbles to appear
- The thinking state is set externally by the voice-loop-controller; verify on real hardware that tap during streaming works end-to-end

## Self-Check: PASSED

- All 6 modified files exist on disk
- Commit ff7651b found in git log
- Commit 49bd755 found in git log
- thinking state tap -> recording transition verified in gesture-fsm.ts (line 46)
- response_end handler verified in gesture-handler.ts
- transcript emission verified in gateway-client.ts
- 582 tests pass, TypeScript compiles cleanly

---
*Quick Task: 19-fsm-re-record-after-response-end-queue-d*
*Completed: 2026-03-02*
