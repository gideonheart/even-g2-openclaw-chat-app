# Phase 3: Glasses Display & Streaming - Research

**Researched:** 2026-02-28
**Domain:** Even G2 glasses display rendering, text container management, icon animation, streaming chat UX on a 576x288 monochrome canvas
**Confidence:** HIGH -- SDK display API verified from official `@evenrealities/even_hub_sdk@0.0.7` types, community reverse-engineering notes (G2.md), and working reference app (pong-even-g2). Key constraints confirmed from multiple independent sources.

---

## Summary

Phase 3 builds the glasses-side visual layer: a state icon HUD, a streaming bubble chat renderer, and the hide/wake UI mode toggle. The central challenge is that the Even G2 SDK's display model is a **rigid container-based system** (max 4 containers per page, text left-aligned only, no scroll position API) -- not a DOM/canvas you can freely paint on. The display is 576x288 pixels, 4-bit greyscale (16 shades of green), with a single fixed-width-ish font and no styling options (no bold, no font sizes, no right-alignment).

The critical architectural insight is that **there is no programmatic scroll position control**. The firmware handles internal text scrolling when `isEventCapture: 1` is set, and `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` are boundary signals, not continuous gesture events. This means "virtualized viewport with gesture-controlled scrolling" (CHAT-04/05/06) CANNOT be implemented via firmware scrolling -- instead, the app must manage its own viewport window into conversation history and use `textContainerUpgrade` to replace the visible text content when the user scrolls, bypassing firmware scrolling entirely.

For icons, `updateImageRawData` supports image containers (20-200px wide, 20-100px tall) with 4-bit greyscale raw data. Animation at 3-6 fps is achievable using a `setInterval` loop that queues image updates (confirmed by the Pong reference app which achieves ~12fps using similar techniques). For streaming text, `textContainerUpgrade` supports up to 2000 characters and operates in-place without page rebuilds -- this is the mechanism for incremental chat updates. The Pong app confirms the pattern: use `textContainerUpgrade` for frame-by-frame updates, `rebuildPageContainer` only for major layout changes.

