import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [html, app, styles] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
]);

test("workspace exposes direct, keyboard-focusable review actions", () => {
  assert.match(html, /data-action="open-audit"/);
  assert.match(html, /Import IBKR statements/);
  assert.match(app, /setReviewTab\("audit"\)/);
  assert.match(app, /focusWorkspaceStep\("review"\)/);
  assert.match(app, /focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /focusWorkspaceStep\("export"\)/);
});

test("audit details use native disclosure controls", () => {
  assert.match(app, /<details class="audit-section-card audit-disclosure">/);
  assert.match(app, /<summary>/);
  assert.match(app, /Show 8 rules/);
  assert.match(app, /Show session details/);
  assert.match(styles, /\.audit-disclosure summary\s*\{/);
});

test("review controls retain touch targets and narrow-screen stacking", () => {
  assert.match(
    styles,
    /\.review-tabs button\s*\{[^}]*min-height:\s*44px;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.audit-disclosure summary\s*\{[^}]*flex-direction:\s*column;/,
  );
});
