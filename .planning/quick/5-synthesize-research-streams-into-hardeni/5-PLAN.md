---
phase: quick-5
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/PROJECT.md
  - .planning/ROADMAP.md
  - .planning/STATE.md
autonomous: true
requirements: [SYNTH-01, SYNTH-02, SYNTH-03]
must_haves:
  truths:
    - "PROJECT.md Active requirements section lists all v1.3 requirements with IDs"
    - "ROADMAP.md contains 6 v1.3 phases with goals, requirement IDs, and dependency structure"
    - "STATE.md reflects current position as requirements defined and phases planned"
  artifacts:
    - path: ".planning/PROJECT.md"
      provides: "v1.3 requirements with IDs under Active section"
      contains: "RES-"
    - path: ".planning/ROADMAP.md"
      provides: "v1.3 milestone phases with dependency graph"
      contains: "Phase 14"
    - path: ".planning/STATE.md"
      provides: "Updated project state"
      contains: "Requirements defined"
  key_links:
    - from: ".planning/ROADMAP.md"
      to: ".planning/PROJECT.md"
      via: "Requirement IDs in phase Requirements fields match IDs in PROJECT.md"
      pattern: "RES-\\d+"
---

<objective>
Synthesize 3 completed v1.3 research streams (ARCHITECTURE.md, STACK.md, PITFALLS.md) into concrete requirements in PROJECT.md and generate the v1.3 ROADMAP.md phases.

Purpose: Transform raw research findings into actionable, ID-tagged requirements and a phase-by-phase execution roadmap that the plan-phase workflow can consume for each v1.3 phase.
Output: Updated PROJECT.md (requirements), ROADMAP.md (6 phases), STATE.md (position)
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/research/ARCHITECTURE.md
@.planning/research/STACK.md
@.planning/research/PITFALLS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Synthesize v1.3 requirements into PROJECT.md</name>
  <files>.planning/PROJECT.md</files>
  <action>
Add v1.3 requirements to the "### Active" section of PROJECT.md, below the existing "## Current Milestone: v1.3 Resilience & Error UX" header. Each requirement gets a unique ID (RES-01 through RES-NN) and maps to a specific research finding.

Extract these requirement groups from the 3 research streams:

**Data Integrity (from ARCHITECTURE.md IntegrityChecker + StorageHealth + PITFALLS P1/P2/P4/P9):**
- RES-01: Boot-time integrity check -- scan for orphaned messages (conversationId with no matching conversation) and dangling session pointer (localStorage active ID pointing to deleted conversation). Single read-only IDB transaction. Under 50ms, under 50 lines of code. Do NOT do per-write verification (Pitfall P1). Do NOT auto-delete orphans (Pitfall P2) -- use grace period.
- RES-02: Storage health monitoring -- call navigator.storage.estimate() on boot, emit quota info via event bus. Warn at 80% usage, critical at 95%. Feature-detect with 'storage' in navigator.
- RES-03: Persistent storage request -- call navigator.storage.persist() on first boot. Log whether granted. If denied, show non-dismissible warning on hub health page.
- RES-04: Eviction detection via sentinel record -- write sentinel to IDB on first run. On subsequent boots, if IDB opens but sentinel missing, data was evicted. Emit storage:evicted event. Do NOT show first-run experience when data was evicted (Pitfall P4).
- RES-05: Orphan cleanup with grace period -- mark suspected orphans with timestamp. Only delete after 30-second grace period. Verify orphan status a second time before deletion. Surface orphan counts in hub diagnostics. One integrity check per boot maximum (Pitfall P2).

**Write & Save Hardening (from ARCHITECTURE.md AutoSave + ConversationStore + PITFALLS P1):**
- RES-06: Write verification for first message only -- after first successful addMessage() in a session, read back via separate readonly transaction to confirm storage is working. Skip verification for subsequent messages in same session. Re-verify after any persistence:warning event.
- RES-07: Error escalation in auto-save -- after all retries exhausted, emit persistence:error (not just persistence:warning). Include error type, conversationId, recoverable flag.
- RES-08: Partial response preservation -- on mid-stream SSE failure, save partial assistant text with "[response interrupted]" suffix rather than discarding. Clear pendingAssistantText after save.

**Sync Hardening (from ARCHITECTURE.md SyncMonitor + DriftReconciler + PITFALLS P3/P6):**
- RES-09: Sync sequence numbering -- add optional seq field to SyncMessage. Each context maintains monotonic counter. Detect gaps in received sequence numbers.
- RES-10: Sync heartbeat -- send sync:heartbeat message every 10 seconds with active conversation message count. Detect peer disconnection after 30 seconds of silence.
- RES-11: Drift reconciliation via IDB re-read -- when heartbeat reveals message count mismatch, re-read from IndexedDB (single source of truth) and re-render. Do NOT build complex sync protocol. IDB is shared, re-reading is cheapest reconciliation (Pitfall P3/P6).
- RES-12: IDB-as-truth sync design -- all sync hardening must work without BroadcastChannel. BC is optional "hurry up" notification. IDB is the authority. Design for poll-with-event-trigger pattern (Pitfall P3).

