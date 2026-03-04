# Analysis: Missing loading dots immediately after stop + race with overlapping turns

## User-observed symptoms
1. On tap-stop, status bar does not immediately show loading dots (`. .. ...`).
2. During overlapping turns (recording B while response A still in flight), incoming gateway events can mutate the status bar in confusing ways.

## Code-level findings
### 1) `audio:recording-stop` is emitted late in async chain
In `src/gestures/gesture-handler.ts` (STOP_RECORDING action), flow is:
- await `bridge.stopAudio()`
- then `audioCapture.stopRecording().then(...)`
- then emit `audio:recording-stop` with blob

In `src/display/display-controller.ts`, loading dots (`sent`) are triggered only on `audio:recording-stop`.

**Impact:** if stopAudio/stopRecording is delayed, the icon transition to `sent` is delayed too, so user sees stale/blank/overwritten state.

### 2) status icon has competing writers with no strict priority guard
`display-controller.ts` writes icon state from multiple event sources:
- `audio:recording-start` -> `recording`
- `audio:recording-stop` -> `sent`
- `gateway:chunk response_start` -> `thinking`
- `gateway:chunk response_end/error` -> delayed `idle` via settle timer
- `gateway:chunk transcript` -> `sent`

**Impact:** late gateway events from previous turn can overwrite current status, especially around rapid re-recording.

## Proposed fix strategy (SRP/DRY)
Introduce explicit **status-bar state ownership** in display-controller:
- `recordingActive: boolean`
- `processingCount: number` (pending turns not yet fully settled)

Rendering rule (single function, deterministic priority):
1. if `recordingActive` -> `recording` (blinking dot + timer)
2. else if `processingCount > 0` -> `sent` (loading dots)
3. else if assistant actively streaming current turn -> `thinking`
4. else `idle`

### Event handling adjustments
- Add immediate event on user stop tap (before async audio stop completes), e.g. `audio:recording-stop-requested`.
- Display-controller increments processing state on stop-requested immediately.
- Keep `audio:recording-stop` for blob payload pipeline only (no UI ownership).
- Prevent `response_end/error` idle settle from forcing idle while `recordingActive` or `processingCount > 0`.

### Overlapping-turn behavior (required)
- If user starts new recording while prior processing is pending:
  - status must show `recording` (timer visible)
  - pending processing remains tracked in background
- When recording stops again:
  - return to loading dots immediately

## Acceptance tests to add
1. stop tap -> immediate `sent` icon transition (no wait for async stopAudio/blob).
2. response_end from previous turn does not hide active `recording` icon.
3. overlapping turns maintain deterministic status priority.
4. after all pending processing clears and not recording -> idle.

## Notes
- Keep transcript-first message rendering unchanged.
- Remove dead paths that directly set icon state without priority function.
