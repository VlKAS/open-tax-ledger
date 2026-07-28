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

test("matches Schedule FA dividends by normalized symbol when descriptions contain ISINs", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [trade({ symbol: "AAPL", date: "2025-01-15", quantity: 2, basis: 200 })],
    dividends: [
      {
        symbol: "AAPL",
        date: "2025-08-01",
        description: "Apple Inc. (US0378331005) CASH DIVIDEND",
        amount: 12.34,
      },
      {
        symbol: "MSFT",
        date: "2025-08-01",
        description: "Microsoft Corp. (US5949181045) CASH DIVIDEND",
        amount: 99,
      },
    ],
  });

  assert.equal(result.entities[0].grossDividends, 12.34);
  assert.equal(result.entities[0].evidence.dividendRows, 1);
});

test("aggregates multi-lot initial value and derives zero closing value after full disposal", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2024-10-01",
        quantity: 1,
        proceeds: -100,
        basis: 100,
        source: { fileIndex: 0, rowNumber: 1 },
      }),
      trade({
        date: "2025-02-01",
        quantity: 1,
        proceeds: -200,
        basis: 200,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
      trade({
        date: "2025-09-01",
        quantity: -2,
        proceeds: 350,
        basis: -300,
        source: { fileIndex: 0, rowNumber: 3 },
      }),
    ],
    openPositions: [
      position({
        symbol: "MSFT",
        snapshotDate: "2025-12-31",
        quantity: 1,
        value: 250,
      }),
    ],
  });
  const disposed = result.entities.find((entity) => entity.symbol === "AAPL");

  assert.equal(result.entities.length, 2);
  assert.equal(disposed.acquisitionDate, "2024-10-01");
  assert.equal(disposed.initialValue, 300);
  assert.equal(disposed.initialValueStatus, "review-acquisition-basis");
  assert.equal(disposed.closingDate, "2025-12-31");
  assert.equal(disposed.closingQuantity, 0);
  assert.equal(disposed.closingValue, 0);
  assert.equal(disposed.closingStatus, "derived-full-disposal");
  assert.equal(disposed.grossProceeds, 350);
  assert.equal(disposed.evidence.buyRows, 2);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "FA_INITIAL_VALUE_AGGREGATION_REVIEW",
    ),
  );
});

test("does not infer a zero Schedule FA closing value from an unanchored trade subset", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2025-02-01",
        quantity: 1,
        proceeds: -100,
        basis: 100,
      }),
      trade({
        date: "2025-09-01",
        quantity: -1,
        proceeds: 120,
        basis: -100,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
    ],
  });

  assert.equal(result.entities[0].closingValue, null);
  assert.equal(result.entities[0].closingQuantity, null);
  assert.equal(result.entities[0].closingStatus, "missing-evidence");
});

test("does not infer full disposal from a prior snapshot without year-end coverage", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2025-07-01",
        quantity: -1,
        proceeds: 120,
        basis: -100,
      }),
    ],
    openPositions: [
      position({
        snapshotDate: "2025-06-30",
        quantity: 1,
        value: 100,
      }),
    ],
  });

  assert.equal(result.entities[0].closingValue, 100);
  assert.equal(result.entities[0].closingQuantity, 1);
  assert.equal(result.entities[0].closingStatus, "nearest-prior-snapshot");
});

for (const [label, saleQuantity] of [
  ["partial sale", -1],
  ["inconsistent oversale", -3],
]) {
  test(`${label} after a prior snapshot does not derive a zero closing value`, () => {
    const result = deriveScheduleFa({
      assessmentYear: "2026-27",
      trades: [
        trade({
          date: "2025-07-01",
          quantity: saleQuantity,
          proceeds: 120,
          basis: -100,
        }),
      ],
      openPositions: [
        position({
          snapshotDate: "2025-06-30",
          quantity: 2,
          value: 200,
        }),
        position({
          symbol: "MSFT",
          snapshotDate: "2025-12-31",
          quantity: 1,
          value: 300,
          source: { fileIndex: 0, rowNumber: 2 },
        }),
      ],
    });
    const entity = result.entities.find((row) => row.symbol === "AAPL");

    assert.equal(entity.closingValue, 200);
    assert.equal(entity.closingQuantity, 2);
    assert.equal(entity.closingStatus, "nearest-prior-snapshot");
  });
}

