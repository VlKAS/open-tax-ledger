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
  assert.equal(parsed.normalized.transfers.length, 0);
  assert.equal(parsed.normalized.cashMovements.length, 1);
  assert.equal(parsed.duplicates.length, 1);
  assert.equal(parsed.normalized.trades[0].symbol, "AAPL");
  assert.equal(parsed.normalized.trades[1].realizedProfitLoss, 149);
  assert.deepEqual(parsed.normalized.statements[0], {
    fileIndex: 0,
    fileName: "demo-activity.csv",
    account: "DU1234567",
    baseCurrency: "USD",
    period: "2025-04-01 - 2026-03-31",
    periodStart: "2025-04-01",
    periodEnd: "2026-03-31",
  });
  assert.deepEqual(parsed.normalized.trades[0].source, {
    fileIndex: 0,
    fileName: "demo-activity.csv",
    rowNumber: 6,
    section: "Trades",
  });
});

test("buildReviewModel returns the browser-friendly review contract", async () => {
  const csv = await readFile(fixtureUrl, "utf8");
  const review = buildReviewModel(parseIbkrStatements(csv, { fileNames: ["demo-activity.csv"] }));

  assert.deepEqual(Object.keys(review.summary), [
    "files",
    "dataRowsReceived",
    "dataRowsAccepted",
    "sections",
    "trades",
    "buyTrades",
    "saleTrades",
    "instruments",
    "positions",
    "rawPositions",
    "dividends",
    "rawDividends",
    "withholding",
    "rawWithholding",
    "interest",
    "transfers",
    "cashMovements",
    "capitalGainRows",
    "faEntities",
    "duplicateRowsSuppressed",
  ]);
  assert.equal(review.summary.files, 1);
  assert.equal(review.summary.dataRowsReceived, 13);
  assert.equal(review.summary.dataRowsAccepted, 12);
  assert.equal(review.summary.sections, 8);
  assert.equal(review.summary.trades, 3);
  assert.equal(review.summary.buyTrades, 2);
  assert.equal(review.summary.saleTrades, 1);
  assert.equal(review.summary.instruments, 2);
  assert.equal(review.summary.positions, 1);
  assert.equal(review.summary.rawPositions, 1);
  assert.equal(review.summary.dividends, 1);
  assert.equal(review.summary.rawDividends, 1);
  assert.equal(review.summary.withholding, 1);
  assert.equal(review.summary.rawWithholding, 1);
  assert.equal(review.summary.interest, 1);
  assert.equal(review.summary.transfers, 0);
  assert.equal(review.summary.cashMovements, 1);
  assert.equal(review.summary.capitalGainRows, 1);
  assert.equal(review.summary.faEntities, 1);
  assert.equal(review.summary.duplicateRowsSuppressed, 1);
  assert.equal(review.schedules.capitalGains.length, 1);
  assert.equal(review.schedules.capitalGains[0].quantitySold, 5);
  assert.equal(review.schedules.capitalGains[0].gainBucket, "STCG");
  assert.equal(review.schedules.fsi.length, 2);
  assert.equal(review.schedules.tr.length, 1);
  assert.equal(review.schedules.fa.length, 1);
  assert.equal(review.schedules.holdings.length, 1);
  assert.deepEqual(review.source.fileNames, ["statement-1.csv"]);
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
  assert.equal(codes.includes("TRANSFERS_PRESENT"), false);
  assert.ok(codes.includes("CORPORATE_ACTIONS_PRESENT"));
  assert.ok(codes.includes("DUPLICATE_ROWS_SUPPRESSED"));
  assert.ok(review.validations.some((validation) => validation.severity === "warning"));
});

test("makeDemoReview uses synthetic data and includes warning coverage", () => {
  const review = makeDemoReview();

  assert.equal(review.source.fileNames[0], "statement-1.csv");
  assert.equal(review.summary.trades, 3);
  assert.ok(review.validations.some((validation) => validation.code === "MISSING_FX"));
});

