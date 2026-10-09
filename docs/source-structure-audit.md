# Server source-structure guardrail baseline

This report records the source-structure audit for refactors #5–#12 as of 9 October 2026.

**Rules:** The AST check matches `kittyCrypto-gg/website/scripts/check-conditional-nesting.mts`: an `if` or `switch` nested beneath an `if`/`switch` is forbidden, including `else if`. Ternary expressions, early returns, and separate guard clauses are allowed. Every modified or newly created `.ts`/`.tsx` source module must have **at most 500 lines**.

**Legacy exception:** Twelve existing source files on the original `main` had an overlength module, nested conditionals, or both. The script permits those violations **only for the exact original Git blob SHA**. Any change to one of those files invalidates that exemption. New modules never qualify. This is a temporary debt baseline, not an exception for future violations.

| Candidate | TS/TSX modules | Nested conditionals (including unchanged legacy) | Over 500 lines (including unchanged legacy) | New violations |
|---|---:|---:|---:|---:|
| Original `main` | 29 | 32 | 8 | 0 |
| PR #5 — server helpers | 44 | 32 | 7 | **0** |
| PR #6 — image transformer | 43 | 24 | 7 | **0** |
| PR #7 — KittyServer routes | 40 | 32 | 7 | **0** |
| PR #8 — GitHub tracker | 37 | 24 | 7 | **0** |
| PR #9 — autoBlogger | 40 | 31 | 7 | **0** |
| PR #10 — mutex store | 33 | 26 | 7 | **0** |
| PR #11 — token store | 38 | 32 | 8 | **0** |
| PR #12 — trusted-sites store | 36 | 32 | 7 | **0** |

The counts are per **independent** branch, not a cumulative merge. Existing unchanged legacy violations appear in totals; they are not regressions. No source changes were made to those PRs by this audit.

[GitHub Actions audit run](https://github.com/kittyCrypto-gg/server/actions/runs/37952683053) captured all nine scans using the same checker running from the guardrail branch.

## CI enforcement

`bun run validate` invokes `bun run check:structure` between TypeScript checking and unit tests. The structure check exits with a nonzero status if any changed or newly added source module contains a nested `if`/`switch`, or exceeds 500 lines.

The unmodified legacy files are matched by SHA-1 Git object IDs in `scripts/check-source-structure.mts`. They cannot acquire additional violations or grow without failing the check: **changing the file requires cleaning all its remaining violations**.

The checker has Bun regression tests for nested `if`, nested `switch`, `else if`, permitted ternaries/guards, line-count boundaries, and immutable exemptions.

**Remaining tasks before merge:** Complete cumulative integration tests of the independent refactor PRs, and verify all downstream consumers. The source-structure audit is not a substitute for functional verification.