**Primary recommendation:** Use a 3-container page layout (icon image container + chat text container + hint text container), manage chat viewport state in JavaScript, render the visible window via `textContainerUpgrade` at 150-300ms cadence, animate icons via `updateImageRawData` at 3-6fps, and implement hide/wake by toggling between the chat layout and a blank `rebuildPageContainer` call.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ICONS-01 | Glasses display shows idle icon when no conversation is active | Image container (containerID=1) with pre-rendered 4-bit greyscale idle icon bitmap. `updateImageRawData` sets initial icon on page create. |
| ICONS-02 | Glasses display shows blinking recording icon during voice capture | `setInterval` at 166-333ms (3-6fps) alternates recording icon bitmap with blank/dim variant via `updateImageRawData`. |
| ICONS-03 | Glasses display shows sent icon after recording stops | Single `updateImageRawData` call with "sent" icon bitmap when FSM enters `sent` state. |
| ICONS-04 | Glasses display shows thinking throbber while awaiting OpenClaw response | `setInterval` at 166-333ms cycles through 2-4 throbber frame bitmaps via `updateImageRawData`. Pong app confirms ~80ms/frame is achievable, so 166ms (6fps) is comfortable. |
| ICONS-05 | Icon animations render at 3-6 fps on the glasses display | Image update loop uses `setInterval(166)` for 6fps or `setInterval(333)` for 3fps. Must await each `updateImageRawData` before queuing next (drop frame if still in-flight, per Pong pattern). |
| CHAT-01 | User transcript appears as right-aligned bubble on glasses display | SDK text is left-aligned only. Simulate right-alignment by padding user messages with leading spaces. Use a marker prefix (e.g., `> `) to visually distinguish user vs. assistant text. |
| CHAT-02 | Assistant response appears as left-aligned bubble on glasses display | Natural left-alignment from SDK. Use a different prefix marker (e.g., no prefix or `< `) for visual distinction from user text. |
| CHAT-03 | Assistant response streams incrementally with 150-300ms update cadence | Accumulate SSE `response_delta` chunks from `gateway:chunk` bus events in a buffer. A `setInterval(200)` flush loop calls `textContainerUpgrade` with the current viewport text including the latest buffered content. |
| CHAT-04 | Chat viewport is virtualized: full history in memory, only visible window rendered | Maintain full `ChatMessage[]` array in memory. Compute a "viewport window" (e.g., last N lines that fit ~400 characters). Only the viewport window text is sent to `textContainerUpgrade`. |
| CHAT-05 | User can scroll up through conversation history via scroll-up gesture | On `gesture:scroll-up` bus event, decrement viewport offset (move window earlier in history). Re-render viewport via `textContainerUpgrade`. This is APP-MANAGED scrolling, NOT firmware scrolling. |
| CHAT-06 | User can scroll down / jump to latest via scroll-down gesture | On `gesture:scroll-down` bus event, increment viewport offset or snap to latest. Re-render viewport. When at bottom, new messages auto-scroll. |
| CHAT-07 | Text upgrades do not exceed 2000 characters per SDK call | Viewport renderer enforces a hard cap: truncate rendered text to 2000 chars before calling `textContainerUpgrade`. With ~400-500 chars filling the screen, this provides 4x headroom. |
| UIMD-01 | Glasses display supports hide mode (blank canvas when not actively conversing) | Call `rebuildPageContainer` with a single empty text container (content: '') to blank the display. Track `hidden: boolean` state. |
| UIMD-02 | Double-tap wakes glasses display from hidden mode | Gesture handler checks `hidden` flag before normal FSM processing. If hidden, double-tap calls `rebuildPageContainer` to restore the 3-container chat layout and sets `hidden = false`. |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@evenrealities/even_hub_sdk` | `^0.0.7` (already installed) | `textContainerUpgrade`, `rebuildPageContainer`, `updateImageRawData` -- all display rendering goes through the SDK | Only official SDK for G2 glasses display. |
| Vitest | `^3.0.0` (already installed) | Unit testing display renderer, viewport logic, icon state machine | Already in project with 172 passing tests. |
| TypeScript | `^5.7.0` (already installed) | Strict-mode typed display state and rendering | Already in project. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| No new libraries needed | -- | All display rendering uses existing SDK methods | -- |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Text-based bubble simulation (space-padding) | Image containers for bubble rendering | Image containers are limited to 20-200px wide, 20-100px tall. Would need custom bitmap generation and would consume 2-3 of the 4 container slots. Text containers with prefix markers are simpler and proven. |
| App-managed viewport scrolling | Firmware internal scrolling (`isEventCapture: 1` overflow) | No scroll position API exists. Cannot detect current scroll position, cannot set it programmatically, cannot render partial updates at a specific offset. App-managed is the only viable approach. |
| `textContainerUpgrade` for incremental streaming | `rebuildPageContainer` for each update | `textContainerUpgrade` is faster (no page rebuild), supports 2000 chars (vs 1000), and is confirmed smoother on real hardware. Use `rebuildPageContainer` only for layout changes (hide/wake, initial setup). |
| Unicode art icons in text | Image container with 4-bit greyscale bitmaps | Image containers provide real graphical icons; Unicode art is limited by the fixed font and supported character set. Image containers are small enough (e.g., 48x48) and fit within the 4-container budget. |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── display/
│   ├── glasses-renderer.ts     # GlassesRenderer service: owns SDK display calls
│   ├── viewport.ts             # Viewport state: message history, scroll offset, text serialization
│   ├── icon-animator.ts        # Icon animation loop: state → bitmap → updateImageRawData
│   └── icon-bitmaps.ts         # Pre-computed 4-bit greyscale icon bitmap data
├── bridge/
│   ├── even-bridge.ts          # (existing) Now also exposes textContainerUpgrade + rebuildPageContainer + updateImageRawData
│   ├── bridge-mock.ts          # (existing) Extend with display mock methods
│   └── bridge-types.ts         # (existing) Extend BridgeService interface with display methods
├── gestures/
│   ├── gesture-fsm.ts          # (existing, unchanged)
│   └── gesture-handler.ts      # (existing) Phase 3 adds scroll viewport integration
├── events.ts                   # (existing) Add display-related events to AppEventMap
└── types.ts                    # (existing) Add ChatMessage, ViewportState, DisplayMode types
```

