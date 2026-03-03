# 02 — Voice Loop Decoupling + Queue (Phase PRD & Code Quality Analysis)

Date: 2026-03-02
Repo: `gideonheart/even-g2-openclaw-chat-app`
Scope: Validate interrupted Quick-20 direction, then define proper **phase-level** implementation plan.

## 1) Commit/Path Analysis (using `gh` + git)

### GitHub context
- Repo confirmed via `gh repo view`: `gideonheart/even-g2-openclaw-chat-app` (default branch `master`)
- No open PR for current branch (`gh pr status`)

### Relevant recent commits
- `7ce4a0b` docs(quick-19)
- `ff7651b` feat(quick-19): thinking+tap transition and `response_end` reset
- `49bd755` feat(quick-19): emit transcript chunk from gateway reply
- `5e6e994` docs(quick-20): plan decoupling input FSM from response lifecycle
- `9c96e0d` feat(quick-20): add `sent + tap -> recording` and `sent + double-tap -> menu`

### Was Claude on the correct path?
**Partially yes, but at the wrong abstraction level.**
- ✅ Correct direction: making `sent` state tappable was necessary and aligned with user intent.
- ❌ Not sufficient for requested scope: this is still a patch to a monolithic FSM, not full decoupling.
- ❌ Process mismatch: requested behavior (always-accept-tap + multi-turn queue + pipeline separation) is **phase-sized**, not quick-task sized.

## 2) Current Code Assessment (SRP/DRY/type-safety)

### Strengths in current code
- `src/gestures/gesture-fsm.ts` is pure/testable and strongly typed.
- `src/api/gateway-client.ts` already emits `transcript` chunks (good foundation).
- Existing tests cover FSM transitions and chunk semantics.

### Architectural gaps vs requested behavior
1. Input and response lifecycle are still coupled through shared state assumptions (`idle/recording/sent/thinking/menu`).
2. No first-class voice-turn queue abstraction with explicit backpressure/ordering guarantees.
3. `sent`/`thinking` behavior is still represented as gesture state, which conflates user-input eligibility with backend pipeline status.

## 3) Proposed New Phase (NOT quick task)

## Phase: "v1.4 Voice Loop Polish — Decoupled Input + Voice Queue"

### Product intent
- Tap should always allow recording start/stop (except when physically already recording constraints apply).
- Multiple voice turns can be captured while prior turns are being processed.
- Captured turns are queued and sent in-order when gateway is available.
- Transcript is surfaced in glasses UI immediately when available.

### Requirements
- **VLQ-01**: Input FSM governs only gesture/UI input states (`idle`, `recording`, `menu`) — no backend lifecycle states.
- **VLQ-02**: Response pipeline state is separate (`idle`, `in_flight`, `streaming`, `error`) and never blocks `start_recording`.
- **VLQ-03**: Introduce typed `VoiceTurnQueue` (FIFO, bounded, deterministic dequeue rules, duplicate guard by turn id).
- **VLQ-04**: `stop_recording` enqueues turn; sender drains queue whenever pipeline is available.
- **VLQ-05**: Preserve transcript-first rendering on glasses right side and persist user transcript deterministically.
- **VLQ-06**: Full test coverage for queue ordering, concurrency races, cancel/error recovery, and no dropped taps.
- **VLQ-07**: Remove obsolete legacy state transitions/dead paths after refactor.
- **VLQ-08**: Strict type-safety maintained (`npm run typecheck` clean, no `any` added in new flow).

### Proposed design (SRP + DRY)
1. **Input FSM module** (`input-fsm.ts`)
   - owns gesture transitions only.
2. **Pipeline state module** (`response-pipeline.ts`)
   - owns gateway lifecycle events.
3. **Queue module** (`voice-turn-queue.ts`)
   - pure queue + policy (max size, overflow handling, enqueue/dequeue events).
4. **Orchestrator** (`voice-loop-orchestrator.ts`)
   - coordinates input actions, recording service, queue, sender, display updates.
5. **Gateway adapter**
   - maps gateway chunks to pipeline events + transcript updates.

### Verification gates
- `npm run build`
- `npm run typecheck`
- Full unit tests (`npm test` / project equivalent)
- Add targeted tests:
  - queue while streaming
  - queue while processing (`sent` equivalent)
  - strict FIFO over N voice turns
  - retry/error path does not deadlock queue
  - transcript appears before response stream text

## 4) Why this should be a phase
- Cross-cutting change across gesture layer, voice loop, gateway lifecycle, and tests.
- Introduces new abstractions (queue + pipeline) and retirement of legacy transitions.
- Requires requirements/roadmap/verification artifacts for safe rollout and reversibility.

## 5) Branch strategy for safety
Create dedicated branch before further refactor:
- `refactor/v1.4-voice-loop-decoupled-fsm-queue`

This enables safe rollback and clean PR review boundary.

## 6) Immediate execution command to Claude Code
After clear:
- `/gsd:add-phase @.planning/analysis/02-voice-loop-decoupled-fsm-queue-phase-prd.md`

And include constraints:
- Enforce SRP + DRY extraction
- Remove dead/legacy paths after migration
- Keep strict type safety
- End with `npm run build` + full tests
