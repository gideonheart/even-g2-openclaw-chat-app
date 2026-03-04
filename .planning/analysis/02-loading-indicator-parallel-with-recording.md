# Decouple loading indicator from recording indicator/timer (parallel UI)

**Status: DONE** (quick-38, commits ec0823a + 53d98fd)

## Code terminology

| Concept | Code name | Location |
|---------|-----------|----------|
| Top bar on glasses (576x30px) | `STATUS_CONTAINER` (containerID: 1, containerName: `'status'`) | `glasses-renderer.ts:21` |
| Chat area below (576x256px) | `CHAT_CONTAINER` (containerID: 2, containerName: `'chat'`) | `glasses-renderer.ts:28` |
| Composite state interface | `StatusConditions { recording, pendingTurns, streaming }` | `icon-animator.ts:13-17` |
| Primary icon API | `IconAnimator.setConditions(conditions)` | `icon-animator.ts:147` |
| Recording flag setter | `GlassesRenderer.setRecordingActive(active)` | `glasses-renderer.ts:213` |
| Pending turns setter | `GlassesRenderer.setPendingTurns(count)` | `glasses-renderer.ts:218` |
| Streaming flag setter | `GlassesRenderer.setStreamingActive(active)` | `glasses-renderer.ts:223` |
| Deprecated single-enum API | `IconAnimator.setState(state)` / `GlassesRenderer.setIconState(state)` | backward-compat only |
| Recording dot frames | `ICON_FRAMES.recording` (● / ○ blink) | `icon-bitmaps.ts` |
| Loading dot frames | `ICON_FRAMES.sent` (`.` / `..` / `...`) | `icon-bitmaps.ts` |
| Thinking spinner frames | `ICON_FRAMES.thinking` (10-frame Braille) | `icon-bitmaps.ts` |
| Pending turn counter | `pendingTurns` (global count, not per-turnId) | `display-controller.ts:40` |
| Settle delay (500ms) | `settleTimer` — delays pendingTurns decrement after response_end | `display-controller.ts:42` |

## User requirement

Current (before quick-38):
- After stop, loading dots show (good)
- But recording circle disappears and loading seems mutually exclusive with recording state

Desired:
- Loading dots are a **separate entity** from recording button/timer state
- While loading dots are visible (pending prior turn), user can tap again and start new recording
- New recording must show blinking record circle + live timer
- Loading dots should continue independently for pending prior turn(s)
- When prior turn transcript arrives (WhisperX done), its loading indicator clears
- Transcript appears in UI immediately

## Core problem (was)

The `STATUS_CONTAINER` used a single `IconState` enum (`idle | recording | sent | thinking`) with a priority resolver (`resolveIcon()`) that picked ONE winner. Recording always won, hiding loading dots for pending turns.

## Solution implemented

1. **Split status model into independent concerns** — `StatusConditions` interface:
   - `recording: boolean` + `recordingStartedAt` timestamp in IconAnimator
   - `pendingTurns: number` (global count, incremented on `audio:stop-requested`, decremented 500ms after `response_end`/`error`)
   - `streaming: boolean` for thinking spinner

2. **Composite rendering in `IconAnimator.tick()`** — not single enum:
   - Left segment: recording dot + timer (`● 0:05`) when `recording=true`
   - Right segment: loading dots (`...`) when `pendingTurns > 0`
   - Both shown simultaneously: `"● 0:05  ..."` (two-space separator)
   - Thinking spinner only when no recording AND no pending
   - Independent frame counters with edge-triggered resets

3. **Event wiring in `DisplayController`** — direct condition methods:
   - `audio:recording-start` → `setRecordingActive(true)`
   - `audio:stop-requested` → `setRecordingActive(false)` + `setPendingTurns(++count)`
   - `response_end`/`error` → `setStreamingActive(false)` + 500ms settle → `setPendingTurns(--count)`

4. **Transcript-first behavior preserved** — async microtask yield in `emitFromGatewayReply` (quick-35)

5. **Race/overlap tests added** (11 scenarios in display-controller.test.ts):
   - stop A → loading shown
   - start B while A pending → `recording(B)` + `loading(A)` both visible
   - response_end A during B recording → loading(A) clears, recording(B) remains
   - Multiple pending turns decrement independently

## Acceptance criteria

- [x] User can see recording timer and loading dots at the same time
- [x] Loading dots do not suppress recording indicator
- [x] Loading clears per completed turn, not globally (count-based decrement)
- [x] Transcript appears when ready and loading for that turn disappears (500ms settle)
- [x] No dead/duplicated state logic (`resolveIcon()` + `ICON_PRIORITY` removed)

## Design note: count vs per-turnId

The analysis suggested "count or map by turnId". Implementation chose **global count** — simpler, works correctly because gateway responses arrive in FIFO order. If out-of-order responses become possible, upgrade to a `Map<turnId, boolean>` would be needed.

## Changed files

| File | Change |
|------|--------|
| `src/display/icon-animator.ts` | `setConditions(StatusConditions)`, composite `tick()`, independent frame counters |
| `src/display/glasses-renderer.ts` | Three condition setters + `localConditions` mirror |
| `src/display/display-controller.ts` | Removed `resolveIcon()`/`ICON_PRIORITY`, direct condition wiring |
| `src/display/icon-bitmaps.ts` | No change (frames already existed) |
| `src/types.ts` | `StatusConditions` export |
| `tests/display/icon-animator.test.ts` | 16 new tests (composite rendering, edge resets, getState derivation) |
| `tests/display/display-controller.test.ts` | 8 new overlap scenario tests |
