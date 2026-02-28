# Deferred Items - Phase 02

## Pre-existing Issues (out of scope)

1. **audio-capture.test.ts: blob2.arrayBuffer is not a function** (from commit 11a3042, plan 02-02)
   - Test: "multiple start/stop cycles work correctly (frames reset on start)"
   - Root cause: jsdom Blob may not implement `arrayBuffer()` correctly
   - Status: Pre-existing, not caused by plan 02-01 changes

2. **even-bridge.test.ts: unused import TS6192** (from commit 11a3042, plan 02-02)
   - TypeScript strict `noUnusedLocals` flags an unused import in the test file
   - Status: Pre-existing, not caused by plan 02-01 changes
