import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarYearForAssessmentYear,
  deriveScheduleFa,
} from "../lib/schedule-fa.js";

function trade(overrides) {
  return {
    assetCategory: "STK",
    symbol: "AAPL",
    currency: "USD",
    date: "2025-01-15",
    quantity: 1,
    proceeds: -100,
    commission: 0,
    basis: 100,
    source: { fileIndex: 0, rowNumber: 1 },
    ...overrides,
  };
}

function position(overrides) {
  return {
    assetCategory: "STK",
    symbol: "AAPL",
    currency: "USD",
    quantity: 1,
    value: 100,
    source: { fileIndex: 0, rowNumber: 1 },
    ...overrides,
  };
}

test("derives calendar year from assessment year", () => {
  assert.equal(calendarYearForAssessmentYear("2026-27"), 2025);
});

test("returns null calendar year for invalid assessment year", () => {
  assert.equal(calendarYearForAssessmentYear("AY 2026-27"), null);
});

test("counts each security once while preserving latest statement holdings", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({ symbol: "AAPL", date: "2025-01-15", quantity: 2, basis: 200 }),
      trade({ symbol: "MSFT", date: "2025-03-10", quantity: 1, basis: 300 }),
    ],
    openPositions: [
      position({ symbol: "AAPL", value: 250, source: { fileIndex: 0, rowNumber: 1 } }),
      position({ symbol: "MSFT", value: 320, source: { fileIndex: 0, rowNumber: 2 } }),
      position({ symbol: "AAPL", value: 275, source: { fileIndex: 1, rowNumber: 1 } }),
    ],
    statements: [
      { fileIndex: 0, periodEnd: "2025-06-30" },
      { fileIndex: 1, periodEnd: "2025-12-31" },
    ],
  });

  assert.equal(result.audit.entityCount, 2);
  assert.equal(result.audit.rawPositionRows, 3);
  assert.equal(result.audit.latestSnapshotDate, "2025-12-31");
  assert.equal(result.audit.latestHoldingRows, 1);
  assert.deepEqual(result.holdings.map((row) => row.symbol), ["AAPL"]);
});

test("uses exact calendar-year-end position as closing value", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [trade({ symbol: "AAPL", quantity: 1, basis: 100 })],
    openPositions: [
      position({ symbol: "AAPL", value: 125, source: { fileIndex: 0, rowNumber: 1 } }),
      position({ symbol: "AAPL", value: 175, source: { fileIndex: 1, rowNumber: 1 } }),
    ],
    statements: [
      { fileIndex: 0, periodEnd: "2025-09-30" },
      { fileIndex: 1, periodEnd: "2025-12-31" },
    ],
  });

  assert.equal(result.entities[0].closingDate, "2025-12-31");
  assert.equal(result.entities[0].closingValue, 175);
  assert.equal(result.entities[0].closingStatus, "exact-period-end");
});

test("marks nearest prior closing value when year-end position is missing", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [trade({ symbol: "AAPL", quantity: 1, basis: 100 })],
    openPositions: [
      position({ symbol: "AAPL", value: 125, source: { fileIndex: 0, rowNumber: 1 } }),
    ],
    statements: [{ fileIndex: 0, periodEnd: "2025-11-30" }],
  });

  assert.equal(result.entities[0].closingDate, "2025-11-30");
  assert.equal(result.entities[0].closingStatus, "nearest-prior-snapshot");
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "FA_CLOSING_VALUE_EVIDENCE_LIMITED",
    ),
  );
});

test("includes securities acquired before calendar year end", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({ symbol: "AAPL", date: "2025-12-31", quantity: 1 }),
      trade({ symbol: "MSFT", date: "2026-01-01", quantity: 1 }),
    ],
  });

  assert.deepEqual(result.entities.map((entity) => entity.symbol), ["AAPL"]);
});

test("includes possible passive holdings as review-only when calendar-year snapshots are missing", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        symbol: "MSFT",
        date: "2026-01-15",
        quantity: 1,
      }),
    ],
    openPositions: [
      position({
        symbol: "AAPL",
        snapshotDate: "2026-03-31",
        value: 125,
      }),
      position({
        symbol: "MSFT",
        snapshotDate: "2026-03-31",
        value: 300,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
    ],
  });

  assert.deepEqual(result.entities.map((entity) => entity.symbol), ["AAPL"]);
  assert.equal(result.entities[0].closingStatus, "missing-evidence");
  assert.equal(result.audit.reviewOnlyEntityCount, 1);
  assert.equal(result.audit.calendarYearEvidenceComplete, false);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "FA_CALENDAR_YEAR_EVIDENCE_INCOMPLETE",
    ),
  );
});

test("derives dividend and proceeds evidence per entity", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({ symbol: "AAPL", date: "2025-01-15", quantity: 2, basis: 200 }),
      trade({
        symbol: "AAPL",
        date: "2025-06-15",
        quantity: -1,
        proceeds: 150,
        basis: -100,
      }),
    ],
    dividends: [
      { date: "2025-08-01", description: "AAPL CASH DIVIDEND", amount: 12.345 },
      { date: "2025-08-01", description: "MSFT CASH DIVIDEND", amount: 99 },
    ],
  });

  assert.equal(result.entities[0].grossDividends, 12.35);
  assert.equal(result.entities[0].grossProceeds, 150);
  assert.equal(result.entities[0].evidence.dividendRows, 1);
});
