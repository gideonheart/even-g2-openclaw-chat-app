# User Message Visual Differentiation on Even G2 Glasses

## Recommendation (TL;DR)

**Use approach (c) Prefix Enhancement + (d) Truncation combined:**

1. Replace the current `> ` prefix with a Unicode vertical bar marker `▎` (U+258E, Left one-quarter block) to create a visible sidebar effect on user messages.
2. Abbreviate user messages to a single-line summary (truncated with ellipsis) since the user already knows what they said -- this naturally makes assistant responses visually dominant.

This is the most practical approach given G2 hardware constraints (single font, no per-character color, no background fill). It requires only changes to `serializeMessages()` in `viewport.ts`.

**Implementation sketch:**

```typescript
// In serializeMessages(), change the user prefix:
const prefix = m.role === 'user' ? '\u258E ' : '';  // ▎ instead of >

// Optionally truncate user messages to save viewport space:
const MAX_USER_DISPLAY = 40;
const displayText = m.role === 'user' && m.text.length > MAX_USER_DISPLAY
  ? m.text.slice(0, MAX_USER_DISPLAY) + '...'
  : m.text;
```

The `▎` character (Left one-quarter block) is confirmed available in the G2 firmware font (U+258E is in the Block Elements range U+2580-U+2595, tested on simulator). It renders as a thin vertical bar that creates a visual "quote sidebar" effect, making user messages feel indented/secondary compared to flush-left assistant text.

---

## 1. SDK Capability Audit

### Text Rendering Constraints

Source: `../even-g2-notes/G2.md` and `../even-g2-notes/docs/display.md`

| Capability | Status | Notes |
|---|---|---|
| Font color per character | Not available | All text is single green (micro-LED) |
| Font size control | Not available | Single firmware font, no size selection |
| Bold/italic/underline | Not available | No text styling of any kind |
| Text alignment | Left-aligned only | No center, no right-align; must pad with spaces |
| Background color/fill | Not available | No background property on containers |
| Per-character brightness | Not available | Greyscale is display-wide, not per-glyph |

### Container-Level Visual Controls

Text containers support these decoration properties:

| Property | Range | Potential for differentiation |
|---|---|---|
| `borderWidth` | 0-5 | Could create a visible frame around user messages |
| `borderColor` | 0-16 (greyscale) | Subtle (5) vs bright (13) border |
| `borderRdaius` | 0-10 | Rounded vs sharp corners |
| `paddingLength` | 0-32 | Indentation effect via padding |

**Key limitation:** These properties apply to the _entire container_, not to individual messages within a container. To use different borders for user vs assistant messages, you would need separate containers.

### Unicode Glyph Support (Relevant Subset)

Confirmed available in firmware font (tested on Even Hub Simulator v0.0.7):

| Char | Code | Potential use |
|---|---|---|
| `▎` | U+258E | Left one-quarter block -- thin sidebar marker |
| `▏` | U+258F | Left one-eighth block -- thinner sidebar |
| `▌` | U+258C | Left half block -- bold sidebar |
| `▒` | U+2592 | Medium shade -- visual noise/dimming effect |
| `│` | U+2502 | Box drawing vertical -- clean sidebar |
| `┃` | U+2503 | Heavy box vertical -- bold sidebar |
| `▕` | U+2595 | Right one-eighth block |

Confirmed **missing** (would be skipped silently):

| Char | Code | Notes |
|---|---|---|
| `░` | U+2591 | Light shade -- would have been ideal for dimming |
| `▓` | U+2593 | Dark shade |
| Mathematical italic | U+1D400+ | Entirely absent range |
| Subscript/superscript | U+2070+ | Not tested, likely absent |
| Small caps | Various | Not a Unicode feature, no font support |

### Multiple Container Approach

The SDK supports up to **4 containers per page**. Current layout uses 2 (status + chat). This leaves 2 unused slots.

**Could we split user/assistant into separate containers?** In theory, yes -- but the chat is a scrolling conversation with interleaved messages. Splitting into two containers would require:
- A fixed "user" container at the bottom and an "assistant" container at the top
- Or alternating container rebuilds per message (expensive `rebuildPageContainer` calls)