test("parser excludes summary income rows, WHT reversals, and separates cash movements from transfers", () => {
  const csv = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Account,DU0001",
    "Statement,Data,Base Currency,USD",
    "Statement,Data,Period,\"2025-04-01 - 2025-12-31\"",
    "Dividends,Header,Currency,Date,Description,Amount",
    "Dividends,Data,USD,2025-08-15,\"AAPL CASH DIVIDEND\",10",
    "Dividends,Data,USD,,\"Total\",10",
    "Withholding Tax,Header,Currency,Date,Description,Amount",
    "Withholding Tax,Data,USD,2025-08-15,\"AAPL US TAX WITHHELD\",-2",
    "Withholding Tax,Data,USD,2025-08-16,\"AAPL US TAX REVERSAL\",1",
    "Withholding Tax,Data,USD,,\"Total\",-1",
    "Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount",
    "Deposits & Withdrawals,Data,USD,2025-04-03,\"ACH DEPOSIT\",2500",
    "Transfers,Header,Currency,Date,Description,Amount",
    "Transfers,Data,USD,2025-05-01,\"INTERNAL TRANSFER\",0",
  ].join("\n");

  const parsed = parseIbkrStatements(csv);
  const review = buildReviewModel(parsed);
  const codes = review.validations.map((validation) => validation.code);

  assert.equal(parsed.normalized.rawDividends.length, 2);
  assert.equal(parsed.normalized.dividends.length, 1);
  assert.equal(parsed.normalized.excludedDividends.length, 1);
  assert.equal(parsed.normalized.rawWithholdingTaxes.length, 3);
  assert.equal(parsed.normalized.withholdingTaxes.length, 1);
  assert.equal(parsed.normalized.excludedWithholdingTaxes.length, 2);
  assert.equal(parsed.normalized.cashMovements.length, 1);
  assert.equal(parsed.normalized.transfers.length, 1);
  assert.equal(review.summary.dividends, 1);
  assert.equal(review.summary.rawDividends, 2);
  assert.equal(review.summary.withholding, 1);
  assert.equal(review.summary.rawWithholding, 3);
  assert.equal(review.summary.cashMovements, 1);
  assert.equal(review.summary.transfers, 1);
  assert.ok(codes.includes("DIVIDEND_SUMMARY_ROWS_EXCLUDED"));
  assert.ok(codes.includes("WHT_SUMMARY_ROWS_EXCLUDED"));
  assert.ok(codes.includes("WHT_REVERSALS_EXCLUDED"));
  assert.ok(codes.includes("TRANSFERS_PRESENT"));
});

test("review uses FIFO capital-gain rows and latest statement snapshot for holdings", () => {
  const firstSnapshot = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Account,DU0001",
    "Statement,Data,Base Currency,USD",
    "Statement,Data,Period,\"2025-04-01 - 2025-09-30\"",
    "Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L",
    "Trades,Data,STK,USD,AAPL,2025-05-01 09:30:00,10,100,-1000,-1,1001,0",
    "Trades,Data,STK,USD,AAPL,2025-10-01 09:30:00,-4,120,480,-1,-400,79",
    "Open Positions,Header,Asset Category,Currency,Symbol,Quantity,Cost Basis,Close Price,Value,Unrealized P/L",
    "Open Positions,Data,STK,USD,AAPL,10,1001,110,1100,99",
    "Open Positions,Data,STK,USD,MSFT,2,500,260,520,20",
  ].join("\n");
  const latestSnapshot = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Account,DU0001",
    "Statement,Data,Base Currency,USD",
    "Statement,Data,Period,\"2025-10-01 - 2025-12-31\"",
    "Open Positions,Header,Asset Category,Currency,Symbol,Quantity,Cost Basis,Close Price,Value,Unrealized P/L",
    "Open Positions,Data,STK,USD,AAPL,6,601,130,780,179",
  ].join("\n");

  const parsed = parseIbkrStatements([firstSnapshot, latestSnapshot], {
    fileNames: ["first.csv", "latest.csv"],
  });
  const review = buildReviewModel(parsed, { assessmentYear: "2026-27" });

  assert.equal(parsed.normalized.statements.length, 2);
  assert.equal(parsed.normalized.openPositions.length, 3);
  assert.equal(parsed.normalized.openPositions[0].snapshotDate, "2025-09-30");
  assert.equal(parsed.normalized.openPositions[2].snapshotDate, "2025-12-31");
  assert.equal(review.schedules.capitalGains.length, 1);
  assert.equal(review.schedules.capitalGains[0].quantitySold, 4);
  assert.equal(review.schedules.capitalGains[0].acquisitionDate, "2025-05-01");
  assert.equal(review.schedules.capitalGains[0].saleDate, "2025-10-01");
  assert.equal(review.schedules.holdings.length, 1);
  assert.equal(review.schedules.holdings[0].symbol, "AAPL");
  assert.equal(review.summary.positions, 1);
  assert.equal(review.summary.rawPositions, 3);
  assert.equal(review.summary.faEntities, 2);
  assert.equal(review.stats.scheduleFa.latestSnapshotDate, "2025-12-31");
  const exportedShape = JSON.stringify(review);
  assert.doesNotMatch(exportedShape, /DU0001|first\.csv|latest\.csv/);
  assert.match(exportedShape, /statement-1\.csv/);
});

test("identical open-position values on different statement dates remain separate snapshots", () => {
  const statement = (period) =>
    [
      "Statement,Header,Field Name,Field Value",
      `Statement,Data,Period,"${period}"`,
      "Open Positions,Header,Asset Category,Currency,Symbol,Quantity,Cost Basis,Close Price,Value,Unrealized P/L",
      "Open Positions,Data,STK,USD,ALFA,1,100,110,110,10",
    ].join("\n");

  const parsed = parseIbkrStatements([
    statement("2025-04-01 - 2025-06-30"),
    statement("2025-07-01 - 2025-09-30"),
  ]);

  assert.equal(parsed.duplicates.length, 0);
  assert.equal(parsed.normalized.rawOpenPositions.length, 2);
  assert.deepEqual(
    parsed.normalized.openPositions.map(({ snapshotDate }) => snapshotDate),
    ["2025-06-30", "2025-09-30"],
  );
});

