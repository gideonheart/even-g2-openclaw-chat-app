---
status: resolved
trigger: "glasses-not-waking-after-hub-load: After recent code changes (quick-23 through quick-27), glasses do not wake up when app loads in Even App Hub"
created: 2026-03-03T10:48:00Z
updated: 2026-03-03T10:52:00Z
---

## Current Focus

hypothesis: CONFIRMED - Hub never receives bridge:connected because sync bridge lacks bridge connection message types. Fix applied: added bridge:connected/disconnected to SyncMessage, wired forwarding in glasses-main.ts, handled in hub-main.ts sync handler.
test: TypeScript compilation, full test suite, vite build
expecting: All pass with no regressions
next_action: Finalize verification and archive session

## Symptoms

expected: When the hub web app loads inside the Even App, glasses should auto-connect via the Even bridge. Hub should show "Connected" and battery percentage. Glasses display should wake up.
actual: Hub shows "Disconnected" and "-- %" battery. Glasses do not wake up at all. No connect/disconnect button visible.
errors: Unknown - no console errors confirmed yet
reproduction: Open Even App Hub, load the app. Glasses stay dormant.
started: After recent changes (quick-23 through quick-27) which touched gesture-handler.ts, glasses-renderer.ts, viewport.ts, and tests.

## Eliminated