### Pattern 1: Three-Container Page Layout

**What:** A page layout with 3 containers: (1) image container for state icon, (2) text container for chat viewport, (3) text container for hint bar. One container has `isEventCapture: 1` -- but since we manage scrolling ourselves, we can put it on the chat container without relying on firmware scrolling.

**When to use:** The standard operating layout for the glasses display. Created via `createStartUpPageContainer` on init (already called in Phase 2 with a single container), then rebuilt via `rebuildPageContainer` to the 3-container layout when Phase 3 display activates.

**Critical constraint:** Max 4 containers per page. We use 3, leaving 1 slot as headroom.

**Example:**
```typescript
// src/display/glasses-renderer.ts
import {
  RebuildPageContainer,
  TextContainerProperty,
  ImageContainerProperty,
  TextContainerUpgrade,
  ImageRawDataUpdate,
} from '@evenrealities/even_hub_sdk';

// Layout constants for 576x288 canvas
const ICON_X = 0;
const ICON_Y = 0;
const ICON_W = 48;
const ICON_H = 48;

const CHAT_X = 52;
const CHAT_Y = 0;
const CHAT_W = 524;     // 576 - 52 = remaining width
const CHAT_H = 256;     // Leave room for hint bar

const HINT_X = 0;
const HINT_Y = 258;
const HINT_W = 576;
const HINT_H = 30;

const CHAT_LAYOUT: RebuildPageContainer = {
  containerTotalNum: 3,
  imageObject: [{
    xPosition: ICON_X, yPosition: ICON_Y,
    width: ICON_W, height: ICON_H,
    containerID: 1, containerName: 'icon',
  }],
  textObject: [
    {
      xPosition: CHAT_X, yPosition: CHAT_Y,
      width: CHAT_W, height: CHAT_H,
      containerID: 2, containerName: 'chat',
      isEventCapture: 1,
      content: '',
    },
    {
      xPosition: HINT_X, yPosition: HINT_Y,
      width: HINT_W, height: HINT_H,
      containerID: 3, containerName: 'hint',
      isEventCapture: 0,
      content: '',
    },
  ],
};
```

### Pattern 2: App-Managed Viewport Scrolling

**What:** Instead of relying on firmware scrolling (which has no programmatic API), maintain a `scrollOffset` in JavaScript. The viewport renders only the messages visible at the current offset. Scroll gestures adjust the offset and trigger a re-render via `textContainerUpgrade`.

**When to use:** Always. This is the only viable approach since the SDK provides no scroll position read/write API.

**Key insight:** With ~400-500 characters filling a full-screen text container and a 2000-char `textContainerUpgrade` limit, the viewport can show approximately 1 screenful of text. Keep the full `ChatMessage[]` in memory, compute the visible window, serialize to text, and push to the container.

**Example:**
```typescript
// src/display/viewport.ts

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  complete: boolean;
}

export interface ViewportState {
  messages: ChatMessage[];
  scrollOffset: number;  // 0 = latest (bottom), positive = scrolled up
  autoScroll: boolean;   // true when at bottom, new messages auto-scroll
}

const MAX_VIEWPORT_CHARS = 1800; // Leave 200-char buffer under 2000 limit

export function renderViewport(state: ViewportState): string {
  const { messages, scrollOffset } = state;
  if (messages.length === 0) return '';

  // Start from the bottom (latest) and work up by scrollOffset
  const endIdx = messages.length - scrollOffset;
  let text = '';
  let idx = endIdx;

  // Build text from bottom up, stopping when we exceed char limit
  const lines: string[] = [];
  while (idx > 0 && text.length < MAX_VIEWPORT_CHARS) {
    idx--;
    const msg = messages[idx];
    const prefix = msg.role === 'user' ? '  > ' : '';
    const line = `${prefix}${msg.text}`;
    lines.unshift(line);
    text = lines.join('\n');
  }

  // Truncate to hard limit
  if (text.length > MAX_VIEWPORT_CHARS) {
    text = text.slice(text.length - MAX_VIEWPORT_CHARS);
  }

  return text;
}
```