test("excludes acquisition lots fully disposed before the Schedule FA calendar year", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2024-01-01",
        quantity: 1,
        proceeds: -100,
        basis: 100,
        source: { fileIndex: 0, rowNumber: 1 },
      }),
      trade({
        date: "2024-06-01",
        quantity: -1,
        proceeds: 120,
        basis: -100,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
      trade({
        date: "2025-02-01",
        quantity: 1,
        proceeds: -200,
        basis: 200,
        source: { fileIndex: 0, rowNumber: 3 },
      }),
      trade({
        date: "2025-09-01",
        quantity: -1,
        proceeds: 230,
        basis: -200,
        source: { fileIndex: 0, rowNumber: 4 },
      }),
    ],
  });

  assert.equal(result.entities[0].acquisitionDate, "2025-02-01");
  assert.equal(result.entities[0].initialValue, 200);
  assert.equal(result.entities[0].initialValueStatus, "review-acquisition-basis");
  assert.equal(result.entities[0].evidence.buyRows, 1);
});

test("derives Schedule FA filing rows one per acquisition lot overlapping the calendar year", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2024-10-01",
        quantity: 2,
        proceeds: -200,
        basis: 200,
        source: { fileIndex: 0, rowNumber: 1 },
      }),
      trade({
        date: "2025-02-01",
        quantity: 1,
        proceeds: -150,
        basis: 150,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
      trade({
        date: "2025-09-01",
        quantity: -2,
        proceeds: 420,
        basis: -250,
        source: { fileIndex: 0, rowNumber: 3 },
      }),
    ],
    openPositions: [
      position({
        snapshotDate: "2025-06-30",
        quantity: 3,
        value: 390,
      }),
      position({
        snapshotDate: "2025-12-31",
        quantity: 1,
        value: 180,
      }),
    ],
  });

  const entity = result.entities[0];

  assert.equal(result.audit.filingRowCount, 2);
  assert.equal(entity.initialValue, 350);
  assert.equal(entity.evidence.buyRows, 2);
  assert.deepEqual(
    entity.filingRows.map((row) => ({
      acquisitionDate: row.acquisitionDate,
      quantity: row.quantity,
      initialValue: row.initialValue,
      grossAmountPaidOrCredited: row.grossAmountPaidOrCredited,
      saleRedemptionProceeds: row.saleRedemptionProceeds,
      soldQuantity: row.soldQuantity,
      closingValue: row.closingValue,
      closingStatus: row.closingStatus,
    })),
    [
      {
        acquisitionDate: "2024-10-01",
        quantity: 2,
        initialValue: 200,
        grossAmountPaidOrCredited: 420,
        saleRedemptionProceeds: 420,
        soldQuantity: 2,
        closingValue: 0,
        closingStatus: "exact-period-end-allocation",
      },
      {
        acquisitionDate: "2025-02-01",
        quantity: 1,
        initialValue: 150,
        grossAmountPaidOrCredited: 0,
        saleRedemptionProceeds: 0,
        soldQuantity: 0,
        closingValue: 180,
        closingStatus: "exact-period-end-allocation",
      },
    ],
  );
  assert.deepEqual(result.filingRows, entity.filingRows);
});

test("Schedule FA filing rows keep dated sale proceeds events per lot", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2025-01-10",
        quantity: 2,
        proceeds: -200,
        basis: 200,
        source: { fileIndex: 0, rowNumber: 1 },
      }),
      trade({
        date: "2025-02-10",
        quantity: 1,
        proceeds: -150,
        basis: 150,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
      trade({
        date: "2025-09-15",
        quantity: -1,
        proceeds: 130,
        basis: -100,
        source: { fileIndex: 0, rowNumber: 3 },
      }),
      trade({
        date: "2025-11-20",
        quantity: -1.5,
        proceeds: 225,
        basis: -200,
        source: { fileIndex: 0, rowNumber: 4 },
      }),
    ],
  });

  assert.deepEqual(
    result.filingRows.map((row) => ({
      acquisitionDate: row.acquisitionDate,
      saleRedemptionProceeds: row.saleRedemptionProceeds,
      saleEvents: row.saleEvents,
    })),
    [
      {
        acquisitionDate: "2025-01-10",
        saleRedemptionProceeds: 280,
        saleEvents: [
          { date: "2025-09-15", quantity: 1, proceeds: 130 },
          { date: "2025-11-20", quantity: 1, proceeds: 150 },
        ],
      },
      {
        acquisitionDate: "2025-02-10",
        saleRedemptionProceeds: 75,
        saleEvents: [
          { date: "2025-11-20", quantity: 0.5, proceeds: 75 },
        ],
      },
    ],
  );
});

