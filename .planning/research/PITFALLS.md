# Pitfalls Research

**Domain:** Smart glasses voice/chat frontend (Even G2 + OpenClaw AI agent)
**Researched:** 2026-02-27
**Confidence:** MEDIUM-HIGH (domain-specific constraints verified; EvenHub submission details LOW confidence due to limited public documentation)

## Critical Pitfalls

### Pitfall 1: Audio Capture Format Mismatch Across Browsers

**What goes wrong:**
The app hardcodes an audio MIME type (e.g., `audio/webm;codecs=opus`) for MediaRecorder, then sends that blob to the backend gateway for STT processing. Safari on iOS produces `audio/mp4` instead of `audio/webm`, and older Safari versions have limited MediaRecorder support entirely. The gateway's STT provider rejects the audio with encoding errors, or the audio silently produces empty transcripts.

**Why it happens:**
Developers test on Chrome/desktop where `audio/webm;codecs=opus` works perfectly. Safari's MediaRecorder produces different container formats. The assumption that one MIME type works everywhere is the root cause.

**How to avoid:**
- Use `MediaRecorder.isTypeSupported()` to probe formats in preference order: `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`, `audio/wav`
- Send the detected MIME type as metadata alongside the audio blob to the gateway, so the STT provider can handle format-specific decoding
- Build a `getPreferredAudioFormat()` utility tested on Chrome, Firefox, Safari, and mobile browsers
- Include the MIME type in the API contract between frontend and gateway

**Warning signs:**
- STT transcription works on desktop Chrome but returns empty results on mobile Safari
- Users on iPhones report "nothing happens" when they speak
- Gateway logs show codec/encoding errors for some requests

**Phase to address:**
Audio capture foundation phase -- must be resolved before any voice feature can ship reliably.

---

### Pitfall 2: Streaming Text Causes Layout Thrashing on 576x288 Display

**What goes wrong:**
Each streamed token from the LLM response triggers a DOM update that causes a browser reflow. On the constrained 576x288 glasses display, this creates visible flicker, stuttering text, and frame drops below the 3-6 fps target. The text appears to "jump" as the bubble resizes with each token.

**Why it happens:**
Naive streaming appends text to an element per token (every 50-150ms). Each append changes the element's dimensions, triggering a reflow of the entire chat container. Reading `scrollHeight` to auto-scroll after each append forces a synchronous layout, creating a read-write-read-write cycle (layout thrashing). On a 576x288 canvas this is visually devastating because the entire viewport is the text area.

**How to avoid:**
- Batch token appends using `requestAnimationFrame` -- collect tokens in a buffer and flush to DOM at most once per frame (target 150-300ms cadence per PROJECT.md)
- Use `textContent` or a single `innerHTML` replace rather than incremental `appendChild` calls
- Separate DOM reads (scrollHeight) from writes -- read first, batch writes, then schedule scroll adjustment in the next rAF
- Use CSS `will-change: transform` on the chat container to promote it to a compositor layer
- Cap the visible bubble text and truncate with ellipsis when the 2000-char response limit is approached

**Warning signs:**
- Visible text "jumping" during streaming on the simulator preview
- DevTools Performance tab shows forced reflows during streaming
- Streaming feels smooth on desktop but stutters on the glasses display emulator

**Phase to address:**
Streaming renderer phase -- must be designed into the bubble chat renderer from the start. Retrofitting batching into a naive character-by-character renderer is painful.

---

### Pitfall 3: Gesture State Machine Has No Debounce or Conflict Resolution

**What goes wrong:**
With only 4 gestures (tap, double-tap, scroll up, scroll down) mapped to many actions, the state machine fails to distinguish between a single tap and the first tap of a double-tap. Rapid scrolls fire multiple events. Users accidentally trigger recording when they meant to double-tap for the menu, or scroll past their target because momentum events keep firing.

**Why it happens:**
The tap vs double-tap ambiguity is inherent: you cannot know if a tap is "single" until the double-tap window expires (typically 300ms). Developers either skip the debounce window (causing double-tap to always trigger single-tap first) or set it too long (making single-tap feel laggy). Scroll events from the Even G2 touchbar arrive as discrete packets, not continuous values, and developers treat them like mouse wheel events.