Neither approach works well for a flowing conversation. The single chat container with text-level differentiation is the better architecture.

### Image Container Overlay

Could a semi-transparent image overlay create a "dim" effect over user text?

**No.** Image containers are separate rectangles positioned absolutely on the canvas. They:
- Cannot overlay text containers (image containers draw on top, obscuring text completely)
- Are limited to 200x100px (too small for a full chat container overlay)
- Have no transparency/alpha channel (4-bit greyscale, no alpha)
- Would require sequential send (no concurrent image updates)

This approach is not feasible.

---

## 2. Sample Project Survey

### EvenTwitchChat (`../EvenTwitchChat/src/message-buffer.ts`)

Uses a configurable message format for differentiating usernames from messages:
- `"user: msg"` format: `username: message text`
- `"> msg"` format: `> message text` (same as our current approach)
- Plain format: just the message text

**Pattern:** Text-prefix-only differentiation. No Unicode tricks, no container-level styling. Strips all non-ASCII/Latin-1 characters for safety (`stripUnsupported` removes everything outside 0x20-0xFF).

**Takeaway:** The simplest G2 app uses only text prefixes for differentiation. The `> ` convention is the de facto standard.

### Itsyhome (`../itsyhome-even-g2/g2/renderer.ts`)

Uses **multi-container layout** to differentiate data types:
- Dashboard: list container (rooms) + text container (status summary) side by side
- Device screen: list container (actions) + text container (device state) side by side

**Pattern:** Container-level separation -- different data types go into different containers with different borders (`borderWidth: 1, borderColor: 5`). This works because the data types are spatially separated (left panel vs right panel), not interleaved.

**Takeaway:** Multi-container works for spatially separated content but not for interleaved chat messages.

### ePub Reader (`../epub-reader-g2/src/even-client.ts`)

Uses **multi-container layout** for reading view:
- Text container (book content) + footer container (progress bar)
- Or text container + sidebar container (vertical progress bar)
- Chapter list: 4 text containers as "slots" with `borderWidth: isSelected ? 1 : 0` for selection highlighting

**Pattern:** `borderWidth` toggle for visual selection state. Uses `━` and `─` for progress bars (thick/thin horizontal lines). Manual space-padding for "centering" text.

**Takeaway:** Border toggle is the only container-level visual differentiation technique used. Progress bar uses Unicode line-drawing characters for visual weight difference (thick vs thin).

### G2 Flashcards (`../g2-flashcards/src/g2-review.ts`)

Uses **two-container layout** for card review:
- Text container (answer/back content) at top
- List container (rating buttons) at bottom

Card front vs back differentiation is handled by full page rebuilds (different screens), not visual styling within a single container.

**Pattern:** Screen-level differentiation (front screen vs back screen), not text-level.

**Takeaway:** No relevant text differentiation patterns.

### Survey Summary

| Project | Technique | Applicable to chat? |
|---|---|---|
| EvenTwitchChat | Text prefix (`user: msg` or `> msg`) | Yes -- current approach |
| Itsyhome | Multi-container spatial separation | No -- chat is interleaved |
| ePub Reader | Border toggle, Unicode line-drawing | Partially -- border for container, Unicode for markers |
| Flashcards | Screen-level rebuild | No -- too expensive for per-message |

**Conclusion:** No sample project has solved interleaved text differentiation within a single container. All use either prefix-based or container-based separation. Our approach must innovate within the text-prefix paradigm.

---

## 3. Feasible Approaches

### (a) Unicode Text-Level Dimming

**Idea:** Use lighter Unicode characters (small caps, subscript, mathematical italic) to make user text visually lighter/thinner.

| Pros | Cons |
|---|---|
| Would create genuine visual weight difference | G2 firmware font does NOT include mathematical italic (U+1D400+) |
| No layout changes needed | Subscript/superscript chars likely absent or tiny |
| Per-character granularity | Characters outside the font are silently skipped -- user text would disappear |

**Verdict: NOT FEASIBLE.** The firmware font only covers ASCII, Latin-1, and select Unicode blocks. Mathematical/styled variants are entirely absent. Using them would cause user text to vanish.

