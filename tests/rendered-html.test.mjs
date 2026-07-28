import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {},
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the complete privacy-first product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'none'/);

  const html = await response.text();
  assert.match(html, /<title>OpenTax Ledger/i);
  assert.match(html, /http-equiv="Content-Security-Policy"/i);
  assert.match(html, /connect-src 'none'/i);
  assert.match(html, /Your statements never leave this browser/i);
  assert.match(html, /Import/);
  assert.match(html, /Configure/);
  assert.match(html, /Review/);
  assert.match(html, /Export/);
  assert.match(html, /Automatic Rule 115 date summary/);
  assert.match(html, /statutory date is retained/i);
  assert.match(html, /latest available SBI observation\s+on or before/i);
  assert.match(html, /31\.2% · 30% plus 4% cess/);
  assert.match(html, /Section 90 · treaty relief/);
  assert.match(html, /Section 91 · unilateral relief/);
  assert.match(html, /data-review-tab="audit"/);
  assert.match(html, /aria-controls="review-tab-panel"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /FTC candidate/);
  assert.match(html, /data-action="confirm-review"/);
  assert.match(html, /I reviewed this preview · continue to downloads/);
  assert.doesNotMatch(html, /data-rate-lookup-date|data-action="lookup-rate"/);
  assert.match(html, /Not tax advice/i);
  assert.match(html, /SBI FX RateKeeper community archive/i);
  assert.match(html, /SEC EDGAR ticker associations/i);
  assert.match(html, /href="https:\/\/github\.com\/VlKAS\/open-tax-ledger"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("static client assets are safe under a GitHub Pages project subpath", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../dist/client/app.mjs", import.meta.url), "utf8");
  const referenceData = await readFile(
    new URL("../dist/client/lib/reference-data.js", import.meta.url),
    "utf8",
  );
  const rule115 = await readFile(
    new URL("../dist/client/lib/rule115.js", import.meta.url),
    "utf8",
  );
  const rates = await readFile(
    new URL("../dist/client/data/sbi-usd-tt-buy-community.csv", import.meta.url),
    "utf8",
  );

  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.mjs"/);
  assert.match(html, /href="\.\/data\/sbi-usd-tt-buy-community\.csv"/);
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/);
  assert.match(app, /from "\.\/lib\/ibkr\.js"/);
  assert.match(app, /from "\.\/lib\/reference-data\.generated\.js"/);
  assert.doesNotMatch(app, /from "\/lib\//);
  assert.match(app, /step === "export" && !state\.reviewConfirmed/);
  assert.match(app, /Review the converted schedules before downloading\./);
  assert.match(app, /state\.parsed = parsed/);
  assert.match(app, /function rebuildReviewFromBase/);
  assert.match(app, /buildReviewModel\(state\.parsed,\s*\{\s*assessmentYear/s);
  assert.match(app, /discardParsedReviewForFileChange/);
  assert.match(app, /MAX_PREVIEW_ROWS = 200/);
  assert.match(app, /conversionCandidateObservations/);
  assert.match(app, /Country-wise FTC preview/);
  assert.match(app, /Latest Holdings/);
  assert.match(app, /faConversionSummary/);
  assert.match(app, /matched rows/);
  assert.match(app, /distinct statutory dates/);
  assert.match(app, /function renderAuditTab/);
  assert.match(app, /Data rows received/);
  assert.match(app, /Source-to-output row checks/);
  assert.match(app, /FIFO lot matching is applied/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(referenceData, /lookupUsdTtBuyRateOnOrBefore/);
  assert.match(referenceData, /selection:\s*"prior-observation"/);
  assert.match(referenceData, /exactDateOnly:\s*match\.selection === "exact"/);
  assert.match(rule115, /lastDayOfPreviousMonth/);
  assert.match(rule115, /indianFinancialYearEnd/);
  assert.match(rates, /^DATE,TT BUY,SOURCE URL/m);
});

test("worker serves assets and blocks unsupported methods", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-assets`);
  const { default: worker } = await import(workerUrl.href);

  const script = await worker.fetch(new Request("http://localhost/app.mjs"), {});
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);

  const rejected = await worker.fetch(
    new Request("http://localhost/", { method: "POST" }),
    {},
  );
  assert.equal(rejected.status, 405);
});