### Pattern 3: Streaming Text Flush Loop

**What:** A `setInterval` at 200ms that flushes accumulated SSE response deltas to the glasses display via `textContainerUpgrade`. This batches rapid per-token arrivals into a smooth 150-300ms update cadence.

**When to use:** During assistant response streaming (FSM state: `thinking`).

**Why 200ms:** The requirement specifies 150-300ms cadence. 200ms is the midpoint. This prevents per-token display thrashing while keeping the streaming feel responsive.

**Example:**
```typescript
// Streaming flush pattern (inside GlassesRenderer)
let streamBuffer = '';
let flushTimer: ReturnType<typeof setInterval> | null = null;

function startStreamFlush(): void {
  stopStreamFlush();
  flushTimer = setInterval(() => {
    if (streamBuffer.length > 0) {
      appendToCurrentMessage(streamBuffer);
      streamBuffer = '';
      renderViewportToGlasses();
    }
  }, 200);
}

function onResponseDelta(text: string): void {
  streamBuffer += text;
}

function stopStreamFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush
  if (streamBuffer.length > 0) {
    appendToCurrentMessage(streamBuffer);
    streamBuffer = '';
    renderViewportToGlasses();
  }
}
```

### Pattern 4: Icon Animation via Image Container

**What:** A `setInterval` loop that cycles through pre-rendered 4-bit greyscale bitmap frames via `updateImageRawData`. Each state (idle, recording, sent, thinking) has its own set of frame bitmaps. The loop drops frames if the previous `updateImageRawData` call is still in-flight (confirmed pattern from Pong reference app).

**When to use:** When the display is active and the conversation state changes.

**Example:**
```typescript
// src/display/icon-animator.ts

export type IconState = 'idle' | 'recording' | 'sent' | 'thinking';

export interface IconAnimator {
  setState(state: IconState): void;
  start(): void;
  stop(): void;
}

export function createIconAnimator(
  updateImage: (data: number[]) => Promise<unknown>,
): IconAnimator {
  let currentState: IconState = 'idle';
  let frameIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function tick(): void {
    if (inFlight) return; // Drop frame if previous still in-flight

    const frames = ICON_FRAMES[currentState];
    const frame = frames[frameIdx % frames.length];
    frameIdx++;

    inFlight = true;
    updateImage(frame).finally(() => { inFlight = false; });
  }

  return {
    setState(state: IconState): void {
      currentState = state;
      frameIdx = 0;
      tick(); // Immediate first frame
    },
    start(): void {
      if (timer) return;
      timer = setInterval(tick, 200); // ~5fps
    },
    stop(): void {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
```

### Pattern 5: Hide/Wake Mode Toggle

**What:** Double-tap in any state toggles between the active chat layout and a blank display. Implemented by calling `rebuildPageContainer` with a single empty text container (blank) or restoring the 3-container chat layout (wake).

**When to use:** UIMD-01 and UIMD-02. The gesture handler intercepts double-tap when `hidden === true` before normal FSM processing.

**Example:**
```typescript
// Hide: blank the display
async function hideDisplay(bridge: EvenAppBridge): Promise<void> {
  await bridge.rebuildPageContainer({
    containerTotalNum: 1,
    textObject: [{
      xPosition: 0, yPosition: 0,
      width: 576, height: 288,
      containerID: 1, containerName: 'blank',
      isEventCapture: 1,
      content: '',
    }],
  });
}

// Wake: restore chat layout
async function wakeDisplay(bridge: EvenAppBridge): Promise<void> {
  await bridge.rebuildPageContainer(CHAT_LAYOUT);
  // Re-render current icon + chat viewport + hint
}
```

### Anti-Patterns to Avoid