**How to avoid:**
- Implement a finite state machine with explicit states: IDLE, TAP_PENDING (waiting for possible second tap), RECORDING, SCROLLING, MENU_OPEN
- Use a 250-300ms debounce window for tap vs double-tap discrimination -- delay single-tap action until the window expires
- Debounce scroll events with a 100ms cooldown to prevent rapid-fire scroll jumps
- Make the state machine the single source of truth for all gesture interpretation -- never interpret raw gesture events directly in UI components
- Test the state machine independently with synthetic event sequences before connecting to real hardware

**Warning signs:**
- Users report "accidental recordings" when trying to open the menu
- Single-tap actions feel sluggish (debounce window too long) or double-tap never registers (debounce window too short)
- Scrolling overshoots by multiple pages

**Phase to address:**
Gesture handling phase -- build and test the state machine in isolation before wiring it to UI actions. This is a dependency for every interactive feature.

---

### Pitfall 4: SSE/Streaming Connection Silently Buffers Behind Proxies

**What goes wrong:**
The SSE (Server-Sent Events) connection from the frontend to the gateway works perfectly in local development, but in production, intermediary proxies (CDNs, corporate firewalls, nginx reverse proxies) buffer the entire SSE stream and deliver it all at once when the connection closes. The user sees nothing for 10-30 seconds, then the complete response appears instantly -- defeating the purpose of streaming.

**Why it happens:**
HTTP intermediaries are legally allowed to buffer chunked responses. Many proxies coalesce chunks before forwarding. This is documented but rarely tested during development because localhost has no intermediaries. The Even G2 glasses connect through the user's phone, which may route through corporate networks or carrier proxies.

**How to avoid:**
- Set response headers explicitly: `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no` (nginx-specific), `Connection: keep-alive`
- Use `fetch()` with `ReadableStream` instead of `EventSource` for more control over buffering behavior -- EventSource has a 6-connection-per-domain limit on HTTP/1.1
- Implement a heartbeat: the gateway sends a comment line (`: heartbeat\n\n`) every 15 seconds so the frontend can detect dead connections vs buffered ones
- Document proxy requirements in the deployment guide
- Test with a real reverse proxy (nginx, Cloudflare) in staging, not just localhost

**Warning signs:**
- Streaming works on localhost but response appears "all at once" in staging/production
- Long responses take 30+ seconds with no visual feedback
- SSE connection shows as "pending" for extended periods in DevTools Network tab

**Phase to address:**
Backend API client / streaming integration phase. The gateway team must implement heartbeats and correct headers. The frontend must detect and surface buffering issues.

---

### Pitfall 5: Storing API Keys and Session Tokens in localStorage

**What goes wrong:**
The settings form stores the backend gateway URL, session key, and potentially STT provider API keys in `localStorage`. Any XSS vulnerability (even from a third-party script or injected content) can exfiltrate all stored secrets with a single `JSON.stringify(localStorage)` call. Since this is an EvenHub public app, attack surface includes any code that runs in the same origin.

**Why it happens:**
`localStorage` is the easiest persistence mechanism and works across page reloads. Developers rationalize that "the gateway URL isn't really a secret" while the session key absolutely is. The PROJECT.md correctly notes "no secrets in frontend" but the settings form stores a session key that acts as a bearer credential.

**How to avoid:**
- The gateway URL and non-secret preferences: `localStorage` is acceptable
- Session keys: use `sessionStorage` (cleared on tab close) as the minimum, but prefer receiving a short-lived session cookie from the gateway with `HttpOnly; Secure; SameSite=Strict` flags
- Never store STT provider API keys in the frontend at all -- these belong exclusively in the gateway (per PROJECT.md out-of-scope)
- Implement the settings export/import feature WITHOUT secrets by default (as already planned) -- but enforce this with a whitelist of exportable keys, not a blacklist of secret keys
- Mask sensitive values in the UI (show only last 4 characters)

