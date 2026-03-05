---
phase: quick-46
plan: 1
subsystem: display
tags: [glasses, renderer, scroll, batch-loading, session-switching]
dependency_graph:
  requires: []
  provides: [loadMessages-batch-method]
  affects: [glasses-renderer, glasses-main, boot-restore, session-switching, sync-reconciled]
tech_stack:
  added: []
  patterns: [batch-viewport-loading, single-render-push]
key_files:
  created: []
  modified:
    - src/display/glasses-renderer.ts
    - src/glasses-main.ts
    - src/__tests__/glasses-renderer.test.ts
decisions:
  - loadMessages clears viewport state (messages, scroll) but preserves icon animator and hidden/welcomeShown flags
  - trimTurnBuffer applied once after all messages loaded, not per-message
metrics:
  duration: 4m
  completed: 2026-03-05
---

# Quick Task 46: Fix Chat Session Switching Scroll-Through Flash

Batch loadMessages method replaces per-message addUserMessage/startStreaming/appendStreamChunk/endStreaming loops -- glasses SDK receives exactly one textContainerUpgrade call instead of N per restored message.

## Changes Made

### Task 1: Add loadMessages batch method to GlassesRenderer
- Added `loadMessages(messages)` to GlassesRenderer interface and implementation
- Method clears viewport messages/scroll, builds ChatMessage objects directly, trims once, renders once
- No intermediate renderAndPush() calls during loading (the key fix)
- Commit: `454de88`

### Task 2: Replace per-message loops in glasses-main.ts
- Boot restore: replaced for-loop with `renderer.loadMessages()`
- switchToSession: replaced for-loop with `renderer.loadMessages()`
- sync:reconciled handler: replaced for-loop with `renderer.loadMessages()`
- Net -27 lines of duplicated per-message loading code replaced with 3 one-liners
- Commit: `4834d1e`

### Task 3: Add tests for loadMessages batch rendering
- 4 new tests: single render push, replacement, empty array, MAX_TURNS trim
- Critical test: verifies exactly 1 textContainerUpgrade call to container 2 after loading 5 messages
- Commit: `db8de10`

## Deviations from Plan

None -- plan executed exactly as written.

## Verification

- All 34 glasses-renderer tests pass (30 existing + 4 new)
- All 19 glasses-main tests pass
- Full suite: 681 tests passing across 38 test files

## Self-Check: PASSED
