---
phase: quick-45
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md
autonomous: true
requirements: [QUICK-45]
must_haves:
  truths:
    - "Research document exists with SDK capability analysis for text differentiation"
    - "All feasible approaches are listed with pros/cons for the G2 hardware constraints"
    - "Sample project patterns are surveyed and referenced"
    - "A recommended approach is identified with implementation sketch"
  artifacts:
    - path: ".planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md"
      provides: "Research findings on user message dimming/gradient approaches"
  key_links: []
---

<objective>
Research how to visually dim or gradient user messages on the Even G2 glasses chat display for better differentiation between user and assistant messages.

Purpose: The current chat UI uses only a `> ` prefix to distinguish user messages from assistant messages. Investigate what visual differentiation is possible given the G2 hardware constraints (plain text only, no font styling, no per-character color control).

Output: A research document with SDK capability analysis, feasible approaches, sample project patterns, and a recommended implementation path.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/display/viewport.ts
@src/display/glasses-renderer.ts
@src/bridge/bridge-types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Survey G2 SDK capabilities and sample project patterns for text differentiation</name>
  <files>.planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md</files>
  <action>
Research and document all approaches to visually differentiating user messages from assistant messages on the Even G2 glasses display. The research must cover:

**1. SDK Capability Audit**
Read the G2 SDK notes at `../even-g2-notes/G2.md` and `../even-g2-notes/docs/display.md`. Document:
- Text container rendering: plain text only, no font color/size/bold/italic
- Container-level visual controls: borderWidth (0-5), borderColor (0-16 greyscale), borderRadius (0-10), padding (0-32)
- Unicode glyph support (which chars render, which are skipped)
- Multiple container approach: can you split user/assistant into separate containers?
- Image container overlay: could a semi-transparent image overlay create a "dim" effect?

**2. Sample Project Survey**
Check these sample projects for any text differentiation patterns:
- `../EvenTwitchChat/src/display.ts` -- how Twitch chat handles usernames vs messages
- `../itsyhome-even-g2/g2/renderer.ts` -- how home automation renders different data types
- `../epub-reader-g2/` -- any text formatting tricks for book content
- `../g2-flashcards/` -- any card-face differentiation

**3. Feasible Approaches**
Evaluate each approach with pros/cons:

a) **Unicode text-level dimming** -- use lighter Unicode chars (e.g. small caps, subscript, mathematical italic) to make user text visually lighter. Risk: firmware font may not include these glyphs.

b) **Indentation/wrapping** -- indent user messages or wrap in brackets/parentheses to create visual grouping distinct from flush-left assistant text.

c) **Prefix enhancement** -- enhance the current `> ` prefix with Unicode block elements (e.g. `▎`, `│`, `┃`) to create a stronger visual sidebar marker.

d) **Truncation/abbreviation** -- show user messages as abbreviated single-line summaries (user already knows what they said), keeping full space for assistant responses.

e) **Dual-container layout** -- use two separate text containers with different border styles: one for user messages (with visible border = "dimmed" look), one for assistant.

f) **Image overlay** -- render a grey overlay image on top of user text area. Risk: image containers are separate from text containers in the SDK.

g) **Line-level visual markers** -- use Unicode block elements to create a visual "sidebar" effect (e.g. `░` or `▒` column next to user text).

**4. Recommendation**
Based on what actually works on G2 hardware (single font, limited Unicode, no per-char styling), recommend the most practical approach with an implementation sketch referencing the current `serializeMessages()` function in `viewport.ts`.

Write findings to `45-RESEARCH.md` with clear sections and the recommendation at the top.
  </action>
  <verify>
    <automated>test -f .planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md && grep -c "##" .planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md | xargs test 3 -le</automated>
    <manual>Review that research covers SDK constraints, sample patterns, and has a clear recommendation</manual>
  </verify>
  <done>Research document exists with: SDK capability audit, sample project survey, at least 4 feasible approaches with pros/cons, and a ranked recommendation with implementation sketch</done>
</task>

</tasks>

<verification>
- Research document covers G2 SDK text rendering constraints
- At least 4 approaches evaluated with hardware-aware pros/cons
- Sample projects surveyed for existing patterns
- Clear recommendation with implementation sketch
</verification>

<success_criteria>
Research document at `.planning/quick/45-research-how-to-dim-gradient-user-messag/45-RESEARCH.md` provides actionable findings that can guide a follow-up implementation task, with a clear top recommendation grounded in G2 hardware constraints.
</success_criteria>

<output>
After completion, create `.planning/quick/45-research-how-to-dim-gradient-user-messag/45-01-SUMMARY.md`
</output>
