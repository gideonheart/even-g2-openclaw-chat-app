---
phase: quick-4
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/persistence/boot-restore.ts
  - src/persistence/session-store.ts
  - src/sync/sync-bridge.ts
  - src/types.ts
  - src/hub-main.ts
  - src/glasses-main.ts
autonomous: true
requirements: [FIX-DEDUP, FIX-CLEANUP, FIX-UNUSED, FIX-DEAD, FIX-ASYNC]

must_haves:
  truths:
    - "Active session localStorage key is defined in exactly one place"
    - "SyncBridge is properly destroyed on hub-main teardown"
    - "createSyncBridge has no unused parameters"
    - "No dead Session interface exists in types.ts"
    - "Async sync message handlers in glasses-main do not produce unhandled rejections"
  artifacts:
    - path: "src/persistence/boot-restore.ts"
      provides: "Single source-of-truth constant for active session localStorage key"
      contains: "ACTIVE_CONVERSATION_KEY"
    - path: "src/persistence/session-store.ts"
      provides: "Session store importing shared key constant"
      contains: "import.*ACTIVE_CONVERSATION_KEY.*boot-restore"
    - path: "src/sync/sync-bridge.ts"
      provides: "Clean createSyncBridge signature with no unused params"
      exports: ["createSyncBridge"]
    - path: "src/types.ts"
      provides: "Core types without dead Session interface"
    - path: "src/hub-main.ts"
      provides: "Hub main with syncBridge cleanup path"
    - path: "src/glasses-main.ts"
      provides: "Glasses main with error-safe async sync handlers"
  key_links:
    - from: "src/persistence/session-store.ts"
      to: "src/persistence/boot-restore.ts"
      via: "import of ACTIVE_CONVERSATION_KEY"
      pattern: "import.*ACTIVE_CONVERSATION_KEY.*boot-restore"
---

<objective>
Apply 5 focused pre-close fixes identified during review: deduplicate localStorage key constant, add hub syncBridge cleanup, remove unused createSyncBridge parameter, remove dead Session interface, and add async error handling for sync message handlers.

Purpose: Clean up code hygiene issues before closing Phase 10 -- all are low-risk, high-confidence fixes.
Output: Cleaner codebase with no duplicate constants, proper cleanup paths, no dead code, and no unhandled rejection risk.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/persistence/boot-restore.ts
@src/persistence/session-store.ts
@src/sync/sync-bridge.ts
@src/types.ts
@src/hub-main.ts
@src/glasses-main.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Deduplicate localStorage key and remove dead code</name>
  <files>
    src/persistence/boot-restore.ts
    src/persistence/session-store.ts
    src/sync/sync-bridge.ts
    src/types.ts
  </files>
  <action>
    Three independent cleanup fixes in one pass:

    1. **Deduplicate active session localStorage key:**
       - `boot-restore.ts` already exports `ACTIVE_CONVERSATION_KEY = 'openclaw-active-conversation'` (line 8).
       - `session-store.ts` has its own `const ACTIVE_SESSION_KEY = 'openclaw-active-conversation'` (line 8) -- a duplicate.
       - In `session-store.ts`: remove the local `ACTIVE_SESSION_KEY` constant. Add `import { ACTIVE_CONVERSATION_KEY } from './boot-restore';` to the imports. Replace both usages of `ACTIVE_SESSION_KEY` on lines 57 and 61 with `ACTIVE_CONVERSATION_KEY`.

    2. **Remove unused `_origin` parameter from `createSyncBridge`:**
       - In `sync-bridge.ts` line 87: change `export function createSyncBridge(_origin?: SyncOrigin): SyncBridge` to `export function createSyncBridge(): SyncBridge`.
       - Remove the `SyncOrigin` import if it is no longer used after removing the parameter. Check: `SyncOrigin` is imported on line 7 alongside `SyncBridge` and `SyncMessage`. After removing `_origin`, `SyncOrigin` is no longer used in this file -- remove it from the import.
       - No callers pass the argument (glasses-main.ts:48 and hub-main.ts:548 both call `createSyncBridge()` with no args), so no caller changes needed.
       - Also update the test file `src/__tests__/sync-bridge.test.ts`: all calls like `createSyncBridge('glasses')` and `createSyncBridge('hub')` should become `createSyncBridge()` since the parameter is removed. The origin string was never used by the bridge itself -- it was only in the SyncMessage payloads set by the SessionManager.

    3. **Remove dead `Session` interface from `types.ts`:**
       - Delete lines 18-22 (the `Session` interface with id, name, desc fields). This type is not imported anywhere -- `ConversationRecord` from `persistence/types.ts` replaced it. No other changes needed.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx tsc --noEmit && npx vitest run 2>&1 | tail -5</automated>
    <manual>Grep for ACTIVE_SESSION_KEY to confirm it no longer exists. Grep for "interface Session" in types.ts to confirm removal.</manual>
  </verify>
  <done>
    - ACTIVE_CONVERSATION_KEY defined only in boot-restore.ts, imported by session-store.ts
    - createSyncBridge() has no parameters, SyncOrigin not imported in sync-bridge.ts
    - Session interface no longer exists in types.ts
    - All tests pass, TypeScript compiles cleanly
  </done>