**Warning signs:**
- Settings export JSON contains full session keys or API keys
- DevTools Application tab shows secrets in localStorage in plain text
- No differentiation between "preferences" and "credentials" in the storage layer

**Phase to address:**
Settings persistence phase. Must be designed correctly from the start -- migrating from localStorage to a cookie-based session model later requires reworking the auth flow.

---

### Pitfall 6: LC3 Audio Codec Not Natively Supported in Browsers

**What goes wrong:**
The Even G2 glasses stream microphone audio in LC3 (Low Complexity Communication Codec) format over BLE. The frontend attempts to play or process this audio directly, but no browser natively decodes LC3. The audio pipeline silently produces silence or throws obscure codec errors.

**Why it happens:**
LC3 is a Bluetooth LE Audio codec (Bluetooth 5.2+), not a web audio codec. Developers familiar with the glasses' BLE protocol assume the audio format will "just work" in the browser. The EvenDemoApp (Flutter) handles LC3 natively through platform-specific decoders, but a web app has no such luxury.

**How to avoid:**
- The gateway (not the frontend) should handle LC3 decoding -- audio flows from glasses -> phone app -> gateway, and the gateway transcodes to a web-friendly format before any frontend involvement
- If the frontend must handle raw audio from the glasses (via Web Bluetooth), compile Google's `liblc3` to WebAssembly as a decoder module
- Alternatively, use the phone's native companion app to relay already-decoded PCM/WAV audio to the web frontend via a local WebSocket
- Document the audio pipeline clearly: which component owns which codec transformation
- The 30-second recording limit per session (from EvenDemoApp protocol) must be respected and communicated to the user

**Warning signs:**
- Audio data arrives from BLE but produces silence or errors in Web Audio API
- Large unexplained binary blobs in WebSocket messages with no documentation
- Audio works in the Flutter demo app but not in the web app

**Phase to address:**
Audio capture / bridge event handling phase. The architecture decision about where LC3 decoding happens must be made before writing any audio code.

---

### Pitfall 7: Virtual Scroll Breaks Browser Find and Accessibility

**What goes wrong:**
The virtualized chat history viewport renders only visible bubbles (correct for performance on 576x288), but browser Ctrl+F cannot find text in off-screen bubbles because they do not exist in the DOM. Screen readers cannot navigate the full conversation. The glasses' scroll gestures interact poorly with the virtual scroll because they produce discrete jumps, not smooth scrolling.

**Why it happens:**
Virtualization by definition removes DOM nodes. Standard virtual scroll libraries expect continuous scroll positions (mouse wheel or touch), not discrete gesture events. The glasses' scroll-up/scroll-down gestures are more like "page up / page down" than "scroll by 40px."

**How to avoid:**
- Implement pagination-style navigation instead of pixel-based virtual scrolling -- the glasses display shows ~3-5 bubbles at a time, so "page up" and "page down" that shift the visible window by N bubbles is more appropriate than a smooth virtual scroller
- Keep a lightweight in-memory model of all messages but render only the current "page" of bubbles
- For the companion mobile/desktop hub view, use standard virtual scrolling (it has a normal scroll interface)
- Map scroll-up/scroll-down gestures to "previous page" / "next page" in the glasses renderer, not to `scrollBy()` calls
- Add a "jump to latest" action (maybe on double-tap from scrolled-up position)

**Warning signs:**
- Scroll gestures on glasses cause 1-pixel movements or wildly unpredictable jumps
- Users cannot return to the latest message after scrolling up
- Virtual scroll library complains about missing scroll container or zero-height items