test("Schedule FA filing rows include only prior lots still open in the calendar year", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2024-01-01",
        quantity: 2,
        proceeds: -200,
        basis: 200,
        source: { fileIndex: 0, rowNumber: 1 },
      }),
      trade({
        date: "2024-06-01",
        quantity: -1,
        proceeds: 120,
        basis: -100,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
      trade({
        date: "2025-09-01",
        quantity: -1,
        proceeds: 130,
        basis: -100,
        source: { fileIndex: 0, rowNumber: 3 },
      }),
    ],
  });

  assert.equal(result.filingRows.length, 1);
  assert.equal(result.filingRows[0].acquisitionDate, "2024-01-01");
  assert.equal(result.filingRows[0].quantity, 1);
  assert.equal(result.filingRows[0].initialValue, 100);
  assert.equal(result.filingRows[0].saleRedemptionProceeds, 130);
  assert.equal(result.filingRows[0].initialValueStatus, "review-acquisition-basis");
});

test("Schedule FA filing rows retain passive and dividend-only entities for manual review", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    openPositions: [
      position({
        symbol: "PASSIVE",
        snapshotDate: "2026-03-31",
        quantity: 1,
        value: 125,
      }),
    ],
    dividends: [
      {
        symbol: "ONLYDIV",
        currency: "USD",
        date: "2025-08-01",
        description: "Synthetic issuer dividend",
        amount: 12.34,
      },
    ],
  });

  assert.equal(result.entities.length, 2);
  assert.equal(result.filingRows.length, 2);
  assert.equal(result.audit.filingRowCount, 2);
  assert.deepEqual(
    result.filingRows.map((row) => ({
      symbol: row.symbol,
      acquisitionDate: row.acquisitionDate,
      acquisitionStatus: row.acquisitionStatus,
      initialValue: row.initialValue,
      closingStatus: row.closingStatus,
      buyRows: row.evidence.buyRows,
    })),
    [
      {
        symbol: "ONLYDIV",
        acquisitionDate: "",
        acquisitionStatus: "missing-evidence",
        initialValue: null,
        closingStatus: "missing-evidence",
        buyRows: 0,
      },
      {
        symbol: "PASSIVE",
        acquisitionDate: "",
        acquisitionStatus: "missing-evidence",
        initialValue: null,
        closingStatus: "missing-evidence",
        buyRows: 0,
      },
    ],
  );
});

test("Schedule FA filing row IDs do not expose or collide on stable security identifiers", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    openPositions: [
      position({
        symbol: "DUP",
        conid: "111",
        snapshotDate: "2026-03-31",
        quantity: 1,
        value: 100,
      }),
      position({
        symbol: "DUP",
        conid: "222",
        snapshotDate: "2026-03-31",
        quantity: 1,
        value: 200,
      }),
    ],
  });

  assert.equal(result.filingRows.length, 2);
  assert.equal(
    new Set(result.filingRows.map((row) => row.filingEntityId)).size,
    2,
  );
  assert.equal(
    new Set(result.filingRows.map((row) => row.filingRowId)).size,
    2,
  );
  assert.doesNotMatch(JSON.stringify(result.filingRows), /111|222|conid/i);
});

