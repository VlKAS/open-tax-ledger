import assert from "node:assert/strict";
import test from "node:test";

import { buildFifoCapitalGains } from "../lib/fifo.js";

function trade(overrides) {
  return {
    symbol: "AAPL",
    currency: "USD",
    date: "2024-01-01",
    quantity: 1,
    proceeds: -100,
    commission: -1,
    basis: 101,
    realizedProfitLoss: 0,
    source: { fileIndex: 0, rowNumber: 1 },
    ...overrides,
  };
}

test("matches two buy lots FIFO and allocates sale values by matched quantity", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ date: "2024-01-01", quantity: 10, proceeds: -1000, commission: -2, basis: 1002, source: { rowNumber: 1 } }),
      trade({ date: "2024-02-01", quantity: 10, proceeds: -1200, commission: -2, basis: 1202, source: { rowNumber: 2 } }),
      trade({ date: "2024-03-01", quantity: -15, proceeds: 1800, commission: -3, realizedProfitLoss: 293, basis: -1504, source: { rowNumber: 3 } }),
    ],
  });

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => ({
      quantitySold: row.quantitySold,
      proceeds: row.proceeds,
      costBasis: row.costBasis,
      realizedProfitLoss: row.realizedProfitLoss,
      gain: row.gain,
    })),
    [
      { quantitySold: 10, proceeds: 1198, costBasis: 1002, realizedProfitLoss: 195.33, gain: 196 },
      { quantitySold: 5, proceeds: 599, costBasis: 601, realizedProfitLoss: 97.67, gain: -2 },
    ],
  );
  assert.equal(result.audit.matchedQuantity, 15);
  assert.deepEqual(result.findings, []);
});

test("keeps partial buy-lot remainder for later sales", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ date: "2024-01-01", quantity: 10, proceeds: -1000, commission: 0, basis: 1000, source: { rowNumber: 1 } }),
      trade({ date: "2024-01-10", quantity: -4, proceeds: 600, commission: 0, realizedProfitLoss: 200, source: { rowNumber: 2 } }),
      trade({ date: "2024-01-20", quantity: -3, proceeds: 330, commission: 0, realizedProfitLoss: 30, source: { rowNumber: 3 } }),
    ],
  });

  assert.deepEqual(
    result.rows.map((row) => [row.quantitySold, row.costBasis, row.gain]),
    [
      [4, 400, 200],
      [3, 300, 30],
    ],
  );
  assert.equal(result.audit.openLotQuantity, 3);
});

test("uses derived buy cost and sale net proceeds when commissions are present", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ date: "2024-01-01", quantity: 10, proceeds: -1000, commission: -5, basis: 0, source: { rowNumber: 1 } }),
      trade({ date: "2024-02-01", quantity: -4, proceeds: 600, commission: -2, realizedProfitLoss: 196, source: { rowNumber: 2 } }),
    ],
  });

  assert.equal(result.rows[0].costBasis, 402);
  assert.equal(result.rows[0].buyCommission, 2);
  assert.equal(result.rows[0].proceeds, 598);
  assert.equal(result.rows[0].sellCommission, -2);
  assert.equal(result.rows[0].gain, 196);
});

test("classifies 730 holding days as STCG and 731 as LTCG", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ date: "2024-01-01", quantity: 2, proceeds: -200, commission: 0, basis: 200, source: { rowNumber: 1 } }),
      trade({ date: "2025-12-31", quantity: -1, proceeds: 150, commission: 0, source: { rowNumber: 2 } }),
      trade({ date: "2026-01-01", quantity: -1, proceeds: 150, commission: 0, source: { rowNumber: 3 } }),
    ],
  });

  assert.equal(result.rows[0].holdingDays, 730);
  assert.equal(result.rows[0].gainBucket, "STCG");
  assert.equal(result.rows[1].holdingDays, 731);
  assert.equal(result.rows[1].gainBucket, "LTCG");
});

test("splits one sale across short-term and long-term lots", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ date: "2023-01-01", quantity: 1, proceeds: -100, commission: 0, basis: 100, source: { rowNumber: 1 } }),
      trade({ date: "2025-01-01", quantity: 1, proceeds: -120, commission: 0, basis: 120, source: { rowNumber: 2 } }),
      trade({ date: "2025-06-01", quantity: -2, proceeds: 300, commission: 0, source: { rowNumber: 3 } }),
    ],
  });

  assert.deepEqual(result.rows.map((row) => row.gainBucket), ["LTCG", "STCG"]);
  assert.deepEqual(result.rows.map((row) => row.gain), [50, 30]);
});

test("does not match lots across currencies", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ currency: "USD", date: "2024-01-01", quantity: 1, proceeds: -100, commission: 0, basis: 100, source: { rowNumber: 1 } }),
      trade({ currency: "CAD", date: "2024-02-01", quantity: -1, proceeds: 150, commission: 0, source: { rowNumber: 2 } }),
    ],
  });

  assert.equal(result.rows.length, 0);
  assert.equal(result.audit.unmatchedQuantity, 1);
  assert.equal(result.findings[0].code, "UNMATCHED_SALE");
});

test("reports unsupported trades, invalid dates, and unmatched sales without inventing basis", () => {
  const result = buildFifoCapitalGains({
    trades: [
      trade({ date: "2024-99-99", quantity: 1, source: { rowNumber: 1 } }),
      trade({ unsupported: true, date: "2024-01-01", quantity: 1, source: { rowNumber: 2 } }),
      trade({ date: "2024-01-02", quantity: -3, proceeds: 300, commission: 0, source: { rowNumber: 3 } }),
    ],
  });

  assert.equal(result.rows.length, 0);
  assert.deepEqual(
    result.findings.map((item) => item.code),
    ["INVALID_TRADE_DATE", "UNSUPPORTED_TRADE", "UNMATCHED_SALE"],
  );
});
