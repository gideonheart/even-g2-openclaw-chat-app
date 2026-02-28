# Phase 16 Code Review: Sync Hardening

**Reviewer:** Claude (quick-7)
**Date:** 2026-02-28
**Scope:** All Phase 16 commits (sync-monitor, drift-reconciler, countMessages, boot wiring)
**Files reviewed:** 10 files, ~2,200 lines of Phase 16-relevant code

---

## Strengths

### 1. Disciplined TDD with meaningful RED/GREEN separation
SyncMonitor and DriftReconciler were developed test-first with separate RED and GREEN commits. The test suites are not afterthought -- they drive the design.
- **File:** `src/__tests__/sync-monitor.test.ts` (336 lines, 13 tests)
- **File:** `src/__tests__/drift-reconciler.test.ts` (146 lines, 7 tests)
- **Why it matters:** Every behavior has an explicit regression test. The 2-consecutive-mismatch rule, peer reboot handling, and heartbeat skipping are all verified scenarios, not just documented intentions.

### 2. Clean factory/closure API with zero `this` binding
Both `createSyncMonitor` and `createDriftReconciler` use the factory/closure pattern consistent with the entire codebase. No class inheritance, no `this` rebinding, no `new` keyword.
- **File:** `src/sync/sync-monitor.ts:11-108` -- factory returns a plain object
- **File:** `src/sync/drift-reconciler.ts:8-54` -- same pattern
- **Why it matters:** Eliminates an entire category of `this`-context bugs. The returned objects are safe to destructure, pass as callbacks, or store in variables without method binding.

### 3. Callback pattern for bus-agnostic portability
DriftReconciler takes `onDriftDetected` and `onReconciled` callbacks instead of depending on the event bus directly. This allows glasses (has bus) and hub (no bus, uses console) to wire different side effects.
- **File:** `src/sync/drift-reconciler.ts:10-11` -- callback declarations
- **File:** `src/glasses-main.ts:158-170` -- wired to `bus.emit('sync:drift-detected')`
- **File:** `src/hub-main.ts:1061-1067` -- wired to `console.warn` and `loadLiveConversation()`
- **Why it matters:** True separation of concerns. The module is testable with simple `vi.fn()` mocks and portable to any context.

### 4. O(1) countMessages via IDB index.count()
Rather than loading all messages and counting them (which would be O(n) with full deserialization), `countMessages` uses `IDBKeyRange.only()` with `index.count()`.
- **File:** `src/persistence/conversation-store.ts:252-260`
- **Why it matters:** Heartbeat fires every 10 seconds. If this were a cursor scan over hundreds of messages, it would add measurable latency to every heartbeat cycle. The O(1) approach means heartbeat cost is constant regardless of conversation size.

### 5. Correct teardown order in both contexts
SyncMonitor is destroyed before SyncBridge in both glasses and hub cleanup paths, preventing heartbeat messages from being sent on a closed channel.
- **File:** `src/glasses-main.ts:406-407` -- `syncMonitor?.destroy()` then `syncBridge.destroy()`
- **File:** `src/hub-main.ts:954-956` -- `hubSyncMonitor?.destroy()` then `hubSyncBridge?.destroy()`
- **Why it matters:** Incorrect teardown order would cause `postMessage` calls on a destroyed BroadcastChannel, which throws in some browsers.

### 6. Defensive isAlive() default
`isAlive()` returns `true` when no heartbeat has ever been received, which correctly handles the case where the peer has not started yet.
- **File:** `src/sync/sync-monitor.ts:103-106`
- **Why it matters:** Avoids false-negative liveness detection during cold boot when one context initializes before the other.

### 7. Sequence gap tracking with peer reboot recovery
The sequence tracking correctly handles peer reboots (seq goes lower) without incrementing the gap counter.
- **File:** `src/sync/sync-monitor.ts:42-51`
- **Why it matters:** Without this, every glasses-side restart would register false gaps, polluting metrics and potentially triggering future alerting thresholds.