- **Relying on firmware scrolling for chat history:** The SDK provides NO scroll position API. You cannot query where the user has scrolled or set the scroll position programmatically. If you put long text in a container with `isEventCapture: 1`, the firmware will handle scrolling but you will have no visibility or control over it. Always manage viewport state in JavaScript.
- **Calling `rebuildPageContainer` for every text update:** This is expensive (full page rebuild). Use `textContainerUpgrade` for text content changes. Reserve `rebuildPageContainer` for layout changes (hide/wake, initial setup).
- **Sending image updates concurrently:** The SDK docs explicitly state "Image transmission must not be sent concurrently -- use a queue mode instead, ensuring the previous image transmission returns successfully before sending the next one." Always await or drop-on-inflight.
- **Exceeding container limits:** Max 4 containers per page, max 16-char container names, max 1000 chars for `rebuildPageContainer` content, max 2000 chars for `textContainerUpgrade` content. Violating these causes silent failures.
- **Attempting right-alignment in text containers:** The SDK renders text left-aligned, top-aligned only. There is no CSS, no text-align property. The only workaround is padding with leading spaces, which is imprecise due to variable character widths.
- **Creating image containers larger than 200x100:** SDK constraint: image container width range is 20-200, height range is 20-100. Exceeding this will fail silently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text scrolling on glasses | Custom firmware scroll tracking | App-managed viewport with `textContainerUpgrade` | No firmware scroll API exists. The only option is to manage viewport state in JS and push the visible window to the container. |
| Per-token display updates | Direct `textContainerUpgrade` on every SSE token | 200ms flush interval that batches tokens | Per-token updates would fire every 20-50ms, exceeding the SDK's comfortable update cadence and causing visual thrashing. |
| Icon bitmap generation at runtime | Canvas-based runtime bitmap renderer | Pre-computed static `number[]` arrays in `icon-bitmaps.ts` | The icon set is fixed (idle, recording, sent, thinking). Runtime generation adds complexity for no benefit. Offline-computed bitmaps are simpler and faster. |
| Text alignment simulation | Complex character-width measurement | Simple prefix markers (`> ` for user) | Variable-width font makes precise space-padding unreliable. Prefix markers are a proven pattern in terminal/glasses UIs. |

**Key insight:** The glasses display is closer to a terminal emulator than a web browser. Think "plain text with careful formatting" not "rich UI with layout engines."

---

## Common Pitfalls

### Pitfall 1: Firmware Scrolling Hijacks User Gestures

**What goes wrong:** If you put long text in the `isEventCapture` container and rely on firmware scrolling, the firmware consumes scroll gestures internally. Your app never receives `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` until the user reaches a boundary -- and you have no idea where in the text they are.

**Why it happens:** The SDK's scroll events are boundary signals, not continuous gesture events. The firmware manages internal scroll state with no API exposure.

**How to avoid:** Keep the text container content short enough that firmware scrolling never activates (stay within ~400-500 chars that fit one screen). Manage scrolling entirely in JavaScript by adjusting the viewport window and re-rendering via `textContainerUpgrade`.

**Warning signs:** Scroll gestures appear to "not work" in testing -- actually the firmware is consuming them internally.

### Pitfall 2: `createStartUpPageContainer` Already Called in Phase 2

**What goes wrong:** Phase 2 called `createStartUpPageContainer` with a single full-screen text container. Phase 3 needs a 3-container layout. Calling `createStartUpPageContainer` again will be silently ignored.

**Why it happens:** The SDK allows `createStartUpPageContainer` to be called only once. All subsequent layout changes must use `rebuildPageContainer`.

**How to avoid:** Phase 3 must use `rebuildPageContainer` to transition from the Phase 2 single-container layout to the 3-container chat layout. This should happen when the display module initializes.

**Warning signs:** New container layout doesn't appear on glasses despite no errors.

### Pitfall 3: Image Container Size Limits

**What goes wrong:** Attempting to create an icon container larger than 200x100 or smaller than 20x20 causes silent creation failure.

**Why it happens:** SDK hardcoded limits: width 20-200, height 20-100.

**How to avoid:** Keep icon container within bounds. A 48x48 icon works well -- large enough to be visible, small enough to leave space for text.