test("Schedule FA filing rows do not infer zero closing values without reliable year-end coverage", () => {
  const priorSnapshot = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2025-01-01",
        quantity: 1,
        proceeds: -100,
        basis: 100,
      }),
      trade({
        date: "2025-07-01",
        quantity: -1,
        proceeds: 120,
        basis: -100,
      }),
    ],
    openPositions: [
      position({
        snapshotDate: "2025-06-30",
        quantity: 1,
        value: 100,
      }),
    ],
  });

  assert.equal(priorSnapshot.filingRows[0].closingValue, 100);
  assert.equal(priorSnapshot.filingRows[0].closingQuantity, 1);
  assert.equal(
    priorSnapshot.filingRows[0].closingStatus,
    "nearest-prior-snapshot-allocation",
  );

  const inconsistentOversale = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2025-01-01",
        quantity: 1,
        proceeds: -100,
        basis: 100,
      }),
      trade({
        date: "2025-07-01",
        quantity: -2,
        proceeds: 240,
        basis: -200,
      }),
    ],
    openPositions: [
      position({
        symbol: "MSFT",
        snapshotDate: "2025-12-31",
        quantity: 1,
        value: 300,
      }),
    ],
  });
  const oversold = inconsistentOversale.filingRows.find(
    (row) => row.symbol === "AAPL",
  );

  assert.equal(oversold.closingValue, null);
  assert.equal(oversold.closingQuantity, null);
  assert.equal(oversold.closingStatus, "missing-evidence");
  assert.equal(oversold.evidence.unmatchedSale, true);
});

test("Schedule FA filing rows block allocations when imported lots do not reconcile to a position", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        date: "2025-01-01",
        quantity: 2,
        proceeds: -200,
        basis: 200,
      }),
    ],
    openPositions: [
      position({
        snapshotDate: "2025-12-31",
        quantity: 1,
        value: 100,
      }),
    ],
  });

  assert.equal(result.filingRows.length, 1);
  assert.equal(result.filingRows[0].peakValue, null);
  assert.equal(
    result.filingRows[0].peakStatus,
    "position-lot-mismatch-review",
  );
  assert.equal(result.filingRows[0].closingValue, null);
  assert.equal(result.filingRows[0].closingQuantity, null);
  assert.equal(
    result.filingRows[0].closingStatus,
    "position-lot-mismatch-review",
  );
  assert.ok(
    result.findings.some(
      (item) => item.code === "FA_A3_POSITION_LOT_MISMATCH",
    ),
  );
});

test("keeps passive holdings distinct when stable IDs share a display symbol", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    openPositions: [
      position({
        symbol: "DUP",
        conid: "111",
        snapshotDate: "2026-03-31",
        value: 100,
        source: { fileIndex: 0, rowNumber: 1 },
      }),
      position({
        symbol: "DUP",
        conid: "222",
        snapshotDate: "2026-03-31",
        value: 200,
        source: { fileIndex: 0, rowNumber: 2 },
      }),
    ],
  });

  assert.equal(result.holdings.length, 2);
  assert.equal(result.entities.length, 2);
  assert.equal(result.audit.reviewOnlyEntityCount, 2);
  assert.deepEqual(
    result.entities.map((entity) => entity.closingStatus),
    ["missing-evidence", "missing-evidence"],
  );
});

test("does not attach a stable-ID dividend to a different same-symbol entity", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    trades: [
      trade({
        symbol: "ALFA",
        conid: "111",
        date: "2025-02-01",
        quantity: 1,
      }),
    ],
    dividends: [
      {
        symbol: "ALFA",
        conid: "222",
        currency: "USD",
        date: "2025-08-01",
        amount: 10,
      },
    ],
  });
  const tradeEntity = result.entities.find(
    (entity) => entity.evidence.tradeRows === 1,
  );
  const dividendEntity = result.entities.find(
    (entity) => entity.evidence.dividendRows === 1,
  );

  assert.equal(result.entities.length, 2);
  assert.equal(tradeEntity.grossDividends, 0);
  assert.equal(dividendEntity.grossDividends, 10);
});

test("includes dividend-only securities as review-only Schedule FA entities", () => {
  const result = deriveScheduleFa({
    assessmentYear: "2026-27",
    dividends: [
      {
        symbol: "ONLYDIV",
        currency: "USD",
        date: "2025-08-01",
        description: "Issuer name (US0000000001) CASH DIVIDEND",
        amount: 12.34,
      },
    ],
  });

  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].symbol, "ONLYDIV");
  assert.equal(result.entities[0].grossDividends, 12.34);
  assert.equal(result.entities[0].initialValue, 0);
  assert.equal(result.entities[0].closingValue, null);
  assert.equal(result.entities[0].evidence.dividendRows, 1);
  assert.equal(result.audit.reviewOnlyEntityCount, 1);
  assert.equal(result.audit.calendarYearEvidenceComplete, false);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "FA_DIVIDEND_ONLY_EVIDENCE",
    ),
  );
});