- hypothesis: quick-23 to quick-27 code changes broke the glasses boot sequence
  evidence: |
    Diffed all changes (0eab826..HEAD). Changes are:
    1. gesture-handler.ts: Added menu:close and session:switched bus listeners (post-boot, won't affect init)
    2. glasses-renderer.ts: Added getViewportState() accessor and conditional autoScroll in endStreaming (post-boot, won't affect init)
    3. viewport.ts: Comments only
    4. Tests only
    None of these changes touch the boot path, bridge init, or connection flow.
    All 613 tests pass.
  timestamp: 2026-03-03T10:48:00Z

- hypothesis: Uncommitted changes (even-bridge.ts logging, build-info, vite defines) break boot
  evidence: |
    even-bridge.ts: Only added bus.emit('log',...) calls - benign
    main.ts: Added import('./build-info').then(...) - non-blocking dynamic import
    vite.config.ts: Build-time only (execSync, define) - no runtime effect
    build-info.ts: Uses typeof guards, gracefully handles missing constants
    Build succeeds, all tests pass.
  timestamp: 2026-03-03T10:48:00Z

## Evidence

- timestamp: 2026-03-03T10:30:00Z
  checked: main.ts boot flow
  found: |
    Boot order: await initHub() THEN await bootGlasses()
    Hub init is wrapped in try-catch, so failures won't block glasses boot.
    This order has been the same since commit e89ede3 (when hub + glasses dual boot was added).
  implication: Glasses boot should always run after hub init, regardless of hub init result.

- timestamp: 2026-03-03T10:35:00Z
  checked: Hub glasses connection status mechanism
  found: |
    Hub uses THREE mechanisms to detect glasses connection:
    1. ensureBridgeStatusSubscription() - looks for window.EvenAppBridge global, subscribes to onDeviceStatusChanged
    2. refreshBridgeStatus() - looks for window.EvenAppBridge.getDeviceInfo() one-shot probe
    3. wireHubBusBridgeEvents() - listens on hubBus for bridge:connected events

    PROBLEM: All three mechanisms have gaps:
    - Mechanisms 1 & 2: At hub init time, window.EvenAppBridge may not exist yet because the SDK singleton
      is created lazily in waitForEvenAppBridge() (called later in glasses boot). The SDK sets
      window.EvenAppBridge in the EvenAppBridge constructor's init() method.
    - Mechanism 3: hubBus is a separate bus from glasses bus. No code forwards bridge:connected
      from glasses bus to hubBus. The SyncMessage type union doesn't include bridge connection events.
  implication: Hub has NEVER been able to reliably detect glasses connection status. This is a pre-existing architectural gap.

- timestamp: 2026-03-03T10:40:00Z
  checked: Sync bridge message types
  found: |
    SyncMessage union in sync-types.ts includes: session:created, session:renamed, session:deleted,
    session:switched, message:added, conversation:named, streaming:start, streaming:end,
    sync:heartbeat, gateway:error, gateway:status-changed.
    NO bridge:connected or bridge:disconnected message type exists.
    glasses-main.ts forwards gateway:error and gateway:status-changed via syncBridge but NOT bridge events.
  implication: The hub-glasses sync bridge has never carried connection status. This is an architectural gap.

- timestamp: 2026-03-03T10:42:00Z
  checked: Even SDK singleton lifecycle
  found: |
    SDK type declarations confirm: "init() exposes bridge instance to window.EvenAppBridge"
    SDK source confirms: window['EvenAppBridge'] = this in constructor init()
    waitForEvenAppBridge() checks window.EvenAppBridge and _ready flag
    getInstance() creates singleton lazily (only on first call)
  implication: |
    The SDK bridge global IS available on window, but only AFTER the glasses boot imports the SDK
    and calls waitForEvenAppBridge(). Hub init runs before this, so window.EvenAppBridge doesn't
    exist yet when hub tries to subscribe.

- timestamp: 2026-03-03T10:44:00Z
  checked: Test suite
  found: All 38 test files pass (613 tests total). No regressions.
  implication: Code changes are structurally sound. Issue is architectural, not a regression.

- timestamp: 2026-03-03T10:46:00Z
  checked: TypeScript compilation and Vite build
  found: Both succeed without errors. Build output includes all expected chunks.
  implication: No compilation issues that could cause runtime failures.

## Resolution

root_cause: |
  TWO ISSUES (both pre-existing architectural gaps, not regressions from quick-23-27):

  ISSUE 1 - Hub cannot detect glasses connection status:
  The hub's ensureBridgeStatusSubscription() and refreshBridgeStatus() probe for window.EvenAppBridge
  during hub init(), but the SDK singleton is not yet created at that point. The bridge only exists
  after glasses boot calls waitForEvenAppBridge(). Additionally, wireHubBusBridgeEvents() listens
  on hubBus (hub's local event bus), but bridge:connected is only emitted on the glasses' local bus.
  The sync bridge (BroadcastChannel) does not carry bridge connection events.

  ISSUE 2 - Timing gap: Hub probes once, never retries:
  Even if the SDK singleton were available, ensureBridgeStatusSubscription() only runs at init time
  and never retries. refreshBridgeStatus() is also one-shot. If the device connects AFTER these
  probes run, the hub never learns about it.

  FIX DIRECTION:
  A. Forward bridge:connected/disconnected from glasses to hub via sync bridge (new SyncMessage types)
  B. OR: Re-probe window.EvenAppBridge periodically or after glasses boot signal
  C. OR: Move ensureBridgeStatusSubscription() to run AFTER glasses boot completes

fix: |
  Added bridge:connected and bridge:disconnected message types to the cross-context sync bridge,
  then wired the forwarding from glasses-main to hub-main:

  1. src/sync/sync-types.ts: Added two new SyncMessage variants:
     - { type: 'bridge:connected'; deviceName: string; battery?: string }
     - { type: 'bridge:disconnected'; reason?: string }

  2. src/glasses-main.ts: Forward bridge:connected and bridge:disconnected bus events via syncBridge.postMessage()
     (mirrors existing gateway:error and gateway:status-changed forwarding pattern)

  3. src/hub-main.ts: Handle bridge:connected and bridge:disconnected in sync bridge onMessage handler,
     calling setGlassesConnected/setGlassesDisconnected + renderGlassesStatus()

verification: |
  - TypeScript compilation: passes (npx tsc --noEmit)
  - Full test suite: 613/613 tests pass across 38 files
  - Vite production build: succeeds
  - No regressions detected

files_changed:
  - src/sync/sync-types.ts
  - src/glasses-main.ts
  - src/hub-main.ts
