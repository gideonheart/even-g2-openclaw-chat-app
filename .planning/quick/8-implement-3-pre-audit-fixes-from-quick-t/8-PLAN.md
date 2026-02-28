---
phase: quick-8
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/sync/sync-monitor.ts
  - src/sync/sync-types.ts
  - src/glasses-main.ts
  - src/hub-main.ts
  - src/__tests__/sync-monitor.test.ts
  - src/__tests__/drift-reconciler.test.ts
autonomous: true
requirements: [QUICK-8]
must_haves:
  truths:
    - "Heartbeat setInterval callback handles IDB/read failures without unhandled promise rejection"
    - "driftReconciler.handleHeartbeat() call sites in glasses-main and hub-main handle promise rejections"
    - "SyncMonitor.send() is removed from interface and implementation since only heartbeats use seq tracking"
    - "sequenceGaps renamed to heartbeatGaps to clarify scope"
    - "Tests cover IDB rejection paths for both sync-monitor and drift-reconciler"
  artifacts:
    - path: "src/sync/sync-monitor.ts"
      provides: "Heartbeat try/catch, send() removed, heartbeatGaps rename"
    - path: "src/sync/sync-types.ts"
      provides: "SyncMonitor interface without send(), SyncMonitorStats with heartbeatGaps"
    - path: "src/glasses-main.ts"
      provides: ".catch() on handleHeartbeat call"
    - path: "src/hub-main.ts"
      provides: ".catch() on handleHeartbeat call"
    - path: "src/__tests__/sync-monitor.test.ts"
      provides: "IDB rejection test for heartbeat, startHeartbeat duplicate guard test"
    - path: "src/__tests__/drift-reconciler.test.ts"
      provides: "IDB rejection test for handleHeartbeat"
  key_links:
    - from: "src/sync/sync-monitor.ts"
      to: "store.countMessages"
      via: "try/catch in heartbeat callback"
      pattern: "try.*countMessages.*catch"
    - from: "src/glasses-main.ts"
      to: "driftReconciler.handleHeartbeat"
      via: ".catch() on fire-and-forget call"
      pattern: "handleHeartbeat.*\\.catch"
    - from: "src/hub-main.ts"
      to: "driftReconciler.handleHeartbeat"
      via: ".catch() on fire-and-forget call"
      pattern: "handleHeartbeat.*\\.catch"
---

<objective>
Implement the 3 required pre-audit fixes identified in Quick Task 7 (Phase 16 code review):

1. Add try/catch in heartbeat setInterval callback for IDB/read failures
2. Add .catch() to all driftReconciler.handleHeartbeat() call sites
3. Remove orphaned SyncMonitor.send() and rename sequenceGaps to heartbeatGaps to clarify scope

These fixes address P1 (unhandled promise rejection in degraded IDB scenarios) and P2 (misleading interface) issues that would block a milestone audit.

Purpose: Eliminate unhandled promise rejections in the exact degraded-IDB scenarios that sync hardening exists to handle, and clarify the sequence-tracking scope.
Output: Fixed source files with new test coverage for IDB rejection paths.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/7-review-phase-16-commits-for-strengths-we/7-REVIEW.md
@src/sync/sync-monitor.ts
@src/sync/sync-types.ts
@src/sync/drift-reconciler.ts
@src/glasses-main.ts
@src/hub-main.ts
@src/__tests__/sync-monitor.test.ts
@src/__tests__/drift-reconciler.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix unhandled rejections and remove orphaned send()</name>
  <files>
    src/sync/sync-monitor.ts
    src/sync/sync-types.ts
    src/glasses-main.ts
    src/hub-main.ts
  </files>
  <action>
**Fix 1 -- Heartbeat try/catch (P1):**
In `src/sync/sync-monitor.ts`, wrap the entire async body of the `setInterval` callback (lines 65-76) in a try/catch. On catch, silently skip the heartbeat (the next interval will retry). The catch block should be empty with a comment: `// IDB error -- skip this heartbeat, next interval will retry`. This matches the pattern already used elsewhere in the codebase (e.g., `catch { /* localStorage unavailable */ }` in glasses-main.ts).

**Fix 2 -- .catch() on handleHeartbeat call sites (P3):**
In `src/glasses-main.ts` line 179, change:
```
driftReconciler.handleHeartbeat(conversationId, remoteCount);
```
to:
```
driftReconciler.handleHeartbeat(conversationId, remoteCount).catch(() => {});
```