**Warning signs:** Image container doesn't appear on display, `rebuildPageContainer` returns false.

### Pitfall 4: Concurrent Image Updates Cause Corruption

**What goes wrong:** Rapid icon animation frames overlap, causing visual corruption or dropped frames.

**Why it happens:** SDK docs: "Image transmission must not be sent concurrently." The BLE transport serializes image data and a new transmission before the previous completes can corrupt the pipeline.

**How to avoid:** Use the "drop frame if in-flight" pattern from the Pong reference app. Track an `inFlight` boolean, skip the frame if the previous `updateImageRawData` hasn't resolved.

**Warning signs:** Icon appears garbled, frames appear out of order, visual glitches.

### Pitfall 5: `textContainerUpgrade` Content Exceeds 2000 Characters

**What goes wrong:** The SDK silently truncates or fails the update. The display shows stale content.

**Why it happens:** Hard limit in SDK: `content` max 2000 characters for `textContainerUpgrade`.

**How to avoid:** The viewport renderer must enforce a hard cap before calling the SDK. With ~400-500 chars filling a screen, exceeding 2000 would require 4+ screens of text -- which shouldn't happen with proper viewport windowing. Add an assertion/clamp as a safety net.

**Warning signs:** `textContainerUpgrade` returns `false`, display stops updating.

### Pitfall 6: Container Name Exceeds 16 Characters

**What goes wrong:** Container operations silently fail if `containerName` is longer than 16 characters.

**Why it happens:** SDK hardcoded limit.

**How to avoid:** Use short names: `'icon'`, `'chat'`, `'hint'`, `'blank'`.

**Warning signs:** `textContainerUpgrade` returns false despite correct content.

---

## Code Examples

### Extending BridgeService for Display Operations

```typescript
// src/bridge/bridge-types.ts -- extend existing interface
import type { TextContainerUpgrade, RebuildPageContainer, ImageRawDataUpdate,
              ImageRawDataUpdateResult } from '@evenrealities/even_hub_sdk';

export interface BridgeService {
  init(): Promise<void>;
  destroy(): Promise<void>;
  startAudio(): Promise<boolean>;
  stopAudio(): Promise<boolean>;
  // Phase 3 additions:
  textContainerUpgrade(upgrade: TextContainerUpgrade): Promise<boolean>;
  rebuildPageContainer(container: RebuildPageContainer): Promise<boolean>;
  updateImageRawData(data: ImageRawDataUpdate): Promise<ImageRawDataUpdateResult>;
}
```

### Extending AppEventMap for Display Events

```typescript
// Add to src/types.ts AppEventMap:
export interface AppEventMap {
  // ... existing events ...
  'display:state-change': { state: 'idle' | 'recording' | 'sent' | 'thinking' };
  'display:viewport-update': { text: string };
  'display:hide': {};
  'display:wake': {};
}

// Add new types:
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  complete: boolean;
  timestamp: number;
}

export interface ViewportState {
  messages: ChatMessage[];
  scrollOffset: number;
  autoScroll: boolean;
  hidden: boolean;
}
```

### Pre-computed Icon Bitmap (4-bit Greyscale)

```typescript
// src/display/icon-bitmaps.ts
// Each icon is a number[] of 4-bit greyscale pixels (2 pixels per byte)
// for a 48x48 image container.
// Total bytes per frame: (48 * 48) / 2 = 1152 bytes

// Idle: simple circle outline
export const ICON_IDLE: number[] = [/* pre-computed 1152 bytes */];

// Recording: filled circle (alternate with dim for blink)
export const ICON_REC_ON: number[] = [/* pre-computed */];
export const ICON_REC_OFF: number[] = [/* pre-computed (dim/empty) */];

// Sent: checkmark
export const ICON_SENT: number[] = [/* pre-computed */];

// Thinking: rotating dots (4 frames)
export const ICON_THINK_0: number[] = [/* pre-computed */];
export const ICON_THINK_1: number[] = [/* pre-computed */];
export const ICON_THINK_2: number[] = [/* pre-computed */];
export const ICON_THINK_3: number[] = [/* pre-computed */];

export const ICON_FRAMES: Record<string, number[][]> = {
  idle: [ICON_IDLE],                                            // 1 static frame
  recording: [ICON_REC_ON, ICON_REC_OFF],                      // 2-frame blink
  sent: [ICON_SENT],                                            // 1 static frame
  thinking: [ICON_THINK_0, ICON_THINK_1, ICON_THINK_2, ICON_THINK_3], // 4-frame rotation
};
```

