---
phase: quick-16
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/settings.ts
  - src/__tests__/settings.test.ts
autonomous: true
requirements: [QUICK-16]

must_haves:
  truths:
    - "isLocalhostUrl('http://0.0.0.0:4400') returns true"
    - "isLocalhostUrl('http://0.0.0.0') returns true (no port)"
    - "localhostWarning returns warning for 0.0.0.0 on real device"
    - "All existing tests still pass"
    - "Build succeeds with no type errors"
  artifacts:
    - path: "src/settings.ts"
      provides: "Extended LOOPBACK_RE with 0.0.0.0"
      contains: "0\\.0\\.0\\.0"
    - path: "src/__tests__/settings.test.ts"
      provides: "Test cases for 0.0.0.0 detection"
      contains: "0.0.0.0"
  key_links:
    - from: "src/settings.ts"
      to: "src/__tests__/settings.test.ts"
      via: "isLocalhostUrl and localhostWarning imports"
      pattern: "isLocalhostUrl.*0\\.0\\.0\\.0"
---

<objective>
Extend LOOPBACK_RE regex to recognize 0.0.0.0 as a loopback/non-routable address so that isLocalhostUrl() catches it. Add corresponding test cases. Verify all tests pass and build succeeds.

Purpose: Follow-up from quick-15 self-review (commit 2b41c8d) which recommended adding 0.0.0.0 to LOOPBACK_RE. On mobile devices, http://0.0.0.0:4400 fails the same way as localhost but currently bypasses the actionable localhost warning.

Output: Updated regex, updated JSDoc, new test cases, green test suite, clean build.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/settings.ts
@src/__tests__/settings.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend LOOPBACK_RE and update JSDoc</name>
  <files>src/settings.ts</files>
  <action>
In src/settings.ts line 114, update the LOOPBACK_RE regex to include 0.0.0.0 as an additional alternative:

```typescript
const LOOPBACK_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;
```

Update the JSDoc comment on isLocalhostUrl (line 116-118) to mention 0.0.0.0:

```typescript
/**
 * Returns true when the gateway URL points to a loopback address
 * (localhost, 127.0.0.1, [::1], or 0.0.0.0).
 */
```

No other changes needed. The function body, localhostWarning, and all consumers remain unchanged since they all go through isLocalhostUrl.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npx vitest run src/__tests__/settings.test.ts 2>&1 | tail -20</automated>
  </verify>
  <done>LOOPBACK_RE matches 0.0.0.0 with and without port. JSDoc updated. Existing tests still pass.</done>
</task>

<task type="auto">
  <name>Task 2: Add test cases for 0.0.0.0 and run full suite + build</name>
  <files>src/__tests__/settings.test.ts</files>
  <action>
In src/__tests__/settings.test.ts, inside the `describe('isLocalhostUrl', ...)` block, add three new test cases after the existing [::1] test (after line 207):

```typescript
    it('returns true for http://0.0.0.0:4400', () => {
      expect(isLocalhostUrl('http://0.0.0.0:4400')).toBe(true);
    });

    it('returns true for http://0.0.0.0 (no port)', () => {
      expect(isLocalhostUrl('http://0.0.0.0')).toBe(true);
    });

    it('returns true for http://0.0.0.0:4400/', () => {
      expect(isLocalhostUrl('http://0.0.0.0:4400/')).toBe(true);
    });
```

Inside the `describe('localhostWarning', ...)` block, add one new test case after the existing 127.0.0.1 warning test (after line 278):

```typescript
    it('returns warning for 0.0.0.0 on real device', () => {
      (window as any).flutter_inappwebview = {};
      const warning = localhostWarning('http://0.0.0.0:4400');
      expect(warning).toContain('localhost');
      expect(warning).toContain('phone');
    });
```

After adding tests, run the full test suite (`npm test`) and build (`npm run build`) to confirm everything passes cleanly.
  </action>
  <verify>
    <automated>cd /home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app && npm test 2>&1 | tail -30 && npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>Four new test cases added and passing (three for isLocalhostUrl, one for localhostWarning). Full test suite green. Build succeeds with no errors.</done>
</task>

</tasks>

<verification>
1. `npm test` -- all tests pass including 4 new 0.0.0.0 cases
2. `npm run build` -- clean build, no TypeScript errors
3. Regex still rejects non-loopback addresses (existing negative tests pass)
</verification>

<success_criteria>
- LOOPBACK_RE includes 0.0.0.0 alternative
- isLocalhostUrl('http://0.0.0.0:4400') === true
- isLocalhostUrl('http://0.0.0.0') === true
- localhostWarning returns warning for 0.0.0.0 on real device
- All 549+ existing tests still pass
- Build succeeds cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/16-extend-loopback-re-to-include-0-0-0-0-ad/16-SUMMARY.md`
</output>