### 8. Null guards on conditional wiring
Both glasses and hub guard SyncMonitor/DriftReconciler creation behind `store` availability checks, with optional chaining on all subsequent calls.
- **File:** `src/glasses-main.ts:157` -- `const driftReconciler = store ? createDriftReconciler(...) : null`
- **File:** `src/glasses-main.ts:172` -- `const syncMonitor = store ? createSyncMonitor(...) : null`
- **File:** `src/glasses-main.ts:249` -- `syncMonitor?.startHeartbeat()`
- **Why it matters:** When IDB is unavailable (in-memory fallback), sync hardening degrades gracefully rather than crashing.

### 9. Type safety through discriminated union
The `SyncMessage` type is a discriminated union on `type`, and `sync:heartbeat` was added cleanly as a new variant with the required `messageCount` and `conversationId` fields.
- **File:** `src/sync/sync-types.ts:6-15` -- all 9 variants with optional `seq` field
- **Why it matters:** TypeScript narrows the type on `msg.type` checks, preventing access to fields that do not exist on a given variant.

---

## Weaknesses

### 1. [P2] DriftReconciler fires onReconciled immediately after onDriftDetected without awaiting any reconciliation
**File:** `src/drift-reconciler.ts:34-42`
**Issue:** When `consecutiveMismatches >= 2`, the code calls `onDriftDetected(...)` and then immediately calls `onReconciled(...)` in sequence. The "reconciled" callback fires before any actual reconciliation (IDB re-read, re-render) has occurred. The name `onReconciled` implies the reconciliation is complete, but it is actually "please reconcile now."
**Severity:** P2 -- semantic confusion, not a runtime bug (callers ignore the callback's return)
**Fix suggestion:** Rename the callback to `onReconcile` or `onReconcileRequired` to match the imperative intent, or restructure so `onReconciled` is called by the consumer after completing the re-render. Estimated effort: trivial (rename).

### 2. [P2] Glasses sync:reconciled handler does renderer.destroy()+init() without checking streaming state
**File:** `src/glasses-main.ts:279-294`
**Issue:** The `bus.on('sync:reconciled', ...)` handler calls `renderer.destroy()` and `await renderer.init()`, then replays messages. If this fires during active streaming (an assistant response is being streamed), the destroy() call would drop the in-progress stream and the replayed messages would not include the incomplete response. The user would see the response disappear mid-sentence.
**Severity:** P2 -- the 2-consecutive-mismatch rule makes this unlikely during a single stream, but it is still a window where two fast heartbeats (20s apart) during a long response could trigger it.
**Fix suggestion:** Add a streaming-state guard: check if `displayController` is currently in streaming mode and defer reconciliation until `response_end`. Alternatively, skip reconciliation when the active conversation is the one being streamed. Estimated effort: small.

### 3. [P2] Hub onReconciled calls loadLiveConversation() which is a module-level function with implicit dependency
**File:** `src/hub-main.ts:1064-1067`
**Issue:** The `onReconciled` callback references `loadLiveConversation` which is a module-scoped function defined at line 581. This function depends on `sessionManager` and `hubConversationStore` being non-null (module-level variables). Because `onReconciled` is called from within `initPersistence()` where these variables have not yet been assigned to the module scope (they are assigned at line 922-923 after `initPersistence()` returns), `loadLiveConversation()` would see `null` for `sessionManager` and `hubConversationStore` and return early without doing anything.
**Severity:** P2 -- the heartbeat will not fire until after `initPersistence()` completes and `monitor.startHeartbeat()` runs, so the first possible reconciliation happens after the module variables are set. However, the ordering is fragile and relies on timing assumptions rather than explicit guarantees.
**Fix suggestion:** Either pass `conversationStore` and `mgr` (from `initPersistence` scope) directly to the callback closure, or document the timing dependency explicitly. Estimated effort: small.

### 4. [P2] SyncMonitor.send() is orphaned -- no caller uses it
**File:** `src/sync/sync-monitor.ts:28-31`
**Issue:** The `send()` method is exported on the SyncMonitor interface but never called by any consumer. In `glasses-main.ts`, sync messages are posted via `syncBridge.postMessage(...)` directly (e.g., line 360). In `hub-main.ts`, `hubSyncBridge.postMessage(...)` is called directly (e.g., line 900). This means no sync messages actually get sequence numbers stamped on them in production -- only heartbeats (sent internally by SyncMonitor) get seq numbers.
**Severity:** P2 -- the sequence tracking feature partially works (heartbeats get seq, application messages do not). Gap detection will only detect missed heartbeats, not missed application messages.
**Fix suggestion:** Either route all outgoing sync messages through `syncMonitor.send()` instead of `syncBridge.postMessage()`, or remove `send()` from the public interface if the intent is heartbeat-only seq tracking. Estimated effort: medium (requires auditing ~8 call sites in both boot files).

### 5. [P1] countMessages rejects on IDB error -- heartbeat callback will get unhandled rejection
**File:** `src/persistence/conversation-store.ts:258` -- `req.onerror = () => reject(req.error)`
**File:** `src/sync/sync-monitor.ts:69` -- `const messageCount = await store.countMessages(conversationId)`
**Issue:** If IDB encounters an error during `countMessages`, the promise rejects. The `setInterval` callback in `startHeartbeat` is `async` but has no try/catch around the `await store.countMessages(...)` call. The rejection becomes an unhandled promise rejection, and the heartbeat silently stops providing useful data (though the interval continues running).
**Severity:** P1 -- in degraded IDB scenarios (the exact scenarios sync hardening exists to handle), the heartbeat becomes unreliable.
**Fix suggestion:** Wrap the heartbeat body in try/catch and either skip the heartbeat on error or emit a log event. Estimated effort: trivial.

### 6. [P3] DriftReconciler.handleHeartbeat is called without awaiting the returned Promise
**File:** `src/glasses-main.ts:179` -- `driftReconciler.handleHeartbeat(conversationId, remoteCount);`
**File:** `src/hub-main.ts:1076` -- `driftReconciler.handleHeartbeat(conversationId, remoteCount);`
**Issue:** `handleHeartbeat` returns `Promise<boolean>` but both callers discard the return value without `await` or `.catch()`. If `store.countMessages` rejects inside `handleHeartbeat`, the rejection propagates as an unhandled promise rejection.
**Severity:** P3 -- same root cause as weakness #5 (countMessages can reject), but the handling point differs.
**Fix suggestion:** Add `.catch()` at the call sites, or make `handleHeartbeat` internally resilient to IDB errors. Estimated effort: trivial.

### 7. [P3] Test mocks do not simulate IDB rejection paths
**File:** `src/__tests__/sync-monitor.test.ts` -- all store mocks use `mockResolvedValue`
**File:** `src/__tests__/drift-reconciler.test.ts` -- same pattern
**Issue:** No test verifies behavior when `store.countMessages` rejects. Given weaknesses #5 and #6, this is a gap in test coverage for the exact failure mode sync hardening should handle gracefully.
**Severity:** P3 -- testing gap, not a runtime issue (yet).
**Fix suggestion:** Add test cases with `mockRejectedValue` to verify the monitor and reconciler handle IDB errors without crashing. Estimated effort: small.

### 8. [P3] Code duplication in glasses sync:reconciled handler vs switchToSession
**File:** `src/glasses-main.ts:257-276` (switchToSession message replay)
**File:** `src/glasses-main.ts:279-294` (sync:reconciled message replay)
**Issue:** Both blocks do `renderer.destroy()` -> `await renderer.init()` -> loop through `store.getMessages()` -> replay user/assistant messages. The only difference is that `switchToSession` also writes the active conversation ID and emits `session:switched`.
**Severity:** P3 -- maintainability concern. If the replay logic needs to change (e.g., to handle partial renders), it must be changed in two places.
**Fix suggestion:** Extract a `reloadConversation(conversationId)` helper and call it from both locations. Estimated effort: small.

---

## Unhandled Edge Cases

### 1. Rapid session switching during heartbeat interval
**Scenario:** User switches sessions 3 times within one 10s heartbeat interval. The heartbeat fires with the latest `activeConversationId`, but the previous DriftReconciler `lastMismatchConvId` may reference an old conversation, and the counter resets silently.
**Likelihood:** Medium (hub users can click session list rapidly)
**Impact:** Low -- the mismatch counter correctly resets on conversation change (`drift-reconciler.ts:27-30`), so no false positive. But any genuine drift from the abandoned session goes undetected.
**Affected file:** `src/sync/drift-reconciler.ts:27-30`

### 2. IDB error during countMessages in heartbeat callback
**Scenario:** IDB connection is unexpectedly closed (the exact failure case from Phase 14's `onclose` handling). The next heartbeat calls `store.countMessages()`, which opens a transaction on the closed database and rejects.
**Likelihood:** Low (but specifically the scenario sync hardening should withstand)
**Impact:** High -- unhandled promise rejection in the `setInterval` callback. The heartbeat continues firing every 10s but every invocation produces an unhandled rejection. No heartbeat messages are sent, so the peer loses liveness detection.
**Affected file:** `src/sync/sync-monitor.ts:65-76`

### 3. BroadcastChannel closure mid-heartbeat
**Scenario:** The BroadcastChannel is garbage collected or explicitly closed between the `store.countMessages()` await and the `bridge.postMessage()` call in the heartbeat.
**Likelihood:** Low (cleanup() clears the timer before destroying the bridge)
**Impact:** Medium -- `postMessage` on a closed BroadcastChannel throws `InvalidStateError` in Chrome. Without try/catch in the heartbeat, this becomes an unhandled exception.
**Affected file:** `src/sync/sync-monitor.ts:70-75`

### 4. Concurrent drift reconciliation from both contexts
**Scenario:** Both glasses and hub detect drift simultaneously (both receive each other's heartbeat showing mismatched counts). Both trigger `onReconciled`, both re-read from IDB, both re-render. This is safe but wasteful -- two IDB reads for the same data.
**Likelihood:** High (this is the normal flow -- both sides send heartbeats)
**Impact:** Low -- double re-render is visually imperceptible if the data is the same. No data corruption risk since both read from the same IDB.
**Affected file:** `src/sync/drift-reconciler.ts:34-42`

### 5. destroy() called during pending async handleHeartbeat
**Scenario:** `driftReconciler.destroy()` is called while `handleHeartbeat` is mid-await on `store.countMessages()`. The destroy resets `consecutiveMismatches` to 0, but the in-flight `handleHeartbeat` continues and may increment the counter or fire callbacks after destroy.
**Likelihood:** Medium (page unload during active heartbeat processing)
**Impact:** Low -- the callbacks would fire on already-destroyed UI. In glasses, `bus.emit` on a cleared bus is a no-op. In hub, `loadLiveConversation()` would execute against stale module variables but DOM may be gone.
**Affected file:** `src/sync/drift-reconciler.ts:48-51`

### 6. seq field optional -- existing postMessage callers send without seq
**Scenario:** All existing `syncBridge.postMessage()` calls in auto-save, session manager, etc., do not include a `seq` field. The SyncMonitor's incoming handler at `sync-monitor.ts:42` checks `if (msg.seq !== undefined)` and skips sequence tracking for these messages. This means sequence gap detection only applies to heartbeats and any future messages routed through `syncMonitor.send()`.
**Likelihood:** N/A (this is the current design state)
**Impact:** Medium -- sequence gap detection is less useful than it appears. A dropped `message:added` or `session:switched` message will not be detected by gap tracking.
**Affected file:** `src/sync/sync-monitor.ts:42-51`

### 7. Glasses sync:reconciled handler mutates renderer while menu is open
**Scenario:** The user has the command menu open (via gesture). A drift reconciliation fires and calls `renderer.destroy()` + `renderer.init()`. This may clear the menu overlay without notifying the menu controller, leaving the FSM in a `menu` state with no visible menu.
**Likelihood:** Low (menu is only open during user interaction, which is brief)
**Impact:** Medium -- FSM stuck in menu state, gestures misinterpreted until user double-taps again.
**Affected file:** `src/glasses-main.ts:279-294`

---

## Required Fixes (Before Milestone Audit)

### 1. Add try/catch in heartbeat interval callback
**Why it blocks audit:** An unhandled promise rejection in a setInterval callback is a correctness issue in the exact degraded-IDB scenario that sync hardening exists to handle. An auditor testing IDB failure modes will trigger this.
**File:** `src/sync/sync-monitor.ts:65-76`
**Fix:** Wrap the async body in try/catch, skip the heartbeat on error.
**Effort:** Trivial

```typescript
heartbeatTimer = setInterval(async () => {
  try {
    const conversationId = getActiveConversationId();
    if (!conversationId) return;
    const messageCount = await store.countMessages(conversationId);
    send({ type: 'sync:heartbeat', origin, messageCount, conversationId });
  } catch {
    // IDB error -- skip this heartbeat, next interval will retry
  }
}, HEARTBEAT_INTERVAL_MS);
```

### 2. Add .catch() to handleHeartbeat call sites
**Why it blocks audit:** Same unhandled rejection vector, different code path. Auditor will flag both.
**File:** `src/glasses-main.ts:179`, `src/hub-main.ts:1076`
**Fix:** Append `.catch(() => {})` or `.catch(console.error)` to the `handleHeartbeat` calls.
**Effort:** Trivial

### 3. Route outgoing sync messages through SyncMonitor.send() or document seq-tracking scope
**Why it blocks audit:** The SyncMonitor interface exposes `send()` and tracks sequence gaps, implying all messages are monitored. An auditor reviewing the interface will expect all messages to have seq numbers. If the intent is heartbeat-only monitoring, the `send()` method and gap tracking are misleading.
**File:** `src/sync/sync-monitor.ts:28-31`, `src/glasses-main.ts:359-365`, `src/hub-main.ts:899-906`
**Fix:** Either (a) route existing `syncBridge.postMessage` calls through `syncMonitor.send()`, or (b) remove `send()` from the interface and rename `sequenceGaps` to `heartbeatGaps` to clarify scope.
**Effort:** Medium (option a) or small (option b)

---

## Test Coverage Assessment

### Covered behaviors (good)
- Monotonic seq numbering on send()
- Remote seq tracking and gap detection
- Peer reboot handling (seq goes lower)
- Own-origin message filtering
- Heartbeat fires at 10s interval with correct payload
- Heartbeat skips when no active conversation
- Heartbeat includes seq number
- stopHeartbeat / destroy clears interval
- onHeartbeat callback forwarding
- isAlive() in three states (never received, within 30s, after 30s)
- DriftReconciler: no drift when counts match
- DriftReconciler: single mismatch does not trigger
- DriftReconciler: two consecutive mismatches trigger
- DriftReconciler: match resets counter
- DriftReconciler: different conversation resets counter
- DriftReconciler: works with zero callbacks
- DriftReconciler: destroy clears state

### Missing test coverage (should have before audit)

1. **SyncMonitor heartbeat when countMessages rejects** -- Verify that the heartbeat does not throw an unhandled rejection and either skips or logs. This is the highest-priority missing test.
   - **File:** `src/__tests__/sync-monitor.test.ts`

2. **DriftReconciler handleHeartbeat when countMessages rejects** -- Verify that `handleHeartbeat` resolves or rejects cleanly without corrupting internal state.
   - **File:** `src/__tests__/drift-reconciler.test.ts`

3. **SyncMonitor startHeartbeat called twice** -- Verify that calling `startHeartbeat()` a second time does not create a duplicate interval. The guard exists at `sync-monitor.ts:64` but has no test.
   - **File:** `src/__tests__/sync-monitor.test.ts`

4. **DriftReconciler handleHeartbeat during destroy** -- Verify behavior when `destroy()` is called while an async `handleHeartbeat` is in flight.
   - **File:** `src/__tests__/drift-reconciler.test.ts`

5. **SyncMonitor with messages lacking seq field** -- Verify that incoming messages without `seq` (from non-monitored callers) do not corrupt gap tracking.
   - **File:** `src/__tests__/sync-monitor.test.ts`