### Chat Message Text Serialization

```typescript
// Serialize messages to plain text for the glasses display
// User messages get a "> " prefix to simulate right-alignment
// Messages separated by blank line

export function serializeMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const prefix = m.role === 'user' ? '> ' : '';
      const suffix = m.complete ? '' : ' ...';
      return `${prefix}${m.text}${suffix}`;
    })
    .join('\n\n');
}
```

### Complete Glasses Renderer Integration

```typescript
// src/display/glasses-renderer.ts (sketch)
import type { BridgeService } from '../bridge/bridge-types';
import type { EventBus } from '../events';
import type { AppEventMap, ChatMessage } from '../types';

export interface GlassesRenderer {
  init(): Promise<void>;
  destroy(): void;
  addUserMessage(text: string): void;
  startStreaming(): void;
  appendStreamChunk(text: string): void;
  endStreaming(): void;
  scrollUp(): void;
  scrollDown(): void;
  hide(): Promise<void>;
  wake(): Promise<void>;
  setIconState(state: 'idle' | 'recording' | 'sent' | 'thinking'): void;
}

export function createGlassesRenderer(opts: {
  bridge: BridgeService;
  bus: EventBus<AppEventMap>;
}): GlassesRenderer {
  const messages: ChatMessage[] = [];
  let scrollOffset = 0;
  let autoScroll = true;
  let hidden = false;
  let streamFlushTimer: ReturnType<typeof setInterval> | null = null;
  let streamBuffer = '';
  // ... implementation follows patterns above
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full-page rebuild for every text update | `textContainerUpgrade` for in-place updates | SDK v0.0.6+ (confirmed by pong-even-g2 reference app) | Much faster updates; `rebuildPageContainer` only for layout changes |
| Firmware-managed text scrolling | App-managed viewport windowing | Practical discovery (no scroll API exists) | Apps must manage scroll state in JavaScript, not rely on firmware |
| Single text container for all display | Multi-container pages (up to 4) | SDK container model from v0.0.1 | Enables separate icon, chat, and hint containers |
| No animation support | `updateImageRawData` with interval loop | Confirmed by pong-even-g2 achieving ~12fps | Icon animations at 3-6fps are well within hardware capability |

**Deprecated/outdated:**
- Attempting to use `createStartUpPageContainer` for layout changes after initial boot. Use `rebuildPageContainer` instead.
- Relying on `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` as navigation controls. These are boundary signals only, not gesture proxies.

---

## Open Questions

1. **What is the exact 4-bit greyscale pixel packing format for `updateImageRawData`?**
   - What we know: The SDK accepts `number[]` (recommended), `Uint8Array`, `ArrayBuffer`, or base64 string. The display is 4-bit greyscale (16 levels).
   - What's unclear: Whether pixels are packed 2-per-byte (high nibble first?), row-major order, and whether the alpha/transparency channel exists. The pong-even-g2 app uses Unicode text rendering, not image containers, so it doesn't clarify this.
   - Recommendation: Start with the simplest assumption (row-major, 2 pixels per byte, high nibble = left pixel). Test on hardware or simulator. If needed, create a small test image with known pattern to determine the format empirically. This could also be deferred by using Unicode text icons as a fallback (simpler but less visually polished).

2. **Does `textContainerUpgrade` preserve or reset scroll position on content with `isEventCapture: 1`?**
   - What we know: Community notes say "on the simulator, this still causes a visual redraw." On hardware it's smoother.
   - What's unclear: If the content is short enough to not overflow (our viewport approach), this is irrelevant. But if content accidentally overflows, firmware might reset scroll to top.
   - Recommendation: Keep viewport content under ~400 chars (one screenful) so firmware scrolling never activates. This makes the question moot.

3. **Unicode icon fallback -- can we use Unicode symbols instead of image containers?**
   - What we know: The G2 supports geometric shapes (U+25A0-U+25FF) and various symbols. The Pong app uses `□`, `▦`, `●` successfully.
   - What's unclear: Whether enough appropriate symbols exist for idle/recording/sent/thinking states.
   - Recommendation: Consider a simpler approach for the first iteration: use Unicode text icons in the status bar area (e.g., `●` for recording, `✓` for sent, `◌` for idle, `⋯` for thinking). This eliminates the image container complexity entirely and uses only 2 containers (chat + hint). Upgrade to image containers in a future iteration if Unicode icons are insufficient. **This is a Claude's Discretion decision for the planner.**

4. **How does `rebuildPageContainer` interact with active `setInterval` animation loops?**
   - What we know: `rebuildPageContainer` recreates all containers. Any in-flight `updateImageRawData` or `textContainerUpgrade` calls targeting old container IDs should be cancelled.
   - What's unclear: Whether the SDK returns errors for updates to stale container IDs, or silently ignores them.
   - Recommendation: Stop all animation/flush timers before calling `rebuildPageContainer`. Restart after the new layout is confirmed.

---

## Sources

### Primary (HIGH confidence)

- `@evenrealities/even_hub_sdk@0.0.7` npm package (`dist/index.d.ts` + `README.md`) -- all SDK API shapes, container constraints, text limits, image container limits confirmed from this authoritative source
- [even-g2-notes/G2.md by nickustinov](https://github.com/nickustinov/even-g2-notes/blob/main/G2.md) -- comprehensive reverse-engineering of SDK behavior: 576x288 resolution, 4-bit greyscale, text alignment (left-only), ~400-500 chars per screen, no scroll position API, container property ranges. Cross-verified with SDK types.
- [pong-even-g2 by nickustinov](https://github.com/nickustinov/pong-even-g2) -- working reference app confirming: `textContainerUpgrade` for frame-by-frame rendering, ~12fps achievable, drop-frame-if-inflight pattern, hidden event-capture container trick, Unicode character rendering on G2 display

### Secondary (MEDIUM confidence)

- [Even Realities EvenDemoApp](https://github.com/even-realities/EvenDemoApp) -- official reference implementation (Kotlin/Android), confirms pagination-based text display pattern and dual-BLE architecture
- [Even Hub platform](https://evenhub.evenrealities.com/) -- confirmed EvenHub submission process and developer access
- Existing project codebase (`src/bridge/even-bridge.ts`, `src/gestures/gesture-handler.ts`, `src/types.ts`) -- established patterns for event bus, service architecture, and Phase 2 bridge integration

### Tertiary (LOW confidence)

- [even-g2-protocol by i-soxi](https://github.com/i-soxi/even-g2-protocol) -- BLE protocol reverse-engineering. Display channel details are incomplete/WIP. Mentioned for context but not relied upon for display rendering decisions.
- 4-bit greyscale pixel packing format -- not definitively documented in any source. The assumption of row-major, 2 pixels per byte is reasonable but needs hardware validation.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- No new libraries needed. All rendering uses existing SDK methods already verified in Phase 2.
- Architecture: HIGH -- Three-container layout derived from SDK container model constraints. App-managed viewport confirmed necessary by absence of scroll API (verified in multiple sources). Streaming flush pattern proven by pong-even-g2.
- Pitfalls: HIGH -- All pitfalls derive from verified SDK constraints (container limits, no scroll API, concurrent image restriction, container name length).
- Icon rendering: MEDIUM -- Image container approach is sound but pixel packing format is not definitively documented. Unicode text fallback provides a safe alternative.
- Chat bubble simulation: HIGH -- Left-aligned text with prefix markers is the standard approach for G2 apps. Right-alignment is impossible in the SDK.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (SDK display API is stable; pixel format question may resolve with hardware testing)
