# Known Bugs — Buggy Calculator

This document lists all intentional bugs seeded into the codebase for GitHub issue tracking practice.

| ID | File | Description | Severity |
|----|------|-------------|----------|
| BUG-001 | `utils/math.ts` | Division operands are swapped — `10 ÷ 2` returns `0.2` instead of `5` | Critical |
| BUG-002 | `utils/math.ts` | Percentage divides by 10 instead of 100 — `50%` returns `5` instead of `0.5` | High |
| BUG-003 | `utils/math.ts` | `√` of a negative number silently returns `NaN` with no user-visible error | Medium |
| BUG-004 | `utils/math.ts` | `toggleSign(0)` returns `-0` instead of `0` | Low |
| BUG-005 | `utils/math.ts` | Integer results show 20 trailing decimal zeros (e.g. `2.00000000000000000000`) | High |
| BUG-006 | `utils/history.ts` | History expressions use raw operator char (`*`) instead of display label (`×`) | Low |
| BUG-007 | `utils/history.ts` | `createHistoryEntry` always records timestamp as Unix epoch (Jan 1 1970) | Medium |
| BUG-008 | `utils/history.ts` | `clearHistory` mutates the existing array — React state does not re-render | High |
| BUG-009 | `utils/history.ts` | `formatTimestamp` forces UTC timezone so all times display incorrectly | Medium |
| BUG-010 | `utils/memory.ts` | `memoryAdd` performs string concatenation instead of numeric addition | Critical |
| BUG-011 | `utils/memory.ts` | `memorySubtract` is reversed — subtracts memory from value instead of value from memory | High |
| BUG-012 | `utils/memory.ts` | `memoryRecall` returns `null` for any negative memory value | Medium |
| BUG-013 | `hooks/useCalculator.ts` | No digit cap — entering 30+ digits overflows the display | Medium |
| BUG-014 | `hooks/useCalculator.ts` | Multiple decimal points allowed (e.g. `3.1.4`) | High |
| BUG-015 | `hooks/useCalculator.ts` | History is appended (oldest-first) instead of prepended (newest-first) | Low |
| BUG-016 | `hooks/useCalculator.ts` | Backspace on last digit leaves empty string `""` — display goes blank | High |
| BUG-017 | `hooks/useCalculator.ts` | Memory Recall when empty sets display to the string `"null"` | Medium |
| BUG-018 | `components/Display.tsx` | Long numbers overflow display box (no truncation or font-size scaling) | Medium |
| BUG-019 | `components/Display.tsx` | Operator indicator shows raw char (`*`, `/`) instead of symbol (`×`, `÷`) | Low |
| BUG-020 | `components/Button.tsx` | Buttons have no `onKeyDown` handler — keyboard Enter/Space do not trigger them | High |
| BUG-021 | `components/Button.tsx` | `wide` prop ternary always resolves to `'wide'` — every button gets the wide class | High |
| BUG-022 | `components/History.tsx` | Array index used as React `key` — stale keys on clear + re-add | Medium |
| BUG-023 | `components/History.tsx` | "Clear History" has no confirmation dialog — data loss on accidental click | Medium |
| BUG-024 | `components/Keypad.tsx` | `0` button not given `wide` prop (masked by BUG-021) | Low |
| BUG-025 | `components/Keypad.tsx` | No `window` keyboard event listener — full keyboard entry unsupported | High |
| BUG-026 | `App.tsx` | No React Error Boundary — any child error crashes the whole app | High |
| BUG-027 | `App.tsx` | History panel is always visible with no toggle — poor mobile experience | Medium |
