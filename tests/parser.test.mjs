import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildReviewModel,
  makeDemoReview,
  parseCsv,
  parseIbkrStatements,
} from "../lib/ibkr.js";
import { csvCell } from "../lib/export.js";

const fixtureUrl = new URL("../fixtures/demo-activity.csv", import.meta.url);

test("parseCsv handles quoted commas, quotes, CRLF, and blank lines", () => {
  const rows = parseCsv('A,B,C\r\n1,"two, too","said ""hi"""\r\n\r\n');

  assert.deepEqual(rows, [
    ["A", "B", "C"],
    ["1", "two, too", 'said "hi"'],
  ]);
});

test("parseCsv rejects pathological row, column, and cell shapes", () => {
  assert.throws(() => parseCsv("a\nb", { maxRows: 1 }), /row limit/);
  assert.throws(() => parseCsv("a,b", { maxColumns: 1 }), /column limit/);
  assert.throws(() => parseCsv("abcd", { maxCellCharacters: 3 }), /character limit/);
});

test("csvCell neutralizes spreadsheet formulas after whitespace or control characters", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell(" \t+1+1"), "' \t+1+1");
  assert.equal(csvCell("\u0000@SUM(A1:A2)"), "'\u0000@SUM(A1:A2)");
  assert.equal(csvCell("ordinary value"), "ordinary value");
});

test("parseIbkrStatements maps IBKR sections and suppresses duplicate data rows", async () => {
  const csv = await readFile(fixtureUrl, "utf8");
  const parsed = parseIbkrStatements(csv, { fileNames: ["demo-activity.csv"] });

  assert.deepEqual(parsed.source.fileNames, ["demo-activity.csv"]);
  assert.equal(parsed.sections.Trades.length, 3);
  assert.equal(parsed.normalized.trades.length, 3);
  assert.equal(parsed.normalized.dividends.length, 1);
  assert.equal(parsed.normalized.withholdingTaxes.length, 1);
  assert.equal(parsed.normalized.interest.length, 1);
  assert.equal(parsed.normalized.openPositions.length, 1);
  assert.equal(parsed.normalized.transfers.length, 1);
  assert.equal(parsed.duplicates.length, 1);
  assert.equal(parsed.normalized.trades[0].symbol, "AAPL");
  assert.equal(parsed.normalized.trades[1].realizedProfitLoss, 149);
});

test("buildReviewModel returns the browser-friendly review contract", async () => {
  const csv = await readFile(fixtureUrl, "utf8");
  const review = buildReviewModel(parseIbkrStatements(csv, { fileNames: ["demo-activity.csv"] }));

  assert.deepEqual(Object.keys(review.summary), [
    "files",
    "trades",
    "positions",
    "dividends",
    "withholding",
    "interest",
    "transfers",
    "duplicateRowsSuppressed",
  ]);
  assert.equal(review.summary.files, 1);
  assert.equal(review.summary.trades, 3);
  assert.equal(review.summary.duplicateRowsSuppressed, 1);
  assert.equal(review.schedules.capitalGains.length, 1);
  assert.equal(review.schedules.capitalGains[0].quantitySold, 5);
  assert.equal(review.schedules.fsi.length, 2);
  assert.equal(review.schedules.tr.length, 1);
  assert.equal(review.schedules.fa.length, 1);
  assert.deepEqual(review.source.fileNames, ["demo-activity.csv"]);
  assert.equal(review.assumptions.status, "missing");
  assert.equal(review.assumptions.fxRates.length, 0);
  assert.equal("legacySchedules" in review, false);
  assert.equal("findings" in review, false);
});

test("review exchange-rate assumptions exclude raw source rows", () => {
  const csv = [
    "Exchange Rates,Header,Date,Currency,Rate To INR,Note",
    "Exchange Rates,Data,2026-01-31,USD,86.5,sensitive free-form note",
  ].join("\n");
  const review = buildReviewModel(parseIbkrStatements(csv));

  assert.deepEqual(review.assumptions.fxRates, [
    { date: "2026-01-31", currency: "USD", rateToInr: 86.5 },
  ]);
});

test("review validations conservatively flag missing FX and manual-review events", async () => {
  const csv = await readFile(fixtureUrl, "utf8");
  const review = buildReviewModel(parseIbkrStatements(csv, { fileNames: ["demo-activity.csv"] }));
  const codes = review.validations.map((validation) => validation.code).sort();

  assert.ok(codes.includes("MISSING_FX"));
  assert.ok(codes.includes("UNSUPPORTED_ASSET_CLASS"));
  assert.ok(codes.includes("TRANSFERS_PRESENT"));
  assert.ok(codes.includes("CORPORATE_ACTIONS_PRESENT"));
  assert.ok(codes.includes("DUPLICATE_ROWS_SUPPRESSED"));
  assert.ok(review.validations.some((validation) => validation.severity === "warning"));
});

test("makeDemoReview uses synthetic data and includes warning coverage", () => {
  const review = makeDemoReview();

  assert.equal(review.source.fileNames[0], "demo-activity.csv");
  assert.equal(review.summary.trades, 3);
  assert.ok(review.validations.some((validation) => validation.code === "MISSING_FX"));
});
