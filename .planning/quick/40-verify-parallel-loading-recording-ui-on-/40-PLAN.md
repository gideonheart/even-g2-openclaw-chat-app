# Quick Task 40: Verify parallel loading+recording UI on G2 glasses device

## Objective
Manual device verification that the composite status renderer (quick-38) works correctly on Even G2 hardware.

## Prerequisites
- [x] Clean production build (`npm run build` passes)
- [ ] G2 glasses connected and Even App running
- [ ] Gateway server running (`/readyz` healthy)

## Test Scenarios

### Scenario 1: Basic loading dots after stop
1. Tap to record → speak → tap to stop
2. **Verify:** `STATUS_CONTAINER` shows loading dots (`. → .. → ...` cycling)
3. **Verify:** Dots clear when transcript + response arrive

### Scenario 2: Parallel recording + loading (KEY TEST)
1. Tap to record A → speak → tap to stop A
2. **Immediately** tap to start recording B (while A is still pending)
3. **Verify:** `STATUS_CONTAINER` shows BOTH:
   - Left: blinking record dot (● / ○) + live timer (`0:00`, `0:01`, ...)
   - Right: loading dots (`. → .. → ...`) for pending turn A
   - Format: `● 0:03  ...` (two-space separator)
4. **Verify:** When A's response arrives, loading dots clear but recording B continues
5. Tap to stop B → verify loading dots appear for B

### Scenario 3: Multiple pending turns
1. Tap record A → stop → tap record B → stop (both quick, before A responds)
2. **Verify:** Loading dots show (pendingTurns=2)
3. **Verify:** When A response arrives, dots still show (pendingTurns=1)
4. **Verify:** When B response arrives, dots clear (pendingTurns=0)

### Scenario 4: Thinking spinner (streaming)
1. Record → stop → wait for loading to clear
2. **Verify:** Braille thinking spinner (⠋⠙⠹...) appears during streaming response
3. **Verify:** Spinner clears when response_end arrives

### Scenario 5: Idle state
1. After all responses complete, no active recording
2. **Verify:** `STATUS_CONTAINER` shows idle icon (◌)

## Code-to-Display Mapping

| StatusConditions state | Expected STATUS_CONTAINER display |
|------------------------|-----------------------------------|
| `{recording:true, pendingTurns:0, streaming:false}` | `● 0:05` (dot blinks, timer counts) |
| `{recording:false, pendingTurns:1, streaming:false}` | `...` (dots cycle) |
| `{recording:true, pendingTurns:1, streaming:false}` | `● 0:03  ...` (both visible) |
| `{recording:false, pendingTurns:0, streaming:true}` | `⠋` (Braille spinner) |
| `{recording:false, pendingTurns:0, streaming:false}` | `◌` (idle) |

## Results

| Scenario | Pass/Fail | Notes |
|----------|-----------|-------|
| 1. Basic loading dots | | |
| 2. Parallel recording + loading | | |
| 3. Multiple pending turns | | |
| 4. Thinking spinner | | |
| 5. Idle state | | |

**Tested by:** ___
**Date:** ___
**Device:** Even G2 glasses
**Gateway:** ___
