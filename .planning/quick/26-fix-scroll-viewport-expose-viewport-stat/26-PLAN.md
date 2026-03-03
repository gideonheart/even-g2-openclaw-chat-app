---
phase: quick-26
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/display/glasses-renderer.ts
  - src/__tests__/glasses-renderer.test.ts
  - src/display/viewport.ts
autonomous: true
requirements: [SCROLL-AUDIT, SCROLL-DEBUG-ACCESSOR, SCROLL-DEVICE-COMMENTS]

must_haves:
  truths:
    - "Tests can directly assert viewport.scrollOffset and viewport.autoScroll via getViewportState()"
    - "All autoScroll mutation points in glasses-renderer.ts are audited and documented with inline comments"
    - "startStreaming() explicitly guards autoScroll to prevent trimTurnBuffer edge cases"
    - "Real-device integration assumptions about scroll entry points are documented"
  artifacts:
    - path: "src/display/glasses-renderer.ts"
      provides: "getViewportState() debug accessor, autoScroll audit comments, startStreaming guard, device integration comments"
      contains: "getViewportState"
    - path: "src/__tests__/glasses-renderer.test.ts"
      provides: "Tests using getViewportState() for direct viewport assertions"
      contains: "getViewportState"
    - path: "src/display/viewport.ts"
      provides: "Device integration assumption comment on scrollUp/scrollDown"
      contains: "Even G2"
  key_links:
    - from: "src/__tests__/glasses-renderer.test.ts"
      to: "src/display/glasses-renderer.ts"
      via: "getViewportState() accessor"
      pattern: "getViewportState\\(\\)"
---

<objective>
Harden the scroll viewport subsystem after the Bug 3 fix (quick-25): expose internal viewport state for test assertions, audit all autoScroll mutation points with inline documentation, add a defensive guard in startStreaming(), and document real-device integration assumptions.

Purpose: The quick-25 fix (conditional autoScroll reset in endStreaming) addressed one mutation point. This task completes the audit of all ~8 autoScroll touch points, makes tests less fragile by removing mock-call sniffing in favor of direct state assertions, and documents hardware assumptions that could break under future Even SDK changes.

Output: Hardened glasses-renderer.ts with debug accessor, audit comments, and defensive guards; updated tests using direct viewport state assertions.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/display/glasses-renderer.ts
@src/__tests__/glasses-renderer.test.ts
@src/display/viewport.ts
@src/__tests__/viewport.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Expose getViewportState() debug accessor and add autoScroll audit comments</name>
  <files>src/display/glasses-renderer.ts, src/display/viewport.ts</files>
  <action>
In `src/display/glasses-renderer.ts`:

1. **Add `getViewportState()` to the `GlassesRenderer` interface** (after `getIconAnimator`):
   ```ts
   /** Debug accessor: expose viewport state for test assertions. Not for production control flow. */
   getViewportState(): Readonly<ViewportState>;
   ```
   Import `ViewportState` is already available (line 17). The return type is `Readonly<ViewportState>` to prevent test code from mutating internal state.

2. **Implement `getViewportState()` in the factory** (after `getIconAnimatorFn`):
   ```ts
   function getViewportStateFn(): Readonly<ViewportState> {
     return viewport;
   }
   ```
   Add to the return object: `getViewportState: getViewportStateFn`.

3. **Audit and document all autoScroll touch points** with inline comments. There are 8 total touch points across two files. Add a block comment above the viewport state declaration (around line 104) summarizing the audit:
   ```ts
   // ── autoScroll invariant ──────────────────────────────────
   // autoScroll tracks whether new content should auto-scroll the viewport.
   // Mutation points (audited quick-26):
   //   WRITE: destroy()          -> true  (full reset, correct)
   //   WRITE: endStreaming()     -> true only if scrollOffset===0 (quick-25 fix)
   //   WRITE: scrollUp()         -> false (via viewport.ts pure fn)
   //   WRITE: scrollDown()       -> true when offset reaches 0 (via viewport.ts pure fn)
   //   READ:  flushStreamBuffer() -> gates scrollOffset=0 reset
   //   READ:  addUserMessage()    -> gates scrollOffset=0 + render
   //   READ:  showError()         -> gates scrollOffset=0 reset
   //   NOTE:  startStreaming()    -> does NOT touch autoScroll (safe, see guard below)
   ```

4. **Add defensive guard in `startStreaming()`** (line 207 area). After `trimTurnBuffer()`, add a comment and NO-OP guard that documents the design intent:
   ```ts
   function startStreaming(): void {
     trimTurnBuffer();
     // NOTE(quick-26): trimTurnBuffer() only shifts messages off the array.
     // It does NOT touch scrollOffset or autoScroll, so no guard needed.
     // If future changes add scroll-affecting logic to trimTurnBuffer,
     // autoScroll must be preserved here (do not blindly reset to true).

     const msg: ChatMessage = { ... };
     // ... rest unchanged
   }
   ```

5. **Add real-device integration comments** in `src/display/viewport.ts` at the top of `scrollUp()` and `scrollDown()` functions (around lines 98 and 114):
   ```ts
   // ASSUMPTION(quick-26): scrollUp()/scrollDown() are the ONLY scroll entry
   // points from the Even G2 bridge. The integer scrollOffset model assumes
   // discrete step scrolling. If the Even SDK ever adds inertial scrolling
   // or fractional offsets, the `scrollOffset === 0` check in glasses-renderer
   // endStreaming() could produce false positives. Review if bridge API changes.
   ```
   Place this comment once above `scrollUp` (not duplicated on scrollDown).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-renderer.test.ts src/__tests__/viewport.test.ts --reporter=verbose 2>&1 | tail -20</automated>
    <manual>Verify getViewportState exists on the interface and returns Readonly ViewportState</manual>
  </verify>
  <done>
    - getViewportState() is on GlassesRenderer interface and implemented in factory
    - All 8 autoScroll touch points have inline audit comments
    - startStreaming() has a defensive documentation comment about trimTurnBuffer safety
    - viewport.ts has real-device integration assumption comment above scrollUp
    - All existing tests still pass (no behavioral changes)
  </done>