### (b) Indentation/Wrapping

**Idea:** Indent user messages with leading spaces or wrap in brackets/parentheses.

| Pros | Cons |
|---|---|
| Simple to implement (string prefix) | Wastes horizontal space (576px is already narrow, ~28-32 chars/line) |
| Clearly groups user text | Brackets add 2 chars per message for no visual benefit |
| Works with any font | Indented text wraps earlier, wasting more space |

**Implementation:**
```typescript
// 2-space indent:
const prefix = m.role === 'user' ? '  ' : '';
// Or bracketed:
const text = m.role === 'user' ? `(${m.text})` : m.text;
```

**Verdict: MARGINALLY FEASIBLE.** Works but wastes scarce horizontal space. The visual effect is subtle on the narrow G2 display. Better combined with other approaches.

### (c) Prefix Enhancement

**Idea:** Replace the current `> ` with a stronger Unicode visual marker like block elements or box-drawing characters.

| Pros | Cons |
|---|---|
| Minimal space cost (1-2 chars) | Relies on firmware font rendering the glyph |
| Creates strong visual sidebar effect | Some block elements are wider than regular text |
| All tested block elements are in the confirmed font | Only differentiates the line start, not the whole line |

**Candidate markers:**

| Marker | Code | Visual effect | Width cost |
|---|---|---|---|
| `▎ ` | U+258E + space | Thin sidebar (quarter block) | ~2 chars |
| `▏ ` | U+258F + space | Very thin sidebar (eighth block) | ~2 chars |
| `▌ ` | U+258C + space | Bold sidebar (half block) | ~2 chars |
| `│ ` | U+2502 + space | Clean line sidebar | ~2 chars |
| `┃ ` | U+2503 + space | Heavy line sidebar | ~2 chars |

**Verdict: HIGHLY FEASIBLE.** The `▎` (left quarter block) creates a distinctive visual sidebar that makes user messages feel "quoted" or secondary. Confirmed in firmware font. Minimal space cost.

### (d) Truncation/Abbreviation

**Idea:** Show user messages as abbreviated single-line summaries since the user already knows what they said.

| Pros | Cons |
|---|---|
| Dramatically reduces user message visual weight | User loses full message context |
| More viewport space for assistant responses | May confuse users who want to re-read their question |
| Natural visual hierarchy (short = secondary) | Truncation logic adds complexity |

**Implementation:**
```typescript
const MAX_USER_DISPLAY = 40;
const displayText = m.role === 'user' && m.text.length > MAX_USER_DISPLAY
  ? m.text.slice(0, MAX_USER_DISPLAY) + '...'
  : m.text;
```

**Verdict: FEASIBLE.** Especially effective on the tiny G2 display where viewport space is precious (200 chars effective limit). Combines well with prefix enhancement.

### (e) Dual-Container Layout

**Idea:** Use two separate text containers with different border styles: one for user messages (bordered = "dimmed" look), one for assistant.

| Pros | Cons |
|---|---|
| Container-level visual differentiation (border) | Only 2 container slots remaining (status uses 1, chat uses 1) |
| Different borderColor creates brightness distinction | Requires dynamic container height calculation per message |
| Closest to a true "dim" effect | `rebuildPageContainer` on every message = flickering |
| | Cannot interleave -- would need fixed user/assistant zones |
| | Breaks the scrolling conversation model |

**Verdict: NOT PRACTICAL.** The interleaved nature of chat messages makes dual-container layouts impractical. Fixed zones (top=assistant, bottom=user) would break conversational flow. Frequent rebuilds cause visual flicker.

### (f) Image Overlay

**Idea:** Render a grey overlay image on top of user text area.

| Pros | Cons |
|---|---|
| Would create a true "dimming" effect | Image containers are opaque (no transparency) |
| Visual distinctiveness | Image max size is 200x100px (chat container is 576x256) |
| | Cannot overlay text -- would obscure it completely |
| | No alpha channel in 4-bit greyscale |

**Verdict: NOT FEASIBLE.** Image containers have no transparency and would completely obscure text. Size limits (200x100) are too small for overlay. This approach is fundamentally incompatible with the G2 display architecture.