**FSM & Gateway Resilience (from ARCHITECTURE.md + PITFALLS P7/P8):**
- RES-13: FSM watchdog timer -- 45-second timeout for any transient state (recording, sent, thinking). Auto-reset to idle if no transition fires. Emit fsm:watchdog-reset event.
- RES-14: Gateway error classification -- distinguish connection errors (safe to auto-retry) from mid-stream errors (show partial response, prompt user). Add receivedAnyData flag in streamSSEResponse. Do NOT auto-retry mid-stream failures (Pitfall P7).
- RES-15: IDB database onclose handler -- hook IDBDatabase.onclose to detect unexpected closure (eviction, manual clear). Emit persistence:error with type database-closed. Attempt reopenDB().

**Error UX (from ARCHITECTURE.md ErrorPresenter + HealthIndicator + PITFALLS P5/P10):**
- RES-16: Glasses error display hierarchy -- transient errors in status bar only (container 0), auto-clear 3 seconds. Recoverable errors in status + hint bar, auto-clear 10 seconds, "tap to retry." Fatal errors full-screen but with "double-tap for menu" escape. Never occupy chat container (container 1) for more than 5 seconds (Pitfall P5).
- RES-17: Hub error display -- toasts for transient errors (auto-clear 5s), persistent banners for ongoing issues with action buttons. Error banner component with severity, message, optional recovery action, optional dismiss.
- RES-18: Hub health page enhancement -- add storage quota indicator (usage/quota/percent), sync status (last heartbeat, sequence gaps), overall health level (ok/degraded/error). Use existing status-dot CSS pattern.
- RES-19: Glasses health policy -- no persistent health indicators on glasses. Only show errors when actionable or temporary. No technical jargon on glasses ("Storage full" not "QuotaExceededError"). Every glasses error has auto-clear or existing gesture dismiss (Pitfall P10).

**Event System (from ARCHITECTURE.md AppEventMap):**
- RES-20: New AppEventMap events -- add persistence:error, sync:drift-detected, sync:reconciled, health:status-change, fsm:watchdog-reset event types to src/types.ts. All additive (no breaking changes).

**Test Infrastructure (from STACK.md test helpers):**
- RES-21: Failure simulation test helpers -- createFailingStore (fails after N writes), createLossySyncBridge (drops every Nth message). Uses existing fake-indexeddb forceCloseDatabase() for IDB closure simulation. No new dev dependencies.

**Stack Constraints (from STACK.md):**
- RES-22: Zero new runtime dependencies -- all features use browser built-in APIs (Storage API, IDB durability, IDBDatabase.onclose). Zero bundle impact.

Update the "Context" section to note: "v1.3 research completed: 3 streams (ARCHITECTURE.md, STACK.md, PITFALLS.md) with HIGH confidence findings."
  </action>
  <verify>
    <automated>grep -c "RES-" .planning/PROJECT.md | xargs test 22 -le</automated>
    <manual>Verify each RES-XX requirement has a clear, specific description with pitfall references where applicable</manual>
  </verify>
  <done>PROJECT.md Active section contains 22 requirements (RES-01 through RES-22) covering all 6 areas: data integrity, write hardening, sync hardening, FSM/gateway resilience, error UX, and infrastructure. Each requirement references specific research findings and pitfall avoidance.</done>
</task>

<task type="auto">
  <name>Task 2: Generate v1.3 ROADMAP.md phases and update STATE.md</name>
  <files>.planning/ROADMAP.md, .planning/STATE.md</files>
  <action>
**ROADMAP.md changes:**

Add a new v1.3 milestone section after the existing v1.2 details section. Use the established pattern (collapsible details for completed milestones, open for active). Phases 14-19 continue the global numbering.

Add milestone header:
```
## v1.3 Resilience & Error UX (Phases 14-19) -- ACTIVE
```

Define 6 phases following the dependency graph from ARCHITECTURE.md research, with these exact structures:

**Phase 14: Data Integrity Foundation**
- Goal: Boot-time integrity checking, storage health monitoring, eviction detection, and persistent storage -- the foundation all other resilience features depend on.
- Requirements: [RES-01, RES-02, RES-03, RES-04, RES-05, RES-15, RES-20 (persistence events only), RES-22]
- Key deliverables: integrity-checker.ts, storage-health.ts, sentinel record, IDB onclose handler, persistence event types in AppEventMap
- Plans: [To be planned]

**Phase 15: Write Verification & Auto-Save Hardening**
- Goal: Make the primary write path (auto-save) resilient with verification, error escalation, and partial response preservation -- preventing silent data loss.
- Requirements: [RES-06, RES-07, RES-08]
- Depends on: Phase 14 (needs persistence:error event type, storage health context)
- Key deliverables: verifyMessage() on ConversationStore, enhanced auto-save error escalation, partial response save on mid-stream failure
- Plans: [To be planned]