**Phase to address:**
Bubble chat renderer / virtualized viewport phase. The rendering model for glasses must be page-based from the start, not adapted from a continuous-scroll design.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode audio format to webm/opus | Works immediately on Chrome | Breaks on Safari/iOS, requires rewrite of audio pipeline | Never -- format detection is ~10 lines of code |
| Single global state object for everything | Quick prototyping, no state management library | Impossible to test, gesture state bleeds into UI state | First 2 weeks of prototyping only, refactor before any release |
| innerHTML for streaming text | Simple token append | XSS vector if any AI response contains HTML, breaks streaming batching | Never in production -- use textContent or a sanitized renderer |
| Skip SSE heartbeat in gateway | Simpler gateway implementation | Silent failures in production behind proxies go undetected | Never -- heartbeats are trivial to implement |
| Inline styles for glasses display | Fast iteration on 576x288 layout | Cannot theme or adapt to potential display resolution changes (G2 demo shows 576x136, reviews say 640x350) | During simulator prototyping only |
| Skip gesture state machine, use if/else | Faster first implementation | Untestable, edge cases multiply, accidental state transitions | Never -- even a basic state machine takes 50 lines |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Even G2 BLE Protocol | Sending data to only one lens | Protocol requires: send to left first, wait for ACK, then send to right. Skipping this causes one-lens-only display |
| Gateway SSE stream | Using `EventSource` with auth tokens | `EventSource` cannot set custom headers. Use `fetch()` with `ReadableStream` and pass auth via query param or cookie |
| MediaRecorder stop | Calling `.stop()` and immediately reading data | The `dataavailable` event fires asynchronously after `.stop()`. Must await the event before processing the blob |
| BLE Audio (LC3) | Assuming continuous audio stream | Audio packets have 0-255 sequence numbers with 30-second limit. Must track sequence and handle rollover |
| localStorage settings | Syncing settings across tabs | localStorage fires `storage` events only in OTHER tabs, not the current one. Use a wrapper that also fires locally |
| Gateway URL configuration | Hardcoding localhost:8080 | URL must be user-configurable since the gateway runs on the user's own infrastructure. Default to empty with clear setup instructions |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| DOM updates per token | Visible stutter during streaming, dropped frames | Batch in rAF, flush at 150-300ms cadence | Immediately on 576x288 display; at ~50 tokens/sec on desktop |
| Unbounded chat history in DOM | Page slows over time, memory climbs | Virtualize: render only visible page of ~5 bubbles on glasses | After ~100 messages without virtualization |
| Re-rendering entire chat on each message | Scroll position jumps, flash of content | Append-only: add new bubble at bottom, do not re-render existing bubbles | After ~20 messages in a conversation |
| CSS animations on glasses display | Frame drops, missed gesture events | Limit to 3-6 fps animations using CSS `steps()` or JS intervals, not `transition` | Immediately -- glasses display is not a desktop monitor |
| Large base64 audio in WebSocket | Memory spikes, GC pauses visible as UI freezes | Stream audio as binary frames, not JSON-encoded base64 | Audio clips > 5 seconds |
| EventSource 6-connection limit | Second tab or reconnection fails silently | Use fetch + ReadableStream, or ensure HTTP/2 on the gateway | When user opens 2+ tabs, or SSE reconnects without closing prior connection |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing session key in localStorage | XSS exfiltrates the key, attacker impersonates user on gateway | Use sessionStorage (minimum) or HttpOnly cookie from gateway |
| Passing session key as URL query parameter | Key appears in server logs, browser history, referer headers | Use Authorization header or POST body; never in GET params |
| Rendering unsanitized AI response HTML | LLM outputs `<script>` or event handler attributes, causing XSS | Always use textContent for bubble text; if markdown needed, use a sanitizer like DOMPurify |
| Exposing gateway URL validation errors verbosely | Error messages reveal internal gateway architecture | Show generic "connection failed" to user; log details to diagnostics view only |
| Settings export includes secrets | User shares export file for debugging, leaks credentials | Whitelist exportable keys; never export anything that looks like a token/key |
| No CORS validation on gateway | Any website can make requests to user's gateway | Gateway must set strict `Access-Control-Allow-Origin` to the app's origin only |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual feedback during tap-to-record debounce | 300ms delay feels broken -- user taps again, triggering double-tap | Show an immediate "preparing..." micro-animation on first tap; resolve to recording or menu after debounce |
| Auto-scroll hijacks reading position | User scrolls up to re-read, new streaming text yanks them to bottom | Only auto-scroll when user is already at the bottom; show a "new message" indicator when scrolled up |
| Streaming text reflows bubble width | Bubble starts narrow with first word, grows wider mid-stream, text reflows | Set bubble to max-width from the start of streaming; use a fixed-width container for the response area |
| No indication of recording duration | User speaks for 45 seconds but 30-second limit means last 15 seconds are lost | Show a timer countdown and auto-stop at 28 seconds with haptic/visual warning |
| Error messages too technical | "SSE connection reset: ERR_HTTP2_PROTOCOL_ERROR" on glasses display | Map errors to human messages: "Connection lost. Tap to retry." Save technical details for the diagnostics/logs view |
| Menu requires memorizing gesture sequences | User forgets which gesture does what | Always show the current gesture hint at bottom of glasses display: "Tap=Rec | 2x=Menu | Scroll=History" |