In `src/hub-main.ts` line 1076, make the same change:
```
driftReconciler.handleHeartbeat(conversationId, remoteCount).catch(() => {});
```

**Fix 3 -- Remove orphaned send() and clarify scope (P2):**

In `src/sync/sync-monitor.ts`:
- Remove the `send()` function entirely (lines 28-31) and its comment (lines 26-27).
- Rename the internal `localSeq` variable to `heartbeatSeq` (only heartbeats use it now).
- Rename the `sequenceGaps` variable to `heartbeatGaps`.
- Update `getStats()` to return `heartbeatGaps` instead of `sequenceGaps` (and `heartbeatSeq` instead of `localSeq`).
- The internal heartbeat send logic (currently at line 70-75) should increment `heartbeatSeq` and stamp `seq: heartbeatSeq` directly on the `bridge.postMessage()` call (since `send()` is removed). I.e.:
  ```typescript
  heartbeatSeq += 1;
  bridge.postMessage({
    type: 'sync:heartbeat',
    origin,
    messageCount,
    conversationId,
    seq: heartbeatSeq,
  });
  ```
- Remove `send` from the returned object.

In `src/sync/sync-types.ts`:
- Remove `send(msg: SyncMessage): void;` from the `SyncMonitor` interface.
- In `SyncMonitorStats`, rename `localSeq` to `heartbeatSeq` and `sequenceGaps` to `heartbeatGaps`.

No changes needed to glasses-main.ts or hub-main.ts for fix 3 because neither file calls `syncMonitor.send()` (that was the entire point of the review finding -- it was orphaned).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx tsc --noEmit && npm test 2>&1 | tail -20</automated>
    <manual>Verify sync-monitor.ts no longer exports send(), heartbeatGaps replaces sequenceGaps</manual>
  </verify>
  <done>
    - sync-monitor.ts heartbeat callback wrapped in try/catch
    - glasses-main.ts and hub-main.ts handleHeartbeat calls have .catch()
    - send() removed from SyncMonitor interface and implementation
    - localSeq renamed to heartbeatSeq, sequenceGaps renamed to heartbeatGaps
    - TypeScript compiles cleanly, existing tests still pass (some will need updating in Task 2)
  </done>
</task>

<task type="auto">
  <name>Task 2: Add IDB rejection test coverage</name>
  <files>
    src/__tests__/sync-monitor.test.ts
    src/__tests__/drift-reconciler.test.ts
  </files>
  <action>
**Update existing tests for rename:**
In `src/__tests__/sync-monitor.test.ts`:
- Update the `send()` test (lines 45-64): Remove this test entirely since `send()` no longer exists on the interface.
- Update any `getStats()` assertions to use `heartbeatSeq` instead of `localSeq` and `heartbeatGaps` instead of `sequenceGaps`. This affects:
  - Line 81: `getStats().lastRemoteSeq` (unchanged -- this field was not renamed)
  - Line 107: `getStats().sequenceGaps` -> `getStats().heartbeatGaps`
  - Line 134-135: `getStats().sequenceGaps` -> `getStats().heartbeatGaps`, `getStats().lastRemoteSeq` (unchanged)
  - Line 154: `getStats().lastRemoteSeq` (unchanged)
- In the "heartbeat message includes seq" test (lines 226-250), the heartbeat should still include `seq: 1`. This test remains valid but now tests the inline seq stamping rather than `send()`.

**Add new test: heartbeat skips on IDB error (sync-monitor):**
```typescript
it('heartbeat skips when countMessages rejects (IDB error)', async () => {
  vi.useFakeTimers();
  store.countMessages.mockRejectedValue(new Error('IDB read failed'));

  const monitor = createSyncMonitor({
    bridge,
    store,
    origin,
    getActiveConversationId: () => 'conv-1',
  });

  monitor.startHeartbeat();

  // Should not throw -- the rejection is caught internally
  await vi.advanceTimersByTimeAsync(10_000);

  // No heartbeat sent because countMessages failed
  expect(bridge.postMessage).not.toHaveBeenCalled();

  monitor.destroy();
  vi.useRealTimers();
});
```