### (g) Line-Level Visual Markers

**Idea:** Use Unicode block elements to create a visual "sidebar" column effect alongside user text (e.g., `▒` or `▎` at the start of every wrapped line).

| Pros | Cons |
|---|---|
| Creates a visible sidebar effect across multiple lines | Only works for the first character of each line |
| Uses confirmed-available glyphs | Cannot control line wrapping (firmware wraps automatically) |
| Stronger visual signal than single prefix | Multi-line messages would only show marker on first line |

**The wrapping problem:** The firmware wraps text automatically at the container width. We cannot predict where lines will break, so we cannot prepend a sidebar character to each wrapped line. Only the first line of a user message would get the marker.

**Verdict: PARTIALLY FEASIBLE.** Works as a first-line marker (same as approach c). True multi-line sidebar is impossible because we cannot control firmware line wrapping. Degrades to approach (c) in practice.

---

## 4. Ranked Recommendations

| Rank | Approach | Effort | Impact | Risk |
|---|---|---|---|---|
| 1 | **(c) Prefix enhancement** with `▎` | Trivial (1 line change) | High -- clear visual distinction | Low -- glyph confirmed in font |
| 2 | **(c+d) Prefix + truncation** | Low (5-10 lines) | Very high -- visual hierarchy + space savings | Low -- reversible if users dislike |
| 3 | **(b+c) Indent + prefix** | Low (2 lines) | Medium -- stronger grouping | Medium -- wastes horizontal space |
| 4 | **(d) Truncation only** | Low | Medium -- saves space but less visual | Low |
| 5 | **(e) Dual container** | High | Medium | High -- flicker, layout complexity |
| 6 | **(a) Unicode dimming** | N/A | N/A | Fatal -- glyphs not in firmware font |
| 7 | **(f) Image overlay** | N/A | N/A | Fatal -- no transparency |

### Recommended Implementation (Rank 1: Prefix Enhancement)

**File:** `src/display/viewport.ts`, function `serializeMessages()`

**Current code (line 67):**
```typescript
const prefix = m.role === 'user' ? '> ' : '';
```

**Proposed change:**
```typescript
const prefix = m.role === 'user' ? '\u258E ' : '';  // ▎ (left quarter block)
```

**Also update in `renderViewport()` (line 96):**
```typescript
const prefix = m.role === 'user' ? '\u258E ' : '';
```

**Testing:** Must verify on real G2 hardware or Even Hub Simulator that `▎` renders correctly and has appropriate visual weight. The character should appear as a thin vertical bar approximately 1/4 the width of a full block character.

### Optional Enhancement (Rank 2: Add Truncation)

If viewport space is at a premium (which it is with `MAX_VISIBLE_CHARS = 200`), truncating user messages saves significant space:

```typescript
const MAX_USER_DISPLAY = 40; // ~1 line on G2 display

export function serializeMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) return '';

  return messages
    .map((m) => {
      const prefix = m.role === 'user' ? '\u258E ' : '';
      const suffix = m.complete ? '' : ' ...';
      const displayText = m.role === 'user' && m.text.length > MAX_USER_DISPLAY
        ? m.text.slice(0, MAX_USER_DISPLAY) + '...'
        : m.text;
      return `${prefix}${displayText}${suffix}`;
    })
    .join(`\n${MSG_SEPARATOR}\n`);
}
```

This is a separate quick task -- the prefix change can land independently.

---

## 5. Hardware Constraints Summary

| Constraint | Impact on differentiation |
|---|---|
| Green micro-LED, 4-bit greyscale | No color-based differentiation possible |
| Single firmware font, no size/weight | Cannot make user text lighter/smaller |
| No background fill on containers | Cannot grey-out user message areas |
| No per-character color/brightness | Cannot dim individual characters |
| Automatic line wrapping at container width | Cannot create multi-line sidebars |
| Max 4 containers, 2 already used | Limited container-level options |
| 576px width, ~28-32 chars/line | Horizontal space is scarce |
| 200 effective char budget (fit-to-screen) | Every character counts |

The G2 display is fundamentally a monochrome, single-font, plain-text terminal. All visual differentiation must be achieved through character choice and text layout.
