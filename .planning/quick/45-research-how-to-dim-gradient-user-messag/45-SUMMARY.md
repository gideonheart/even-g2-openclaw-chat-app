---
phase: quick-45
plan: 01
subsystem: display
tags: [g2-display, unicode, text-differentiation, research]

requires:
  - phase: quick-42
    provides: separator variants research (display glyph knowledge)
provides:
  - Research findings on user message dimming/gradient approaches for G2 glasses
  - Recommended implementation: Unicode sidebar marker (U+258E) + optional truncation
affects: [viewport, glasses-renderer]

tech-stack:
  added: []
  patterns: [unicode-sidebar-marker-for-role-differentiation]

key-files:
  created:
    - .planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md
  modified: []

key-decisions:
  - "Recommended prefix enhancement with U+258E (left quarter block) over dual-container or image overlay approaches"
  - "Unicode text-level dimming (mathematical italic, subscript) ruled out -- glyphs not in G2 firmware font"
  - "Image overlay ruled out -- no transparency, size limits, would obscure text"

patterns-established:
  - "G2 text differentiation: use confirmed-available Unicode block elements, not font styling"

requirements-completed: [QUICK-45]

duration: 2min
completed: 2026-03-05
---

# Quick Task 45: User Message Visual Differentiation Research

**G2 SDK capability audit + 7 approaches evaluated; recommended Unicode sidebar marker (U+258E) with optional user message truncation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-05T01:09:25Z
- **Completed:** 2026-03-05T01:11:35Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Complete SDK capability audit documenting all text rendering constraints (no per-char color, no font styling, no background fill)
- Survey of 4 sample G2 projects (EvenTwitchChat, Itsyhome, ePub Reader, Flashcards) for text differentiation patterns
- 7 approaches evaluated with hardware-aware pros/cons: Unicode dimming, indentation, prefix enhancement, truncation, dual-container, image overlay, line-level markers
- Clear recommendation: replace `> ` with `\u258E ` (left quarter block) for visual sidebar effect, optionally truncate user messages

## Task Commits

1. **Task 1: Survey G2 SDK capabilities and sample project patterns** - `1723b55` (docs)

## Files Created/Modified

- `.planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md` - Full research document with SDK audit, sample survey, 7 approaches, and ranked recommendations

## Decisions Made

- Recommended `\u258E` (left quarter block, U+258E) as sidebar marker -- confirmed in G2 firmware font, minimal space cost, strong visual distinction
- Ruled out Unicode text-level dimming -- mathematical italic and subscript glyphs absent from firmware font (would cause text to vanish)
- Ruled out image overlay -- no transparency in image containers, size limits too small, would obscure text
- Ruled out dual-container layout -- chat messages are interleaved, fixed zones break conversational flow, frequent rebuilds cause flicker

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Steps

- Follow-up quick task to implement the prefix change in `viewport.ts` (1-line change in `serializeMessages()`)
- Optional follow-up: user message truncation for viewport space savings
- Must verify `\u258E` rendering on real G2 hardware or Even Hub Simulator

---
*Phase: quick-45*
*Completed: 2026-03-05*