## "Looks Done But Isn't" Checklist

- [ ] **Audio capture:** Often missing Safari/iOS format detection -- verify with `MediaRecorder.isTypeSupported()` on real Safari
- [ ] **Streaming renderer:** Often missing token batching -- verify with DevTools Performance recording during a long stream
- [ ] **Gesture handling:** Often missing tap/double-tap debounce -- verify by rapidly alternating tap and double-tap patterns
- [ ] **SSE connection:** Often missing heartbeat detection -- verify by introducing a 60-second network pause and checking if frontend detects it
- [ ] **Virtual scroll:** Often missing "jump to latest" after scrolling up -- verify by scrolling up during an active stream, then checking if you can return
- [ ] **Settings persistence:** Often missing secret masking in export -- verify by exporting settings and checking the JSON for unmasked keys
- [ ] **Dual-lens BLE protocol:** Often missing left-then-right-with-ACK sequencing -- verify by checking if both lenses display identical content
- [ ] **Error recovery:** Often missing reconnection after phone sleep/wake -- verify by locking phone for 30 seconds during a stream, then unlocking
- [ ] **Display text overflow:** Often missing truncation at 2000 chars -- verify with a response that exceeds the limit
- [ ] **Recording limit:** Often missing 30-second auto-stop -- verify by recording continuously for 35 seconds

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Audio format mismatch | LOW | Add format detection utility, update API contract to include MIME type, ~1 day work |
| Layout thrashing in streaming | MEDIUM | Refactor renderer to use rAF batching, may require restructuring the streaming callback chain, ~2-3 days |
| Missing gesture debounce | MEDIUM | Extract gesture handling into a state machine module, rewrite event handlers, ~2 days |
| SSE proxy buffering | LOW | Add headers on gateway side, switch frontend from EventSource to fetch+ReadableStream, ~1 day each side |
| Secrets in localStorage | MEDIUM | Migrate to sessionStorage + cookie-based session, requires gateway changes for cookie auth, ~3 days |
| LC3 codec in browser | HIGH | Requires architectural decision and possibly WebAssembly compilation or gateway-side transcoding, ~1 week |
| Virtual scroll with discrete gestures | HIGH | May require abandoning scroll-based virtualization for page-based rendering model, ~1 week if discovered late |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Audio format mismatch | Audio capture / bridge events | Test recording on Chrome, Firefox, and Safari; check blob MIME type matches gateway expectation |
| Streaming layout thrashing | Streaming response renderer | DevTools Performance recording shows no forced reflows during streaming; text update cadence stays at 150-300ms |
| Gesture debounce / conflict | Gesture handling state machine | Automated test: fire tap, wait 100ms, fire tap -- should produce double-tap, not two single-taps |
| SSE proxy buffering | Backend API client | Deploy behind nginx in staging; verify first token appears within 500ms of stream start |
| Secrets in localStorage | Settings persistence | Security review: `Object.keys(localStorage)` contains no tokens or keys; export JSON contains no secrets |
| LC3 codec handling | Audio capture architecture | Audio from glasses plays/processes correctly in browser; or architecture doc confirms gateway handles decoding |
| Virtual scroll + discrete gestures | Bubble chat / virtualized viewport | Scroll gesture moves exactly 1 page of bubbles; no partial-pixel drift; "jump to latest" works |
| Auto-scroll vs reading position | Bubble chat renderer | Scroll up during stream; new content does not yank position; "new message" indicator appears |
| BLE dual-lens protocol | Glasses connection / display | Both lenses show identical content; left-first-then-right-with-ACK verified in BLE traffic logs |
| Recording duration limit | Audio capture | Recording auto-stops at 28-30 seconds with visual countdown; no silent audio loss |

