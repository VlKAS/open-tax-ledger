import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/pages.yml", import.meta.url);
const actions = {
  checkout: "3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNode: "820762786026740c76f36085b0efc47a31fe5020",
  configurePages: "45bfe0192ca1faeb007ade9deae92b16b8254a0d",
  uploadPagesArtifact: "fc324d3547104276b827a68afc52ff2a11cc49c9",
  deployPages: "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
};

test("GitHub Pages workflow builds and deploys the static client", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^name: Deploy GitHub Pages$/m);
  assert.match(workflow, /^\s*push:\n\s*branches: \[main\]$/m);
  assert.match(workflow, /^\s*workflow_dispatch:$/m);
  assert.match(workflow, /group: github-pages/);
  assert.match(workflow, new RegExp(`uses: actions/checkout@${actions.checkout}`));
  assert.match(workflow, new RegExp(`uses: actions/setup-node@${actions.setupNode}`));
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run check/);
  assert.match(
    workflow,
    new RegExp(`uses: actions/configure-pages@${actions.configurePages}`),
  );
  assert.match(
    workflow,
    new RegExp(`uses: actions/upload-pages-artifact@${actions.uploadPagesArtifact}`),
  );
  assert.match(workflow, /path: \.\/dist\/client/);
  assert.match(
    workflow,
    new RegExp(`uses: actions/deploy-pages@${actions.deployPages}`),
  );
  assert.match(workflow, /name: github-pages/);
  assert.match(workflow, /url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}/);
});

test("GitHub Pages workflow keeps permissions scoped by job", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(
    workflow,
    /build:[\s\S]*?permissions:\n\s+contents: read[\s\S]*?steps:/,
  );
  assert.match(
    workflow,
    /deploy:[\s\S]*?permissions:\n\s+pages: write\n\s+id-token: write[\s\S]*?environment:/,
  );
  assert.doesNotMatch(workflow, /^\s*contents: write$/m);
  assert.doesNotMatch(workflow, /uses:\s+\S+@v\d/);
});