</task>

<task type="auto">
  <name>Task 2: Add hub syncBridge cleanup and async error guards</name>
  <files>
    src/hub-main.ts
    src/glasses-main.ts
  </files>
  <action>
    Two related fixes for proper resource management:

    1. **Add syncBridge cleanup path in hub-main.ts:**
       - The `initPersistence()` function (line 537) creates a `syncBridge` via `createSyncBridge()` (line 548) but never exposes it for cleanup. Unlike glasses-main which calls `syncBridge.destroy()` in its cleanup function, the hub has no teardown path.
       - Modify `initPersistence()` to also return `syncBridge` in its return object: change the return type to include `syncBridge: SyncBridge` and add it to the returned object on line 570.
       - Add `import type { SyncBridge } from './sync/sync-types';` to imports (if not already present).
       - In `initHub()` (line 523), capture the syncBridge from the persistence result. Store it at module scope (e.g., `let hubSyncBridge: SyncBridge | null = null;`) alongside the existing `sessionManager` variable (line 34).
       - Register a `beforeunload` listener in `initHub()` that calls `hubSyncBridge?.destroy()` to clean up on tab close. Use `window.addEventListener('beforeunload', () => { hubSyncBridge?.destroy(); })`.

    2. **Add async error handling for sync message handlers in glasses-main.ts:**
       - In `glasses-main.ts` lines 142-168, the `syncBridge.onMessage` callback has two cases that call async functions without `.catch()`:
         - Line 148: `switchToSession(msg.sessionId)` -- this is async (returns Promise) but is called without await or catch in the sync callback.
         - Lines 154-159: `sessionStore.listSessions().then(...)` -- has a `.then()` but no `.catch()`.
       - Fix line 148: wrap in `switchToSession(msg.sessionId).catch(() => { /* sync switch failed -- glasses will retry on next message */ });`
       - Fix line 154: add `.catch(() => { /* session list unavailable */ })` to the `sessionStore.listSessions().then(...)` chain.
       - These are fire-and-forget handlers in a message listener, so logging is optional but the `.catch()` is mandatory to prevent unhandled rejections.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx tsc --noEmit && npx vitest run 2>&1 | tail -5</automated>
    <manual>Verify hub-main.ts returns syncBridge from initPersistence and destroys it on beforeunload. Verify glasses-main.ts sync handlers have .catch() guards.</manual>
  </verify>
  <done>
    - hub-main.ts has a syncBridge cleanup path via beforeunload listener
    - glasses-main.ts async sync handlers (switchToSession, listSessions) have .catch() guards
    - All tests pass, TypeScript compiles cleanly
    - No unhandled rejection risk from sync message handlers
  </done>
</task>

</tasks>

<verification>
After both tasks, run the full verification suite:

```bash
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app
npx tsc --noEmit          # TypeScript compiles cleanly
npx vitest run            # All 325+ tests pass
```

Confirm no regressions:
- grep -r 'ACTIVE_SESSION_KEY' src/ returns zero results
- grep 'interface Session' src/types.ts returns zero results
- grep '_origin' src/sync/sync-bridge.ts returns zero results
- grep 'syncBridge.destroy' src/hub-main.ts returns one result
- grep '\.catch' src/glasses-main.ts shows catch guards on sync handlers
</verification>

<success_criteria>
- localStorage key constant exists in exactly one file (boot-restore.ts), imported by session-store.ts
- createSyncBridge() takes zero parameters
- Dead Session interface removed from types.ts
- Hub syncBridge properly destroyed on page unload
- Async sync handlers in glasses-main have .catch() guards
- TypeScript compiles cleanly (tsc --noEmit)
- All existing tests pass (vitest run)
</success_criteria>

<output>
After completion, create `.planning/quick/4-apply-4-priority-pre-close-fixes-dedupli/4-SUMMARY.md`
</output>