</task>

<task type="auto">
  <name>Task 2: Refactor scroll anchoring tests to use getViewportState() direct assertions</name>
  <files>src/__tests__/glasses-renderer.test.ts</files>
  <action>
Refactor the "scroll anchoring (bug fix: scroll jump)" describe block (lines 389-537) to use `getViewportState()` for direct viewport state assertions instead of sniffing `bridge.textContainerUpgrade.mock.calls`.

The existing tests are correct but fragile -- they verify scroll behavior by checking what text appears in mock calls. Direct state assertions are clearer and more robust.

For each test in the `scroll anchoring` describe block, ADD direct viewport state assertions alongside the existing rendered-text assertions (keep both -- the text assertions verify the rendering pipeline, the state assertions verify the invariant directly).

Specific changes:

1. **"endStreaming preserves scroll position when user scrolled up"** (line 390):
   After `renderer.endStreaming()`, add:
   ```ts
   // Direct viewport state assertion (quick-26: less fragile than mock sniffing)
   const stateAfterEnd = renderer.getViewportState();
   expect(stateAfterEnd.autoScroll).toBe(false);
   expect(stateAfterEnd.scrollOffset).toBe(2);
   ```

2. **"endStreaming resets autoScroll when user is at bottom (scrollOffset=0)"** (line 425):
   After `renderer.endStreaming()`, add:
   ```ts
   const stateAfterEnd = renderer.getViewportState();
   expect(stateAfterEnd.autoScroll).toBe(true);
   expect(stateAfterEnd.scrollOffset).toBe(0);
   ```

3. **"scroll position survives multiple rapid response cycles"** (line 451):
   After the 5-cycle loop, before the final stream cycle, add:
   ```ts
   // After 5 endStreaming cycles, scroll position must be preserved
   const stateAfterCycles = renderer.getViewportState();
   expect(stateAfterCycles.autoScroll).toBe(false);
   expect(stateAfterCycles.scrollOffset).toBe(1);
   ```

4. **"scrolling back to bottom re-enables auto-scroll after preserved scroll"** (line 484):
   After `renderer.scrollDown()`, add:
   ```ts
   const stateAfterScrollDown = renderer.getViewportState();
   expect(stateAfterScrollDown.autoScroll).toBe(true);
   expect(stateAfterScrollDown.scrollOffset).toBe(0);
   ```

5. **"showError does not jump scroll when user scrolled up"** (line 514):
   After `renderer.showError('test error')`, add:
   ```ts
   const stateAfterError = renderer.getViewportState();
   expect(stateAfterError.autoScroll).toBe(false);
   expect(stateAfterError.scrollOffset).toBe(2);
   ```

6. **Add one NEW test** at the end of the scroll anchoring describe block that exercises `getViewportState()` through a full lifecycle:
   ```ts
   it('getViewportState() reflects full scroll lifecycle', async () => {
     await renderer.init();

     // Initial state
     const s0 = renderer.getViewportState();
     expect(s0.messages).toHaveLength(0);
     expect(s0.scrollOffset).toBe(0);
     expect(s0.autoScroll).toBe(true);

     // After adding messages
     renderer.addUserMessage('A');
     renderer.addUserMessage('B');
     const s1 = renderer.getViewportState();
     expect(s1.messages).toHaveLength(2);
     expect(s1.autoScroll).toBe(true);

     // After scrolling up
     renderer.scrollUp();
     const s2 = renderer.getViewportState();
     expect(s2.scrollOffset).toBe(1);
     expect(s2.autoScroll).toBe(false);

     // After streaming cycle with scroll preserved
     renderer.startStreaming();
     renderer.appendStreamChunk('response');
     renderer.endStreaming();
     const s3 = renderer.getViewportState();
     expect(s3.autoScroll).toBe(false);
     expect(s3.scrollOffset).toBe(1);
     expect(s3.messages).toHaveLength(3); // A, B, assistant response

     // After scrolling back to bottom
     renderer.scrollDown();
     const s4 = renderer.getViewportState();
     expect(s4.scrollOffset).toBe(0);
     expect(s4.autoScroll).toBe(true);
   });
   ```

Keep ALL existing assertion lines intact. The getViewportState() assertions are additive.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-renderer.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Confirm new getViewportState() assertions appear alongside existing mock-call assertions</manual>
  </verify>
  <done>
    - All 5 existing scroll anchoring tests have direct getViewportState() assertions added
    - 1 new lifecycle test exercises getViewportState() through full scroll lifecycle
    - All existing assertion lines are preserved (additive only)
    - All tests pass including the new assertions
  </done>
</task>

</tasks>

<verification>
Run full test suite to confirm no regressions:
```bash
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run --reporter=verbose 2>&1 | tail -5
```
TypeScript compilation check:
```bash
cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx tsc --noEmit 2>&1 | tail -10
```
</verification>

<success_criteria>
- getViewportState() debug accessor exists on GlassesRenderer interface and is implemented
- All 8 autoScroll touch points are documented with inline audit comments
- startStreaming() has defensive documentation about trimTurnBuffer safety
- viewport.ts has Even G2 device integration assumption comment
- 5 existing scroll anchoring tests have additive getViewportState() assertions
- 1 new lifecycle test exercises full scroll state transitions via getViewportState()
- All tests pass, TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/26-fix-scroll-viewport-expose-viewport-stat/26-SUMMARY.md`
</output>