test("review schedules are scoped to the financial year while FIFO retains earlier buy lots", () => {
  const csv = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Period,\"2024-01-01 - 2026-03-31\"",
    "Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L",
    "Trades,Data,STK,USD,ALFA,2024-01-01 09:30:00,2,100,-200,0,200,0",
    "Trades,Data,STK,USD,ALFA,2025-03-31 09:30:00,-1,110,110,0,-100,10",
    "Trades,Data,STK,USD,ALFA,2025-04-01 09:30:00,-1,120,120,0,-100,20",
    "Dividends,Header,Currency,Date,Description,Amount",
    "Dividends,Data,USD,2025-03-31,\"ALFA CASH DIVIDEND\",1",
    "Dividends,Data,USD,2025-04-01,\"ALFA CASH DIVIDEND\",2",
    "Withholding Tax,Header,Currency,Date,Description,Amount",
    "Withholding Tax,Data,USD,2025-03-31,\"ALFA US TAX\",-0.1",
    "Withholding Tax,Data,USD,2025-04-01,\"ALFA US TAX\",-0.2",
  ].join("\n");

  const review = buildReviewModel(parseIbkrStatements(csv), {
    assessmentYear: "2026-27",
  });

  assert.deepEqual(review.financialYear, {
    start: "2025-04-01",
    end: "2026-03-31",
  });
  assert.equal(review.schedules.capitalGains.length, 1);
  assert.equal(review.schedules.capitalGains[0].saleDate, "2025-04-01");
  assert.equal(review.schedules.capitalGains[0].acquisitionDate, "2024-01-01");
  assert.equal(review.summary.dividends, 1);
  assert.equal(review.summary.withholding, 1);
});

test("malformed numeric fields fail closed instead of becoming zero-valued tax rows", () => {
  const csv = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Period,\"2025-04-01 - 2026-03-31\"",
    "Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L",
    "Trades,Data,STK,USD,ALFA,2025-05-01 09:30:00,not-a-number,100,-100,0,100,0",
    "Dividends,Header,Currency,Date,Description,Amount",
    "Dividends,Data,USD,2025-08-01,\"ALFA CASH DIVIDEND\",missing",
    "Withholding Tax,Header,Currency,Date,Description,Amount",
    "Withholding Tax,Data,USD,2025-08-01,\"ALFA US TAX\",--2",
    "Interest,Header,Currency,Date,Description,Amount",
    "Interest,Data,USD,2025-08-01,\"CREDIT INTEREST\",",
    "Open Positions,Header,Asset Category,Currency,Symbol,Quantity,Cost Basis,Close Price,Value,Unrealized P/L",
    "Open Positions,Data,STK,USD,ALFA,1,100,110,invalid,10",
    "Transfers,Header,Currency,Date,Description,Amount",
    "Transfers,Data,USD,2025-08-01,\"INTERNAL TRANSFER\",invalid",
  ].join("\n");

  const parsed = parseIbkrStatements(csv);
  const review = buildReviewModel(parsed);
  const codes = review.validations.map(({ code }) => code);

  assert.equal(parsed.normalized.trades.length, 0);
  assert.equal(parsed.normalized.rawDividends.length, 1);
  assert.equal(parsed.normalized.dividends.length, 0);
  assert.equal(parsed.normalized.rawWithholdingTaxes.length, 1);
  assert.equal(parsed.normalized.withholdingTaxes.length, 0);
  assert.equal(parsed.normalized.interest.length, 0);
  assert.equal(parsed.normalized.rawOpenPositions.length, 1);
  assert.equal(parsed.normalized.openPositions.length, 0);
  assert.equal(parsed.normalized.transfers.length, 0);
  assert.ok(codes.includes("INVALID_NUMERIC_VALUE"));
  assert.ok(codes.includes("MISSING_NUMERIC_VALUE"));
  assert.equal(review.totals.dividends, 0);
  assert.equal(review.totals.withholdingTax, 0);
  assert.equal(review.totals.openPositionValue, 0);
});

test("review validation details never expose imported filenames, accounts, or raw rows", () => {
  const csv = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Account,PRIVATE-ACCOUNT",
    "Statement,Data,Period,\"2025-04-01 - 2026-03-31\"",
    "Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L",
    "Trades,Data,OPT,USD,ALFA OPTION,2025-05-01 09:30:00,1,10,-10,0,10,0",
  ].join("\n");

  const review = buildReviewModel(
    parseIbkrStatements(csv, {
      fileNames: ["taxpayer-name-and-id.csv"],
    }),
  );
  const serialized = JSON.stringify(review);

  assert.doesNotMatch(serialized, /taxpayer-name-and-id|PRIVATE-ACCOUNT/);
  assert.match(serialized, /"fileIndex":0/);
  assert.match(serialized, /"rowNumber":5/);
  assert.match(serialized, /"section":"Trades"/);
});