## Even G2 Display Resolution Ambiguity

**Special note:** Research found conflicting display specifications:
- EvenDemoApp GitHub: 576x136 pixels, 1-bit BMP
- PROJECT.md: 576x288 pixels
- Hardware reviews: 640x350 pixels, green monochrome

This discrepancy is critical. The 576x136 (1-bit BMP) figure likely refers to the raw BLE protocol image buffer, the 640x350 likely refers to the optical display's native resolution, and 576x288 may be the effective rendering canvas after accounting for status bar and hint areas.

**Impact:** Text sizing, bubble layout, and character count limits all depend on the correct resolution. Building against the wrong resolution means the UI will either be too cramped or waste space.

**Prevention:** Verify the actual rendering canvas early using the simulator and a connected G2 device. Do not assume any resolution is correct until validated on hardware.

## Sources

- [Getting Started with getUserMedia in 2026](https://blog.addpipe.com/getusermedia-getting-started/) -- MEDIUM confidence
- [Common getUserMedia Errors](https://blog.addpipe.com/common-getusermedia-errors/) -- MEDIUM confidence
- [iPhone Safari MediaRecorder Audio Recording](https://www.buildwithmatija.com/blog/iphone-safari-mediarecorder-audio-recording-transcription) -- MEDIUM confidence
- [MediaRecorder API support tables](https://caniuse.com/mediarecorder) -- HIGH confidence
- [SSE Not Production Ready (lessons learned)](https://dev.to/miketalbot/server-sent-events-are-still-not-production-ready-after-a-decade-a-lesson-for-me-a-warning-for-you-2gie) -- MEDIUM confidence
- [Server-Sent Events: Practical Guide for Real World](https://tigerabrodi.blog/server-sent-events-a-practical-guide-for-the-real-world) -- MEDIUM confidence
- [Streaming LLM Responses: SSE to Real-Time UI](https://dev.to/pockit_tools/the-complete-guide-to-streaming-llm-responses-in-web-applications-from-sse-to-real-time-ui-3534) -- MEDIUM confidence
- [Open-WebUI Virtual Scrolling Performance Discussion](https://github.com/open-webui/open-webui/discussions/13787) -- MEDIUM confidence
- [Google's liblc3 WebAssembly Support](https://github.com/google/liblc3) -- HIGH confidence
- [Even Realities EvenDemoApp (BLE protocol)](https://github.com/even-realities/EvenDemoApp) -- HIGH confidence
- [Smart Glasses UX Design for Comfort](https://www.influencers-time.com/design-smart-glasses-apps-for-user-comfort-and-privacy-in-2025/) -- LOW confidence
- [Wearable Web UX Principles 2025](https://www.influencers-time.com/designing-wearable-web-experiences-ux-principles-for-2025/) -- LOW confidence
- [Even Hub Developer Portal](https://evenhub.evenrealities.com/) -- HIGH confidence (but limited public docs)
- [Google Minimize Browser Reflow](https://developers.google.com/speed/docs/insights/browser-reflow) -- HIGH confidence
- [localStorage Security: Stop Using for Secrets](https://medium.com/@stanislavbabenko/just-stop-using-localstorage-for-secrets-honestly-ea9ef9af9022) -- MEDIUM confidence
- [Intuitive Scrolling for Chatbot Streaming](https://tuffstuff9.hashnode.dev/intuitive-scrolling-for-chatbot-message-streaming) -- MEDIUM confidence

---
*Pitfalls research for: Even G2 OpenClaw Chat App -- smart glasses voice/chat frontend*
*Researched: 2026-02-27*