**Phase 16: Sync Hardening**
- Goal: Detect and recover from cross-context sync drift using IDB-as-truth pattern with sequence numbering and heartbeat.
- Requirements: [RES-09, RES-10, RES-11, RES-12, RES-20 (sync events only)]
- Depends on: Phase 14 (uses ConversationStore.countMessages for drift detection)
- Key deliverables: sync-monitor.ts, drift-reconciler.ts, SyncMessage seq field, heartbeat timer, sync event types
- Plans: [To be planned]

**Phase 17: FSM & Gateway Resilience**
- Goal: Prevent stuck states and handle gateway failures gracefully -- watchdog timer for FSM, error classification for gateway, no auto-retry of mid-stream failures.
- Requirements: [RES-13, RES-14, RES-20 (fsm events only)]
- Depends on: Phase 14 (event types)
- Can run parallel with Phase 16.
- Key deliverables: FSM watchdog timer, gateway error classification (connection vs mid-stream), receivedAnyData flag
- Plans: [To be planned]

**Phase 18: Error UX**
- Goal: Surface all error and health signals to users appropriately -- minimal on glasses (status bar, auto-clear), rich on hub (toasts, banners, health page).
- Requirements: [RES-16, RES-17, RES-18, RES-19]
- Depends on: Phases 14-17 (consumes all error events from prior phases)
- Key deliverables: error-presenter.ts (glasses + hub variants), health-indicator.ts, hub health page enhancements, error banner component
- Plans: [To be planned]

**Phase 19: Test Infrastructure & Resilience Coverage**
- Goal: Comprehensive failure scenario testing using existing tools -- test helpers for IDB failures and sync message loss, integration tests for all resilience features.
- Requirements: [RES-21]
- Depends on: Phases 14-18 (tests exercise all resilience features)
- Key deliverables: failure-helpers.ts, integration test suite for integrity/sync/error scenarios
- Plans: [To be planned]

Add the dependency graph as a comment:
```
Phase 14 (Foundation)
    |
    v
Phase 15 (Write)    Phase 16 (Sync)    Phase 17 (FSM/GW)
    |                    |                    |
    +--------------------+--------------------+
                         |
                         v
                  Phase 18 (Error UX)
                         |
                         v
                  Phase 19 (Tests)
```

Add to Progress table: 6 new rows for Phases 14-19, all with status "Not Started".

**STATE.md changes:**

Update:
- "Phase: v1.3 requirements defined, phases planned (14-19)"
- "Plan: --"
- "Status: Ready for /gsd:plan-phase on Phase 14"
- "Last activity: 2026-02-28 -- v1.3 requirements and roadmap defined from research synthesis"
- "Stopped at: v1.3 requirements defined, 6 phases planned (14-19). Ready to plan Phase 14."

Add to Blockers/Concerns if not already present:
- "Zero new runtime deps constraint (RES-22) -- all v1.3 features must use browser built-ins only"
  </action>
  <verify>
    <automated>grep -c "Phase 1[4-9]" .planning/ROADMAP.md | xargs test 6 -le && grep "Ready for" .planning/STATE.md</automated>
    <manual>Verify phase dependency graph is correct: 15/16/17 depend on 14, 18 depends on 14-17, 19 depends on 14-18. Verify 16 and 17 can run parallel.</manual>
  </verify>
  <done>ROADMAP.md contains 6 new phases (14-19) with goals, requirement IDs, dependency chains, and the v1.3 milestone header. STATE.md reflects current position as requirements defined and ready for Phase 14 planning. Progress table has 6 new "Not Started" entries.</done>
</task>

</tasks>

<verification>
1. PROJECT.md has 22+ RES-XX requirements covering all research streams
2. ROADMAP.md has Phases 14-19 with correct dependency graph
3. Every RES-XX ID appears in at least one phase's Requirements field
4. STATE.md shows v1.3 ready for Phase 14 planning
5. No new runtime dependencies referenced (RES-22 constraint honored)
6. Research pitfalls (P1-P10) are referenced in relevant requirements
</verification>

<success_criteria>
- PROJECT.md Active section has 22 tagged requirements synthesized from all 3 research streams
- ROADMAP.md has 6 phases with correct sequencing: 14 foundation, 15 writes, 16 sync, 17 FSM/GW (parallel with 16), 18 error UX, 19 tests
- STATE.md updated to reflect planning complete
- All pitfall avoidance constraints embedded directly in requirements (not as separate notes)
- Requirement IDs traceable from ROADMAP phase to PROJECT.md requirement
</success_criteria>

<output>
After completion, create `.planning/quick/5-synthesize-research-streams-into-hardeni/5-SUMMARY.md`
</output>
