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

test("review rebuilds from source data when assumptions or rates change", () => {
  assert.match(html, /31\.2% · 30% plus 4% cess/);
  assert.match(html, /Section 90 · treaty relief/);
  assert.match(app, /parsed:\s*null/);
  assert.match(app, /baseReview:\s*null/);
  assert.match(app, /function rebuildReviewFromBase/);
  assert.match(app, /state\.baseReview = buildReviewModel\(state\.parsed/s);
  assert.match(app, /state\.review = state\.baseReview \? withReferenceData\(state\.baseReview\) : null/);
});

test("review explains parity-sensitive tax and audit counts", () => {
  assert.match(app, /rawDividends/);
  assert.match(app, /rawWithholding/);
  assert.match(app, /summary\/reversal rows excluded/);
  assert.match(app, /Cash movements/);
  assert.match(app, /FA entities/);
  assert.match(app, /Country-wise FTC preview/);
  assert.match(app, /Incomplete country-wise FTC preview/);
  assert.match(app, /taxSummary\.coverage\.complete/);
  assert.match(app, /Observation used/);
  assert.match(app, /Latest Holdings/);
  assert.match(app, /Computed FIFO gain/);
  assert.match(app, /not separate buy\/sell leg FX/);
  assert.match(app, /Expected FIFO split/);
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

test("the static GitHub Pages client refuses to process files inside a frame", () => {
  assert.match(app, /window\.top === window\.self/);
  assert.match(app, /Open this tax workspace directly/);
  assert.match(app, /will not process financial files while embedded/);
  assert.match(styles, /\.frame-block\s*\{/);
});