**Add new test: startHeartbeat called twice does not create duplicate interval:**
```typescript
it('startHeartbeat called twice does not create duplicate interval', async () => {
  vi.useFakeTimers();
  store = createMockStore(5);

  const monitor = createSyncMonitor({
    bridge,
    store,
    origin,
    getActiveConversationId: () => 'conv-1',
  });

  monitor.startHeartbeat();
  monitor.startHeartbeat(); // second call should be no-op

  await vi.advanceTimersByTimeAsync(10_000);

  // Only one heartbeat, not two (no duplicate interval)
  expect(bridge.postMessage).toHaveBeenCalledTimes(1);

  monitor.destroy();
  vi.useRealTimers();
});
```

**Add new test: messages without seq do not corrupt tracking:**
```typescript
it('incoming messages without seq field do not affect gap tracking', () => {
  const monitor = createSyncMonitor({
    bridge,
    store,
    origin,
    getActiveConversationId: () => 'conv-1',
  });

  // Message without seq field
  simulateIncoming(bridge, {
    type: 'message:added',
    origin: remoteOrigin,
    conversationId: 'conv-1',
    role: 'user',
    text: 'hello',
  });

  expect(monitor.getStats().lastRemoteSeq).toBe(-1);
  expect(monitor.getStats().heartbeatGaps).toBe(0);

  monitor.destroy();
});
```

**Add new test in drift-reconciler: handleHeartbeat resolves false on IDB error:**
```typescript
it('handleHeartbeat resolves false when countMessages rejects', async () => {
  store.countMessages.mockRejectedValue(new Error('IDB read failed'));
  const onDriftDetected = vi.fn();
  const onReconciled = vi.fn();

  const reconciler = createDriftReconciler({ store, onDriftDetected, onReconciled });

  // handleHeartbeat should propagate the rejection (callers add .catch())
  await expect(reconciler.handleHeartbeat('conv-1', 5)).rejects.toThrow('IDB read failed');

  // Callbacks should NOT have been called
  expect(onDriftDetected).not.toHaveBeenCalled();
  expect(onReconciled).not.toHaveBeenCalled();

  reconciler.destroy();
});
```

Note: DriftReconciler's `handleHeartbeat` does NOT internally catch IDB errors -- it lets them propagate. The callers (glasses-main and hub-main) handle them with `.catch()`. This is the correct layering: the reconciler reports what happened, the boot files decide how to handle errors.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm test 2>&1 | tail -30</automated>
    <manual>Verify all new tests pass and total test count increased by 4-5</manual>
  </verify>
  <done>
    - send() test removed from sync-monitor tests
    - All getStats() assertions updated for heartbeatSeq/heartbeatGaps renames
    - New test: heartbeat skips on IDB error (sync-monitor) -- passes
    - New test: startHeartbeat duplicate guard (sync-monitor) -- passes
    - New test: messages without seq do not corrupt tracking (sync-monitor) -- passes
    - New test: handleHeartbeat rejects on IDB error (drift-reconciler) -- passes
    - Full test suite passes: `npm test` exits 0
    - TypeScript compiles cleanly: `npx tsc --noEmit` exits 0
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` -- TypeScript compiles with no errors
2. `npm test` -- All tests pass (existing + 4 new)
3. `grep -n 'send' src/sync/sync-types.ts` -- no `send` method in SyncMonitor interface
4. `grep -n 'heartbeatGaps' src/sync/sync-monitor.ts` -- renamed from sequenceGaps
5. `grep -n '\.catch' src/glasses-main.ts src/hub-main.ts` -- .catch() on handleHeartbeat calls
6. `grep -n 'try' src/sync/sync-monitor.ts` -- try/catch in heartbeat callback
</verification>

<success_criteria>
- Zero unhandled promise rejections when store.countMessages() fails during heartbeat
- Zero unhandled promise rejections when handleHeartbeat() fails at call sites
- SyncMonitor interface no longer exposes misleading send() method
- Stats field names (heartbeatSeq, heartbeatGaps) accurately describe their scope
- 4 new tests covering IDB rejection paths, duplicate guard, and seq-less messages
- Full test suite green, TypeScript clean
</success_criteria>

<output>
After completion, create `.planning/quick/8-implement-3-pre-audit-fixes-from-quick-t/8-SUMMARY.md`
</output>
