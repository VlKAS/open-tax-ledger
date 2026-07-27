import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/refresh-reference-data.yml",
  import.meta.url,
);
const checkoutSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNodeSha = "820762786026740c76f36085b0efc47a31fe5020";

test("daily updater refreshes both sources and opens a review PR", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^name: Refresh reference data$/m);
  assert.match(workflow, /^\s*schedule:\n\s*#.*\n\s*- cron: "37 3 \* \* \*"$/m);
  assert.match(workflow, /^\s*workflow_dispatch:$/m);
  assert.match(workflow, /id: refresh-data/);
  assert.match(workflow, /run: npm run data:refresh:ci/);
  assert.match(workflow, /run: npm run check/);
  assert.match(
    workflow,
    /SEC_STATUS: \$\{\{ steps\.refresh-data\.outputs\.sec-status \}\}/,
  );
  assert.match(workflow, /SEC-status: \$SEC_STATUS/);
  assert.match(workflow, /SEC company metadata status: \*\*\$SEC_STATUS\*\*/);
  assert.match(workflow, /never uses a proxy or mirror/);
  assert.match(workflow, /UPDATE_BRANCH: automation\/reference-data-refresh/);
  assert.match(workflow, /gh pr (?:create|edit)/);
  assert.match(workflow, /This automation never merges its own pull request/);
  assert.doesNotMatch(workflow, /refs\/heads\/main/);
});

test("daily updater pins actions and scopes write permissions to its job", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(
    workflow,
    /refresh:[\s\S]*?permissions:\n\s+contents: write\n\s+pull-requests: write[\s\S]*?steps:/,
  );
  assert.match(workflow, new RegExp(`uses: actions/checkout@${checkoutSha}`));
  assert.match(workflow, new RegExp(`uses: actions/setup-node@${setupNodeSha}`));
  assert.doesNotMatch(workflow, /uses:\s+\S+@v\d/);
  assert.doesNotMatch(workflow, /uses:\s+peter-evans|^\s*gh pr merge\b/m);
});
