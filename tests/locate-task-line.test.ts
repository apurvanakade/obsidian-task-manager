/**
 * Purpose:
 * - tests for locateTaskLine(), the resolver that maps a captured task-line index back
 *   onto the right line after the file has shifted underneath it.
 *
 * Run with `npm test` (tsx). No test framework — plain node:assert/strict, matching
 * repeat-rules.test.ts.
 */
import { strict as assert } from "node:assert";
import { locateTaskLine } from "../src/tasks/task-utils";

let passed = 0;
let failed = 0;

function check(label: string, actual: number | null, expected: number | null): void {
  try {
    assert.equal(actual, expected);
    passed += 1;
  } catch (error) {
    failed += 1;
    console.error(`FAIL [${label}]:`, (error as Error).message);
  }
}

const TARGET = "- [ ] Call the plumber";
const OTHER = "- [ ] Buy stamps";

// The plain case: nothing moved.
check(
  "unshifted content resolves to the captured index",
  locateTaskLine(["---", "status: todo", "---", TARGET, OTHER], 3, TARGET),
  3,
);

// The regression: stampDerivedFrontmatter() deleted a `next-due:` line while the modal
// was open, so every task line moved up one. The captured index now points at the *next*
// open task — which is exactly what used to receive the due date.
check(
  "a deleted frontmatter line above the task does not divert onto the following task",
  locateTaskLine(["---", "status: todo", "---", TARGET, OTHER], 4, TARGET),
  3,
);

// The mirror image: frontmatter fields were added, pushing the task down.
check(
  "added frontmatter lines above the task are followed",
  locateTaskLine(["---", "status: todo", "next-due: 2026-09-01", "---", TARGET, OTHER], 3, TARGET),
  4,
);

// Inline fields rewritten while the modal sat open — body match still finds it.
check(
  "a task whose inline fields changed is matched on its body",
  locateTaskLine(["---", "---", "- [ ] Call the plumber [due:: 2026-09-01]"], 2, TARGET),
  2,
);

// Checked off in the meantime: a due date no longer belongs on it.
check(
  "a task completed while the modal was open is not matched",
  locateTaskLine(["---", "---", "- [x] Call the plumber [completion-date:: 2026-08-23]"], 2, TARGET),
  null,
);

check(
  "a task that vanished entirely resolves to null",
  locateTaskLine(["---", "status: todo", "---", OTHER], 3, TARGET),
  null,
);

// Two byte-identical task lines: the nearer one to the captured index wins.
check(
  "duplicate task lines resolve to the occurrence nearest the captured index",
  locateTaskLine([TARGET, OTHER, OTHER, OTHER, TARGET], 4, TARGET),
  4,
);
check(
  "duplicate task lines resolve to the occurrence nearest the captured index (upper)",
  locateTaskLine([TARGET, OTHER, OTHER, OTHER, TARGET], 1, TARGET),
  0,
);

// An out-of-range captured index (file truncated) still resolves by identity.
check(
  "an out-of-range captured index still resolves by identity",
  locateTaskLine(["---", "---", TARGET], 99, TARGET),
  2,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
