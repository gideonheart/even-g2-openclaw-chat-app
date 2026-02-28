# Code Review: Commits 3b04197 and d632e34

**Scope:** TypeScript infrastructure, modular architecture, gateway API client, test suite (3b04197) and roadmap/state update (d632e34)
**Reviewed:** 2026-02-28
**Baseline:** 67 tests passing, `tsc --noEmit` clean, all 5 suites green

---

## 1. What Was Done Well

### 1.1 Module Decomposition from Monolithic Inline Script

The original 460-line inline `<script>` block was extracted into 6 typed modules (`src/main.ts`, `src/settings.ts`, `src/sessions.ts`, `src/logs.ts`, `src/utils.ts`, `src/api/gateway-client.ts`) plus a types file. Each module has a single clear responsibility. The dependency graph is shallow: `main.ts` imports from leaf modules, leaf modules never import each other (except `types.ts`). This makes testing each module in isolation straightforward.

**Files:** `src/settings.ts`, `src/sessions.ts`, `src/logs.ts`, `src/utils.ts`, `src/types.ts`, `src/api/gateway-client.ts`

### 1.2 TypeScript Strict Mode with Comprehensive Options

`tsconfig.json` enables `strict: true` plus additional safety flags: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`. The `target: ES2022` with `moduleResolution: bundler` is the correct choice for a Vite project. `tsc --noEmit` passes cleanly with zero warnings.

**File:** `tsconfig.json:1-27`

### 1.3 Test Quality and Coverage Patterns

67 tests across 5 suites cover meaningful behavior, not just happy paths:
- **Settings tests** (`src/__tests__/settings.test.ts`): corrupt JSON recovery (line 61-65), partial settings merge with defaults (line 53-59), secret exclusion from export (line 84-97), import-merge semantics preserving unprovided keys (line 100-113).
- **Log store tests** (`src/__tests__/logs.test.ts`): ring buffer overflow eviction (line 61-77), sequential ID assignment with newest-first ordering (line 25-29), diagnostics log cap at 50 entries (line 145-156).
- **Gateway client tests** (`src/__tests__/gateway-client.test.ts`): SSE parser edge cases including multiline `data:` fields (line 44-49), trailing data without double newline (line 55-61), comment filtering (line 37-42).

The mock localStorage pattern in `settings.test.ts:16-26` is clean DI -- the `createMockStorage()` factory returns a proper `Storage` interface using a `Map`, avoiding `vi.fn()` sprawl.

### 1.4 Gateway Client Architecture

The `createGatewayClient` factory (`src/api/gateway-client.ts:79-298`) uses a closure-based module pattern that exposes only the public API surface (9 methods) while keeping `health`, `abortController`, `heartbeatTimer`, `eventHandlers`, `statusHandlers` as private state. This is idiomatic TypeScript for encapsulation without class overhead.

Key design decisions:
- SSE parsing via custom `parseSSELines()` instead of native `EventSource` (correct -- `EventSource` cannot set custom headers like `X-Session-Key`)
- `AbortController` integration for request cancellation (`src/api/gateway-client.ts:167-169`)
- Subscription returns unsubscribe functions (`onChunk`, `onStatusChange` at lines 101-109)

**File:** `src/api/gateway-client.ts:79-298`

### 1.5 Settings Architecture with Dependency Injection

`loadSettings()` and `saveSettings()` accept an optional `storage: Storage` parameter (defaulting to `localStorage`), enabling test isolation without mocking globals. The `FIELD_CONFIG` record (`src/settings.ts:14-52`) centralizes label, type, placeholder, help text, validation function, and secret flag per field -- making the settings form entirely data-driven.

Export excludes secrets by default via `delete` on a spread copy (`src/settings.ts:77-81`). Import merges selectively, preserving unmentioned keys (`src/settings.ts:84-99`).

**Files:** `src/settings.ts:56-74`, `src/settings.ts:14-52`

### 1.6 Data-Attribute Event Binding Pattern

All `onclick="functionName()"` handlers in `index.html` were replaced with `data-action="..."` and `data-setting="..."` attributes, with event listeners bound programmatically in `main.ts:init()` (lines 380-446). This eliminates global function pollution, enables TypeScript to type-check handler wiring, and follows the principle of separating behavior from markup.

**Files:** `index.html:189-191` (before/after diff shows `onclick="connectGlasses()"` -> `data-action="connect"`), `src/main.ts:380-446`

### 1.7 Log Store Ring Buffer Design

`createLogStore()` (`src/logs.ts:7-43`) implements a bounded log buffer with `MAX_LOGS=200`. Entries are stored newest-first via `unshift()`, with `pop()` eviction when at capacity. The `filter()` method returns copies (`[...logs]` or `.filter()`), preventing external mutation. The `buildDiagnostics()` function (`src/logs.ts:49-68`) caps at 50 entries and strips internal fields, making it safe for clipboard export.

**File:** `src/logs.ts:7-43`

---

## 2. What to Refactor

### 2.1 `src/main.ts` -- Monolithic 450-Line Init File

**Problem:** `main.ts` contains rendering logic (HTML string concatenation via `innerHTML`), state management (7 module-level mutable variables at lines 17-23), DOM manipulation, event wiring, and business logic all in one file. There is no separation between view rendering and state transitions.

**Specific issues:**
- `src/main.ts:29-31`: `$()` helper uses non-null assertion (`!`) on every call. If an element doesn't exist, this silently produces a runtime error with no diagnostic context.
- `src/main.ts:49-66` (`renderLogs`): Builds entire log list HTML via string concatenation on every render. With 200 log entries, this creates/destroys ~200 DOM nodes per log addition.
- `src/main.ts:122-149` (`openSettingsField`): HTML form generation via string concatenation with manual event binding after `innerHTML` assignment -- fragile pattern where DOM IDs must match between HTML strings and `$()` calls.
- `src/main.ts:188`: `(settings as unknown as Record<string, string>)[currentEditField] = value` -- double type assertion bypasses all TypeScript safety.

**Recommendation:** Extract into `src/views/` module per page (home, health, settings, features) with a minimal state machine or event dispatcher coordinating transitions. This directly unblocks Phase 2, which needs to add bridge connection UI, audio recording state, and gesture indicators.

### 2.2 `src/sessions.ts` -- Hardcoded Demo Data, No Dynamic Management

**Problem:** Sessions are a compile-time constant array (`src/sessions.ts:5-9`). There is no `addSession()`, `removeSession()`, `renameSession()`, or persistence. Phase 2 requires bridge-initiated sessions where the glasses SDK can trigger session creation.

**File:** `src/sessions.ts:5-9`

**Recommendation:** Convert `SESSIONS` to a mutable store (similar to `createLogStore` pattern) with add/remove/rename/persist operations. Keep the 3 demo sessions as initial seed data.

### 2.3 `src/settings.ts:88` -- `importSettingsJson` Accepts Invalid `sttProvider` Values

**Problem:** Line 94-95 casts imported `sttProvider` directly: `merged.sttProvider = imported.sttProvider as SttProvider`. This accepts any string (e.g., `"invalid"`, `""`, `"deepgram"`) without validating against the `SttProvider` union type. The `typeof imported !== 'object'` check on line 89 passes for arrays (`typeof [] === 'object'`), numbers wrapped by `JSON.parse` (e.g., `JSON.parse("42")` returns number, which fails the check -- but `JSON.parse("[1]")` returns an array, which passes).

**File:** `src/settings.ts:88-96`

**Recommendation:** Add an explicit allowlist check:
```typescript
const VALID_STT: Set<string> = new Set(['whisperx', 'openai', 'custom']);
if (imported.sttProvider !== undefined && !VALID_STT.has(imported.sttProvider)) {
  throw new Error(`Invalid sttProvider: ${imported.sttProvider}`);
}
```

### 2.4 `src/types.ts:52` -- `FieldConfig.validate` Returns Empty String for Success

**Problem:** `validate: (value: string) => string` uses an empty string `""` to indicate success and a non-empty string for the error message. This is stringly-typed -- callers must know the convention and check `if (error)` rather than having the type system enforce correctness.

**File:** `src/types.ts:52`

**Recommendation:** Change return type to `string | null` where `null` means valid. This is idiomatic for validation functions and makes the success case explicit:
```typescript
validate: (value: string) => string | null;
```
Then update all `FIELD_CONFIG` validators to return `null` instead of `''`, and update callers in `main.ts:182` from `if (error)` to `if (error !== null)`.

### 2.5 `src/api/gateway-client.ts:253-263` -- Reconnect Logic is a No-Op

**Problem:** The catch block at lines 253-263 increments `reconnectAttempts`, sets status to `connecting`, calculates an exponential backoff delay, and waits... but then does nothing. The comment on line 259 says "Caller should retry" but no caller in the codebase actually retries. The `sendVoiceTurn` function returns `Promise<void>` with no signal to the caller that a retry is needed.

```typescript
// Lines 253-263 in gateway-client.ts
if (health.reconnectAttempts < opts.maxReconnectAttempts) {
  health.reconnectAttempts++;
  setStatus('connecting');
  const delay = opts.reconnectBaseDelayMs * Math.pow(2, health.reconnectAttempts - 1);
  await new Promise((r) => setTimeout(r, delay));
  // Caller should retry -- we just set the state  <-- nobody does
} else {
  setStatus('error');
}
```

**Impact:** Phase 2 audio capture depends on reliable gateway connectivity. If a voice turn fails mid-stream (phone sleep, network blip), the user gets a silent failure with no retry.

**File:** `src/api/gateway-client.ts:253-263`

**Recommendation:** Either (a) implement actual retry inside `sendVoiceTurn` by recursively calling itself with the same arguments, or (b) emit a `retry_needed` chunk type so callers can re-invoke. Option (a) is simpler and self-contained.

### 2.6 `index.html` -- Inline CSS (~150 Lines) and External Dependency

**Problem:**
- `index.html:8-156`: ~150 lines of CSS in a `<style>` tag. This will grow significantly when Phase 2 adds bridge UI and Phase 3 adds glasses display styles.
- `index.html:7`: `<link rel="stylesheet" href="../even-g2-apps/src/style.css" />` references a file outside the repository via a relative path. This dependency is fragile -- it breaks if the repo is cloned to a different location or if `even-g2-apps` is not present as a sibling directory.

**File:** `index.html:7-156`

**Recommendation:** Extract inline CSS to `src/styles/app.css` imported by `main.ts`. For the external dependency, either (a) vendor the required CSS variables/tokens into the project, or (b) use an npm package/git submodule if `even-g2-apps` is a shared design system.

### 2.7 `src/logs.ts:19-20` -- O(n) Insertion at Capacity

**Problem:** `logs.unshift(entry)` is O(n) because it shifts all existing elements. When followed by `logs.pop()` at capacity, every insert at MAX_LOGS=200 is O(200). For a log store called on every user action this is negligible now, but Phase 2 will add high-frequency bridge events (gesture telemetry, audio level updates) that could call `add()` dozens of times per second.

**File:** `src/logs.ts:19-20`

**Recommendation:** Replace with a circular buffer using a write pointer:
```typescript
const buffer: (LogEntry | null)[] = new Array(MAX_LOGS).fill(null);
let head = 0;
function add(...) { buffer[head] = entry; head = (head + 1) % MAX_LOGS; }
```
This makes insertion O(1) regardless of capacity.

---

## 3. Edge Cases and Missing Coverage

### 3.1 No Tests for `src/main.ts` (450 Lines, Zero Coverage)

`main.ts` is the largest file in the codebase and has zero test coverage. It contains UI logic, state transitions, DOM manipulation, and event wiring. Any refactoring of `main.ts` (required for Phase 2) will have no safety net.

**File:** `src/main.ts` (entire file)

**Impact:** High -- Phase 2 will modify `main.ts` extensively to add bridge connection UI, audio recording controls, and gesture feedback indicators.

### 3.2 `sendVoiceTurn` Never Tested with Fetch Mock

The gateway client tests (`src/__tests__/gateway-client.test.ts:64-106`) only test client creation, subscription/unsubscription, and destroy lifecycle. The core method `sendVoiceTurn` -- which handles `fetch()`, `ReadableStream`, SSE parsing of the response body, error handling, and reconnection -- is completely untested.

**File:** `src/__tests__/gateway-client.test.ts`

**Reproduction scenario:** Call `sendVoiceTurn` with a mock `fetch` that returns a `ReadableStream` of SSE data. Verify that `onChunk` handlers receive the parsed chunks in order, that abort cancellation works, and that non-2xx responses emit error chunks.

### 3.3 No Test for Reconnection Behavior

The exponential backoff logic (`gateway-client.ts:254-258`) calculates delays but is never tested. There is no verification that:
- `reconnectAttempts` increments correctly
- The delay follows `baseDelay * 2^(attempt-1)`
- Status transitions to `error` after `maxReconnectAttempts` exhausted
- Status transitions to `connecting` during retry window

**File:** `src/api/gateway-client.ts:253-263`

### 3.4 `importSettingsJson` Accepts Non-Object JSON Types

```typescript
// settings.ts:88-91
const imported = JSON.parse(json) as Partial<AppSettings>;
if (typeof imported !== 'object' || imported === null) {
  throw new Error('Invalid format');
}
```

`JSON.parse("42")` returns `42` (typeof `number`), which correctly fails the check. But `JSON.parse("[1,2,3]")` returns an array (typeof `object`), which passes the check. The subsequent property access (`imported.gatewayUrl`) would be `undefined` on an array, so it harmlessly does nothing -- but it silently accepts invalid input instead of rejecting it.

Similarly, `JSON.parse("true")` returns boolean (typeof `boolean`) and is correctly rejected, but `JSON.parse('{"gatewayUrl": 42}')` passes and sets `gatewayUrl` to `42` (a number, not a string).

**File:** `src/settings.ts:88-91`

**Missing test case:** `importSettingsJson('[1,2,3]', DEFAULT_SETTINGS)` should throw but does not.

### 3.5 `parseSSELines` Handles `\n` But Not `\r\n`

The SSE parser splits on `\n` only (`src/api/gateway-client.ts:16`). HTTP responses frequently use `\r\n` line endings. The SSE specification (W3C) says parsers must handle `\r\n`, `\r`, and `\n`. Currently, a `\r\n`-delimited stream would produce data with trailing `\r` characters:

```
Input:  "data: hello\r\n\r\n"
Result: events[0].data === "hello\r"  // trailing \r
```

**File:** `src/api/gateway-client.ts:16`

**Fix:** Replace `raw.split('\n')` with `raw.split(/\r?\n/)` or `raw.replace(/\r\n/g, '\n').split('\n')`.

### 3.6 `exportSettingsJson` Uses `delete` on Spread Copy

```typescript
// settings.ts:77-81
const exported: Partial<AppSettings> = { ...settings };
delete exported.sessionKey;
delete exported.apiKey;
```

This works but is a mutation pattern on a copy. If a future developer removes the spread (`{ ...settings }`) thinking it is redundant, secrets would be deleted from the live settings object. A safer pattern:

```typescript
const { sessionKey, apiKey, ...exported } = settings;
```

**File:** `src/settings.ts:77-81`

### 3.7 No Global Error Handler

There is no `window.onerror` or `window.onunhandledrejection` handler. The gateway client's `sendVoiceTurn` contains multiple `await` calls that could reject. If a handler throws, the rejection is swallowed silently. Phase 2 will add more async operations (bridge connection, audio capture) that need centralized error handling.

**File:** `src/main.ts` (missing)

### 3.8 `console.warn` in Settings Load

`src/settings.ts:64`: `console.warn('Failed to load settings', e)` writes directly to the browser console instead of routing through the `logStore`. This means settings load failures are invisible in the app's Health > Logs view.

**File:** `src/settings.ts:64`

---

## 4. Technical Debt Before Phase 2

### Priority Summary Table

| Priority | Item | File(s) | Phase 2 Impact | Effort |
|----------|------|---------|-----------------|--------|
| **P1** | Gateway client reconnect is a no-op | `src/api/gateway-client.ts:253-263` | Blocks reliable voice turns -- audio capture will fail silently on network blips | 1-2h |
| **P1** | No event bus / pub-sub system | `src/main.ts` (missing) | Blocks typed event dispatching between bridge, gestures, audio, and UI modules | 2-3h |
| **P1** | `main.ts` has zero test coverage (450 lines) | `src/main.ts`, `src/__tests__/` | Any refactoring for Phase 2 UI changes has no safety net | 3-4h |
| **P2** | `main.ts` monolith (view+state+events) | `src/main.ts` | Adding bridge UI, recording state, gesture indicators into 450 lines becomes unmaintainable | 3-4h |
| **P2** | Hardcoded sessions -- no add/remove/persist | `src/sessions.ts:5-9` | Phase 2 needs dynamic session management for bridge-initiated sessions | 1-2h |
| **P2** | `sendVoiceTurn` has no test coverage | `src/__tests__/gateway-client.test.ts` | Core voice path is untested; Phase 2 builds directly on this | 2-3h |
| **P3** | SSE parser ignores `\r\n` line endings | `src/api/gateway-client.ts:16` | May cause corrupted transcripts from gateways that use Windows-style line endings | 30m |
| **P3** | `importSettingsJson` accepts arrays, doesn't validate `sttProvider` enum | `src/settings.ts:88-96` | Could cause runtime errors if user imports malformed JSON | 30m |
| **P3** | CSS inline in HTML (~150 lines) + external `../even-g2-apps/src/style.css` dependency | `index.html:7-156` | Phase 3 glasses display styles will make this unmanageable; external path is fragile | 1h |
| **P3** | `console.warn` in settings load bypasses log store | `src/settings.ts:64` | Settings load failures invisible in Health > Logs until bridge wiring exists | 15m |
| **P3** | `FieldConfig.validate` returns `""` for success (stringly-typed) | `src/types.ts:52` | Minor -- convention works but doesn't leverage type system | 30m |
| **P3** | Log store `unshift()`+`pop()` is O(n) at capacity | `src/logs.ts:19-20` | Becomes relevant with high-frequency bridge events in Phase 2 | 1h |
| **P3** | No global error handler (`onerror`/`onunhandledrejection`) | `src/main.ts` | Async failures from bridge/audio will be silently swallowed | 30m |

### Recommended Pre-Phase-2 Sprint

Before starting Phase 2 plans, address the **P1 items** (total ~6-9h):

1. **Implement actual reconnection in gateway client** -- make `sendVoiceTurn` retry on transient failures instead of just setting state
2. **Create a typed event bus** (`src/events.ts`) -- Phase 2's bridge, gesture FSM, and audio capture all need to communicate without direct imports
3. **Add basic `main.ts` tests** or extract testable logic from it -- at minimum, test the state transitions (connect/disconnect, session switch, settings save)

**P2 items** can be addressed during Phase 2 planning as part of the plan structure (e.g., "Plan 02-01: Event bus + main.ts decomposition").

**P3 items** are cleanup that can be deferred until Phase 3 or done opportunistically.

---

## 5. Commit d632e34 Assessment

The documentation update commit (`d632e34`) correctly:
- Marks Phases 1, 4, 5 as complete in ROADMAP.md
- Updates STATE.md position to "Phase 2 of 6"
- Sets status to "Ready to plan"
- Records accurate performance metrics (3 plans, ~1.5h total)

No issues found. The roadmap and state accurately reflect the codebase state confirmed by this review.
