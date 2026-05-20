---
phase: quick-33
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/glasses-main.ts
  - src/__tests__/glasses-main.test.ts
autonomous: true
requirements: [QUICK-33]
must_haves:
  truths:
    - "bridge:connected event emitted during bridge.init() is forwarded to hub via syncBridge"
    - "Hub connection card shows 'Connected' after glasses boot completes"
    - "bridge:disconnected events are still forwarded correctly"
  artifacts:
    - path: "src/glasses-main.ts"
      provides: "Bridge event forwarding listeners registered before bridge.init()"
      contains: "bus.on('bridge:connected'"
    - path: "src/__tests__/glasses-main.test.ts"
      provides: "Test proving bridge:connected is forwarded during boot"
      contains: "bridge:connected.*forwarded"
  key_links:
    - from: "src/bridge/even-bridge.ts"
      to: "src/glasses-main.ts"
      via: "bus.emit('bridge:connected') during init() -> bus.on('bridge:connected') listener"
      pattern: "bus\\.on\\('bridge:connected'"
    - from: "src/glasses-main.ts"
      to: "syncBridge"
      via: "postMessage({ type: 'bridge:connected' })"
      pattern: "syncBridge\\.postMessage.*bridge:connected"
---

<objective>
Fix glasses connection card stuck on "Disconnected" by moving bridge event forwarding listeners before bridge.init().

Purpose: The bridge:connected event fires during bridge.init() (even-bridge.ts:112) but the bus listeners that forward it to the hub via syncBridge are registered 232 lines later (glasses-main.ts:498-512). The event is lost and the hub never learns the bridge connected.

Output: Corrected boot order in glasses-main.ts, regression test in glasses-main.test.ts.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/glasses-main.ts
@src/__tests__/glasses-main.test.ts
@src/bridge/even-bridge.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move bridge event forwarding listeners before bridge.init()</name>
  <files>src/glasses-main.ts</files>
  <action>
Move the bridge event forwarding block (currently at lines 498-512) to BEFORE `await bridge.init()` (line 266), placing it immediately after the bridge is created (line 265).

The block to move:
```typescript
// Forward bridge connection status to hub via sync bridge
bus.on('bridge:connected', ({ deviceName }) => {
  syncBridge.postMessage({
    type: 'bridge:connected',
    origin: 'glasses',
    deviceName,
  });
});
bus.on('bridge:disconnected', ({ reason }) => {
  syncBridge.postMessage({
    type: 'bridge:disconnected',
    origin: 'glasses',
    reason,
  });
});
```

This block depends on `bus` (line 57), `syncBridge` (line 234), and the bridge event types -- all exist before line 265. The block does NOT depend on anything created after bridge.init().

Also move the gateway error/status forwarding block (currently lines 514-530) to the same location, since those listeners should also be ready before any gateway activity. Place them right after the bridge event forwarding block.

Keep the same comment headers for readability. Add a brief comment explaining WHY the listeners must be registered before init:
```typescript
// Forward bridge connection status to hub via sync bridge.
// MUST be registered before bridge.init() -- init() emits bridge:connected
// synchronously, so the listener must exist to forward it to the hub.
```
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm run build 2>&1 | tail -5</automated>
    <manual>Verify in glasses-main.ts that bus.on('bridge:connected') appears BEFORE await bridge.init()</manual>
  </verify>
  <done>Bridge event forwarding listeners are registered before bridge.init() so the initial bridge:connected event is captured and forwarded to the hub.</done>
</task>

<task type="auto">
  <name>Task 2: Add test verifying bridge:connected is forwarded during boot</name>
  <files>src/__tests__/glasses-main.test.ts</files>
  <action>
Add a new test in the existing glasses-main.test.ts file. Create a new `describe` block called 'bridge event forwarding during boot'.

The test should verify that after boot() completes, syncBridge.postMessage was called with a bridge:connected message. This works because:
1. mockBridge.init() resolves (mock)
2. The mockBus.on() captures registered listeners
3. Since even-bridge.ts emits bridge:connected at the end of init(), we need to simulate that the bus.on('bridge:connected') listener was called

The test approach:
- After boot(), find the bus.on('bridge:connected') call in mockBus.on.mock.calls
- Extract the registered callback
- Call it with `{ deviceName: 'Even G2' }`
- Assert syncBridge.postMessage was called with `{ type: 'bridge:connected', origin: 'glasses', deviceName: 'Even G2' }`

Add a second test that does the same for bridge:disconnected:
- Find the bus.on('bridge:disconnected') callback
- Call it with `{ reason: 'lost' }`
- Assert syncBridge.postMessage was called with `{ type: 'bridge:disconnected', origin: 'glasses', reason: 'lost' }`

Add a third structural test that verifies registration ORDER:
- After boot(), inspect mockBus.on.mock.calls
- Find the index of the 'bridge:connected' registration
- Find the index of the 'bridge:audio-frame' registration (which is at line 288, after bridge.init())
- Assert bridge:connected index < bridge:audio-frame index (bridge:connected registered first)

NOTE: The mockBus.on already tracks all calls via vi.fn(), so we can inspect mock.calls to find specific event registrations.

Use the same beforeEach/afterEach pattern as the existing 'sync bridge text turn rendering' describe block (dev mode, same mock resets).
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/glasses-main.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>Three new tests pass: (1) bridge:connected forwarded to syncBridge, (2) bridge:disconnected forwarded to syncBridge, (3) bridge event listeners registered before bridge:audio-frame listener (structural order check).</done>
</task>

</tasks>

<verification>
- `npm run build` passes with no errors
- `npx vitest run src/__tests__/glasses-main.test.ts` -- all tests pass including 3 new ones
- `npm test` -- full test suite passes
</verification>

<success_criteria>
- bridge:connected event emitted during bridge.init() is captured by a listener that already exists
- Hub receives bridge:connected via syncBridge.postMessage during normal boot
- Connection card in hub shows "Connected" instead of stuck on "Disconnected"
- 3 new tests verify the forwarding behavior and registration order
- All existing tests continue to pass (no regressions)
</success_criteria>

<output>
After completion, create `.planning/quick/33-investigate-glasses-connection-card-stuc/33-01-SUMMARY.md`
</output>
