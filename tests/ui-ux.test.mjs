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

test("step navigation moves focus to the step that remains active after routing", () => {
  assert.match(
    app,
    /const requestedStep = button\.dataset\.stepTarget \?\? button\.dataset\.goStep;[\s\S]*?selectStep\(requestedStep\);[\s\S]*?focusWorkspaceStep\(state\.currentStep\);/,
  );
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

test("Schedule FA A3 portal export is gated by metadata and exact row evidence", () => {
  assert.match(html, /Schedule FA A3 portal CSV/);
  assert.match(html, /data-fa-a3-portal-status/);
  assert.match(html, /data-export="fa-a3"/);
  assert.match(app, /buildScheduleFaA3Csv/);
  assert.match(app, /ScheduleFaA3CsvValidationError/);
  assert.match(app, /state\.faA3Metadata = \{\}/);
  assert.match(app, /countryNameAndCode/);
  assert.match(app, /2-UNITED STATES OF AMERICA/);
  assert.match(app, /row\?\.filingEntityId/);
  assert.match(app, /filing-entity-/);
  assert.match(app, /display-entity-/);
  assert.doesNotMatch(app, /row\?\.company\?\.cik \|\| ""/);
  assert.match(app, /maxLength:\s*35/);
  assert.match(
    app,
    /Use the portal-ready entity address, shortened to 35 characters only when necessary\./,
  );
  assert.match(app, /maxLength:\s*8/);
  assert.match(app, /Portal ZIP Code accepts up to 8 characters\./);
  assert.match(app, /zipCode:\s*8/);
  assert.match(
    app,
    /totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod:\s*row\.saleRedemptionProceedsInr/,
  );
  assert.match(app, /row\.saleRedemptionProceedsInr/);
  assert.match(app, /opentax-ledger-schedule-fa-a3\.csv/);
  assert.match(app, /aria-invalid/);
  assert.match(app, /focus\(\{ preventScroll: false \}\)/);
});

test("Schedule FA review includes a compact A3 acquisition-lot preview", () => {
  assert.match(app, /const faA3Rows = schedules\.faA3 \?\? \[\]/);
  assert.match(app, /A3 acquisition-lot preview/);
  assert.match(app, /Lot date/);
  assert.match(app, /Gross paid\/credited INR/);
  assert.match(app, /value:\s*\(row\) => row\.saleRedemptionProceedsInr/);
  assert.match(app, /Sale proceeds INR/);
  assert.match(app, /renderPreviewTable\(faA3Rows/);
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
  assert.match(styles, /\.schedule-fa-a3-fields input\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.schedule-fa-a3-fields\s*\{[^}]*grid-template-columns:\s*1fr;/,
  );
});

test("the static GitHub Pages client refuses to process files inside a frame", () => {
  assert.match(app, /window\.top === window\.self/);
  assert.match(app, /Open this tax workspace directly/);
  assert.match(app, /will not process financial files while embedded/);
  assert.match(styles, /\.frame-block\s*\{/);
});
