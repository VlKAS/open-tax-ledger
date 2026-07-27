import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichReviewWithReferenceData,
  lookupUsdTtBuyRate,
  parseSbiReferenceRatesCsv,
  parseSecCompanyTickersExchange,
} from "../lib/reference-data.js";
import {
  BUNDLED_SBI_USD_CSV,
  BUNDLED_SEC_COMPANY_JSON,
} from "../lib/reference-data.generated.js";

test("parseSbiReferenceRatesCsv returns sorted valid USD TT-buy records with provenance", () => {
  const table = parseSbiReferenceRatesCsv(
    [
      "DATE,TT BUY,source url",
      "2025-08-29,87.11,https://example.test/sbi-2025-08-29.pdf",
      "2025-08-25 09:30,86.8,https://example.test/sbi-2025-08-25.pdf",
      "2025-08-28,0,https://example.test/zero.pdf",
      "29/08/2025,87.11,https://example.test/duplicate.pdf",
      "2025-08-27,not-a-number,https://example.test/bad.pdf",
      "2025-08-26,86.95,",
    ].join("\n"),
    {
      provider: "Test SBI archive",
      sourceUrl: "https://example.test/archive",
      license: "MIT",
      asOf: "2026-07-27",
    },
  );

  assert.equal(table.provider, "Test SBI archive");
  assert.equal(table.sourceUrl, "https://example.test/archive");
  assert.equal(table.license, "MIT");
  assert.deepEqual(table.records, [
    {
      date: "2025-08-25",
      timestamp: "2025-08-25 09:30",
      currency: "USD",
      ttBuy: 86.8,
      sourceUrl: "https://example.test/sbi-2025-08-25.pdf",
    },
    {
      date: "2025-08-26",
      timestamp: "2025-08-26",
      currency: "USD",
      ttBuy: 86.95,
      sourceUrl: "",
    },
    {
      date: "2025-08-29",
      timestamp: "2025-08-29",
      currency: "USD",
      ttBuy: 87.11,
      sourceUrl: "https://example.test/duplicate.pdf",
    },
  ]);
});

test("parseSbiReferenceRatesCsv rejects missing required data and preserves intraday conflicts", () => {
  assert.throws(() => parseSbiReferenceRatesCsv("DATE,BUY\n2025-01-01,86"), /DATE and TT BUY/);
  const intraday = parseSbiReferenceRatesCsv(
    "DATE,TT BUY\n2025-01-01 09:00,86\n2025-01-01 15:00,87",
  );
  assert.equal(intraday.count, 2);
  assert.equal(lookupUsdTtBuyRate(intraday, "2025-01-01").status, "ambiguous");
  assert.throws(() => parseSbiReferenceRatesCsv(`DATE,TT BUY\n2025-01-01,${"9".repeat(2_001)}`), /character limit/);
});

test("lookupUsdTtBuyRate performs exact-date matching without nearest-day fallback", () => {
  const table = parseSbiReferenceRatesCsv("DATE,TT BUY\n2025-01-31,86.5\n2025-02-03,86.7");

  assert.deepEqual(lookupUsdTtBuyRate(table, "2025-01-31"), {
    status: "matched",
    date: "2025-01-31",
    currency: "USD",
    rate: 86.5,
    sourceUrl: "",
  });
  assert.deepEqual(lookupUsdTtBuyRate(table, "2025-02-01"), {
    status: "missing",
    date: "2025-02-01",
    currency: "USD",
    rate: null,
    sourceUrl: "",
  });
  assert.equal(lookupUsdTtBuyRate(table, "not-a-date").status, "invalid-date");
});

test("parseSecCompanyTickersExchange builds a local ticker lookup and marks ambiguity", () => {
  const lookup = parseSecCompanyTickersExchange(
    {
      fields: ["cik", "name", "ticker", "exchange"],
      data: [
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        [1018724, "Amazon.com, Inc.", "AMZN", "Nasdaq"],
        [1111111, "First Duplicate Corp.", "DUP", "NYSE"],
        [2222222, "Second Duplicate Corp.", "DUP", "Nasdaq"],
        [3333333, "Bad Symbol Corp.", "not a ticker", "NYSE"],
      ],
    },
    {
      sourceUrl: "https://www.sec.gov/files/company_tickers_exchange.json",
      asOf: "2026-07-27",
    },
  );

  assert.equal(lookup.count, 3);
  assert.equal(lookup.entries.AAPL.name, "Apple Inc.");
  assert.equal(lookup.entries.AAPL.provider, "SEC EDGAR company_tickers_exchange");
  assert.equal(lookup.entries.AAPL.confidence, "sec-ticker-only");
  assert.equal(lookup.entries.DUP.confidence, "ambiguous-ticker");
  assert.deepEqual(lookup.ambiguousTickers, ["DUP"]);
});

test("parseSecCompanyTickersExchange rejects malformed and oversized structures", () => {
  assert.throws(() => parseSecCompanyTickersExchange({ data: [] }), /fields and data arrays/);
  assert.throws(
    () => parseSecCompanyTickersExchange({ fields: Array.from({ length: 25 }, (_, index) => `f${index}`), data: [] }),
    /field limit/,
  );
  assert.throws(
    () =>
      parseSecCompanyTickersExchange({
        fields: ["cik", "name", "ticker", "exchange"],
        data: Array.from({ length: 100_001 }, () => [1, "Name", "AAA", "NYSE"]),
      }),
    /row limit/,
  );
});

test("enrichReviewWithReferenceData adds metadata without mutating the review model", () => {
  const review = Object.freeze({
    schedules: Object.freeze({
      capitalGains: Object.freeze([
        Object.freeze({ symbol: "AAPL", date: "2025-08-15", currency: "USD", realizedProfitLoss: 100 }),
      ]),
      fsi: Object.freeze([Object.freeze({ description: "AAPL CASH DIVIDEND", currency: "USD", amount: 10 })]),
      tr: Object.freeze([Object.freeze({ description: "UNKNOWN TAX", currency: "USD", taxPaid: 2 })]),
      fa: Object.freeze([Object.freeze({ symbol: "AMZN", currency: "USD", value: 1200 })]),
    }),
  });
  const rateTable = parseSbiReferenceRatesCsv("DATE,TT BUY\n2025-08-15,87.11", {
    sourceUrl: "https://example.test/sbi",
    license: "MIT",
  });
  const companyLookup = parseSecCompanyTickersExchange({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [
      [320193, "Apple Inc.", "AAPL", "Nasdaq"],
      [1018724, "Amazon.com, Inc.", "AMZN", "Nasdaq"],
    ],
  });

  const enriched = enrichReviewWithReferenceData(review, {
    usdTtBuyRates: rateTable,
    companyLookup,
  });

  assert.notEqual(enriched, review);
  assert.equal("company" in review.schedules.capitalGains[0], false);
  assert.equal(enriched.schedules.capitalGains[0].company.name, "Apple Inc.");
  assert.equal(enriched.schedules.fsi[0].company.ticker, "AAPL");
  assert.equal(enriched.schedules.tr[0].company.status, "unmatched");
  assert.equal(enriched.schedules.fa[0].company.name, "Amazon.com, Inc.");
  assert.deepEqual(enriched.referenceData.usdTtBuyRates, {
    provider: "SBI TT buying-rate reference",
    sourceUrl: "https://example.test/sbi",
    license: "MIT",
    asOf: "",
    currency: "USD",
    records: 1,
    firstDate: "2025-08-15",
    lastDate: "2025-08-15",
  });
  assert.equal(enriched.referenceData.companyLookup.records, 2);
});

test("checked-in reference snapshots parse to the manifest-backed coverage", () => {
  const rates = parseSbiReferenceRatesCsv(BUNDLED_SBI_USD_CSV);
  const companies = parseSecCompanyTickersExchange(BUNDLED_SEC_COMPANY_JSON);

  assert.equal(rates.count, 1_551);
  assert.equal(rates.records[0].date, "2020-01-06");
  assert.equal(rates.records.at(-1).date, "2026-07-27");
  assert.equal(lookupUsdTtBuyRate(rates, "2024-06-04").status, "ambiguous");
  assert.equal(companies.count, 10_432);
  assert.equal(companies.entries.AAPL.name, "Apple Inc.");
});
