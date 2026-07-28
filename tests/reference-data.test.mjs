import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  enrichReviewWithReferenceData,
  lookupUsdTtBuyRate,
  lookupUsdTtBuyRateOnOrBefore,
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

test("lookupUsdTtBuyRateOnOrBefore uses latest prior observation within the allowed window", () => {
  const table = parseSbiReferenceRatesCsv(
    [
      "DATE,TT BUY,source url",
      "2025-08-25,86.5,https://example.test/old.pdf",
      "2025-08-29,87.11,https://example.test/friday.pdf",
      "2025-09-01,87.2,https://example.test/monday.pdf",
    ].join("\n"),
  );

  assert.deepEqual(lookupUsdTtBuyRateOnOrBefore(table, "2025-08-31"), {
    status: "matched",
    date: "2025-08-31",
    specifiedDate: "2025-08-31",
    observationDate: "2025-08-29",
    selection: "prior-observation",
    daysPrior: 2,
    currency: "USD",
    rate: 87.11,
    sourceUrl: "https://example.test/friday.pdf",
  });
  assert.equal(
    lookupUsdTtBuyRateOnOrBefore(table, "2025-08-31", { maxDays: 1 }).status,
    "missing",
  );
  assert.deepEqual(lookupUsdTtBuyRate(table, "2025-08-31"), {
    status: "missing",
    date: "2025-08-31",
    currency: "USD",
    rate: null,
    sourceUrl: "",
  });
});

test("lookupUsdTtBuyRateOnOrBefore reports ambiguity on the selected observation date", () => {
  const table = parseSbiReferenceRatesCsv(
    [
      "DATE,TT BUY,source url",
      "2025-08-29 09:00,87.11,https://example.test/morning.pdf",
      "2025-08-29 15:00,87.12,https://example.test/afternoon.pdf",
      "2025-08-28,86.9,https://example.test/older.pdf",
    ].join("\n"),
  );

  const result = lookupUsdTtBuyRateOnOrBefore(table, "2025-08-31");
  assert.equal(result.status, "ambiguous");
  assert.equal(result.specifiedDate, "2025-08-31");
  assert.equal(result.observationDate, "2025-08-29");
  assert.equal(result.selection, "prior-observation");
  assert.equal(result.daysPrior, 2);
  assert.deepEqual(result.observations, [
    {
      timestamp: "2025-08-29 09:00",
      rate: 87.11,
      sourceUrl: "https://example.test/morning.pdf",
    },
    {
      timestamp: "2025-08-29 15:00",
      rate: 87.12,
      sourceUrl: "https://example.test/afternoon.pdf",
    },
  ]);
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

test("reference enrichment derives exact Rule 115 and Rule 128 dates and INR previews", () => {
  const review = {
    schedules: {
      capitalGains: [
        {
          symbol: "AAPL",
          date: "2026-01-15",
          currency: "USD",
          realizedProfitLoss: 149,
          needsFx: true,
        },
      ],
      fsi: [
        {
          incomeType: "dividend",
          date: "2025-08-15",
          currency: "USD",
          description: "AAPL CASH DIVIDEND",
          amount: 12.5,
          needsFx: true,
        },
        {
          incomeType: "interest",
          date: "2025-09-30",
          currency: "USD",
          description: "BROKER CREDIT INTEREST",
          amount: 1.25,
          needsFx: true,
        },
      ],
      tr: [
        {
          date: "2025-08-15",
          currency: "USD",
          description: "AAPL US TAX WITHHELD",
          taxPaid: 3.75,
          needsFx: true,
        },
      ],
      fa: [{ symbol: "AAPL", currency: "USD", value: 1_100, needsFx: true }],
    },
    validations: [
      {
        severity: "warning",
        code: "MISSING_FX",
        message: "Missing rates",
      },
    ],
  };
  const rates = parseSbiReferenceRatesCsv(
    [
      "DATE,TT BUY,source url",
      "2025-07-31,86,https://example.test/2025-07-31.pdf",
      "2025-12-31,90,https://example.test/2025-12-31.pdf",
      "2026-03-31,92,https://example.test/2026-03-31.pdf",
    ].join("\n"),
    {
      provider: "Community test archive",
      license: "Community reference",
    },
  );

  const enriched = enrichReviewWithReferenceData(review, {
    usdTtBuyRates: rates,
    companyLookup: {},
  });

  assert.deepEqual(
    enriched.schedules.capitalGains[0].conversion,
    {
      authority: "Rule 115",
      category: "capital-gains",
      eventDate: "2026-01-15",
      specifiedDate: "2025-12-31",
      dateRule:
        "Last calendar day of the month immediately preceding the transfer month.",
      classificationReview: false,
      status: "matched",
      rate: 90,
      sourceUrl: "https://example.test/2025-12-31.pdf",
      observations: [],
      observationDate: "2025-12-31",
      selection: "exact",
      daysPrior: 0,
      currency: "USD",
      amountForeign: 149,
      amountInr: 13_410,
      exactDateOnly: true,
    },
  );
  assert.equal(enriched.schedules.fsi[0].conversion.specifiedDate, "2025-07-31");
  assert.equal(enriched.schedules.fsi[0].conversion.amountInr, 1_075);
  assert.equal(enriched.schedules.fsi[1].conversion.specifiedDate, "2026-03-31");
  assert.equal(enriched.schedules.fsi[1].conversion.amountInr, 115);
  assert.equal(enriched.schedules.fsi[1].conversion.classificationReview, true);
  assert.equal(enriched.schedules.tr[0].conversion.authority, "Rule 128(5)(ii)");
  assert.equal(enriched.schedules.tr[0].conversion.amountInr, 323);
  assert.equal(enriched.conversionSummary.total, 4);
  assert.equal(enriched.conversionSummary.totalRows, 4);
  assert.equal(enriched.conversionSummary.conversionRows, 4);
  assert.equal(enriched.conversionSummary.matched, 4);
  assert.equal(enriched.conversionSummary.matchedRows, 4);
  assert.equal(enriched.conversionSummary.exactMatchedRows, 4);
  assert.equal(enriched.conversionSummary.priorObservationRows, 0);
  assert.equal(enriched.conversionSummary.missing, 0);
  assert.deepEqual(enriched.conversionSummary.totalsInr, {
    capitalGains: 13_410,
    dividends: 1_075,
    interest: 115,
    foreignTax: 323,
  });
  assert.deepEqual(enriched.conversionSummary.completeness, {
    capitalGains: { total: 1, converted: 1, verified: 1, priorObservation: 0 },
    dividends: { total: 1, converted: 1, verified: 1, priorObservation: 0 },
    interest: { total: 1, converted: 1, verified: 1, priorObservation: 0 },
    foreignTax: { total: 1, converted: 1, verified: 1, priorObservation: 0 },
  });
  assert.equal(enriched.conversionSummary.dates, 4);
  assert.equal(enriched.conversionSummary.dateBucketCount, 4);
  assert.equal(enriched.conversionSummary.matchedDateBucketCount, 4);
  assert.equal(enriched.conversionSummary.priorObservationDateBucketCount, 0);
  assert.equal(enriched.conversionSummary.distinctSpecifiedDateCount, 3);
  assert.deepEqual(enriched.conversionSummary.specifiedDates, [
    "2025-07-31",
    "2025-12-31",
    "2026-03-31",
  ]);
  assert.equal(enriched.conversionSummary.dateLedger.length, 4);
  assert.ok(
    enriched.validations.some(
      (validation) => validation.code === "INTEREST_CLASSIFICATION_REVIEW",
    ),
  );
  assert.ok(
    enriched.validations.some(
      (validation) => validation.code === "FA_FX_REVIEW_REQUIRED",
    ),
  );
  assert.ok(
    enriched.validations.some(
      (validation) => validation.code === "COMMUNITY_RATE_EVIDENCE",
    ),
  );
  assert.equal(
    enriched.validations.some((validation) => validation.code === "MISSING_FX"),
    false,
  );
});

test("automatic conversion uses a prior observation for a weekend statutory date", () => {
  const review = {
    schedules: {
      capitalGains: [
        {
          symbol: "AAPL",
          date: "2025-09-15",
          currency: "USD",
          realizedProfitLoss: 100,
        },
      ],
      fsi: [],
      tr: [],
      fa: [],
    },
    validations: [],
  };
  const rates = parseSbiReferenceRatesCsv(
    "DATE,TT BUY\n2025-08-29,87.11\n2025-09-01,87.2",
  );

  const enriched = enrichReviewWithReferenceData(review, {
    usdTtBuyRates: rates,
    companyLookup: {},
  });

  assert.equal(enriched.schedules.capitalGains[0].conversion.specifiedDate, "2025-08-31");
  assert.equal(enriched.schedules.capitalGains[0].conversion.status, "matched");
  assert.equal(enriched.schedules.capitalGains[0].conversion.observationDate, "2025-08-29");
  assert.equal(enriched.schedules.capitalGains[0].conversion.selection, "prior-observation");
  assert.equal(enriched.schedules.capitalGains[0].conversion.daysPrior, 2);
  assert.equal(enriched.schedules.capitalGains[0].conversion.amountInr, 8_711);
  assert.equal(enriched.schedules.capitalGains[0].conversion.exactDateOnly, false);
  assert.equal(enriched.conversionSummary.exactMatchedRows, 0);
  assert.equal(enriched.conversionSummary.priorObservationRows, 1);
  assert.equal(enriched.conversionSummary.priorObservationDateBucketCount, 1);
  assert.deepEqual(enriched.conversionSummary.completeness.capitalGains, {
    total: 1,
    converted: 1,
    verified: 0,
    priorObservation: 1,
  });
  assert.ok(
    enriched.validations.some(
      (validation) => validation.code === "PRIOR_OBSERVATION_RATE_USED",
    ),
  );
});

test("capital gains convert the net FIFO gain and Schedule FA values retain their own value dates", () => {
  const review = {
    schedules: {
      capitalGains: [
        {
          symbol: "ALFA",
          acquisitionDate: "2025-08-25",
          saleDate: "2025-11-25",
          date: "2025-11-25",
          currency: "USD",
          gain: -0.68,
          realizedProfitLoss: -0.68,
          gainBucket: "STCG",
        },
      ],
      fsi: [],
      tr: [],
      fa: [
        {
          symbol: "ALFA",
          currency: "USD",
          acquisitionDate: "2025-08-25",
          initialValue: 12.35,
          peakDate: "2025-11-30",
          peakValue: 15,
          closingDate: "2025-12-31",
          closingValue: 14,
        },
      ],
      holdings: [
        {
          symbol: "ALFA",
          currency: "USD",
          snapshotDate: "2025-12-31",
          value: 14,
        },
      ],
    },
    validations: [],
  };
  const rates = parseSbiReferenceRatesCsv(
    [
      "DATE,TT BUY",
      "2025-08-25,87.15",
      "2025-10-31,88.2",
      "2025-11-29,88.95",
      "2025-12-31,89.47",
    ].join("\n"),
  );

  const enriched = enrichReviewWithReferenceData(review, {
    usdTtBuyRates: rates,
    companyLookup: {},
  });

  assert.equal(enriched.schedules.capitalGains[0].conversion.amountForeign, -0.68);
  assert.equal(enriched.schedules.capitalGains[0].conversion.specifiedDate, "2025-10-31");
  assert.equal(enriched.schedules.capitalGains[0].conversion.amountInr, -60);
  assert.equal(enriched.schedules.fa[0].initialValueInr, 1_076);
  assert.equal(enriched.schedules.fa[0].peakValueInr, 1_334);
  assert.equal(enriched.schedules.fa[0].valueConversions.peak.observationDate, "2025-11-29");
  assert.equal(enriched.schedules.fa[0].closingValueInr, 1_253);
  assert.equal(enriched.schedules.holdings[0].valueInr, 1_253);
  assert.deepEqual(enriched.faConversionSummary.holdings, {
    total: 1,
    converted: 1,
    verified: 1,
    priorObservation: 0,
    amountInr: 1_253,
  });
  assert.ok(
    enriched.validations.some(
      (validation) => validation.code === "PRIOR_OBSERVATION_RATE_USED",
    ),
  );
});

test("missing Schedule FA source values remain missing instead of becoming zero", () => {
  const enriched = enrichReviewWithReferenceData(
    {
      schedules: {
        capitalGains: [],
        fsi: [],
        tr: [],
        fa: [
          {
            symbol: "ALFA",
            currency: "USD",
            acquisitionDate: "2025-08-25",
            initialValue: null,
            peakDate: "2025-11-30",
            peakValue: null,
            closingDate: "2025-12-31",
            closingValue: null,
          },
        ],
        holdings: [],
      },
      validations: [],
    },
    {
      usdTtBuyRates: parseSbiReferenceRatesCsv(
        "DATE,TT BUY\n2025-08-25,87.15\n2025-11-29,88.95\n2025-12-31,89.47",
      ),
      companyLookup: {},
    },
  );

  const conversions = enriched.schedules.fa[0].valueConversions;
  assert.equal(conversions.initial.status, "missing-value");
  assert.equal(conversions.peak.status, "missing-value");
  assert.equal(conversions.closing.status, "missing-value");
  assert.equal(enriched.schedules.fa[0].initialValueInr, null);
  assert.equal(enriched.schedules.fa[0].peakValueInr, null);
  assert.equal(enriched.schedules.fa[0].closingValueInr, null);
});

test("ambiguous exact-date observations remain visible and unconverted", () => {
  const review = {
    schedules: {
      capitalGains: [
        {
          symbol: "AAPL",
          date: "2025-02-15",
          currency: "USD",
          realizedProfitLoss: 100,
        },
      ],
      fsi: [],
      tr: [],
      fa: [],
    },
    validations: [],
  };
  const rates = parseSbiReferenceRatesCsv(
    [
      "DATE,TT BUY,SOURCE URL",
      "2025-01-31 09:00,86,https://example.test/morning.pdf",
      "2025-01-31 15:00,87,https://example.test/afternoon.pdf",
    ].join("\n"),
  );

  const enriched = enrichReviewWithReferenceData(review, {
    usdTtBuyRates: rates,
    companyLookup: {},
  });
  const conversion = enriched.schedules.capitalGains[0].conversion;

  assert.equal(conversion.specifiedDate, "2025-01-31");
  assert.equal(conversion.status, "ambiguous");
  assert.equal(conversion.amountInr, null);
  assert.equal(conversion.observationDate, "2025-01-31");
  assert.equal(conversion.selection, "exact");
  assert.equal(conversion.daysPrior, 0);
  assert.deepEqual(conversion.observations, [
    {
      timestamp: "2025-01-31 09:00",
      rate: 86,
      sourceUrl: "https://example.test/morning.pdf",
    },
    {
      timestamp: "2025-01-31 15:00",
      rate: 87,
      sourceUrl: "https://example.test/afternoon.pdf",
    },
  ]);
  assert.equal(enriched.conversionSummary.ambiguous, 1);
  assert.ok(
    enriched.validations.some(
      (validation) => validation.code === "RULE_RATE_EVIDENCE_MISSING",
    ),
  );
});

test("capital-gains conversion uses the computed net FIFO gain", () => {
  const review = {
    schedules: {
      capitalGains: [
        {
          symbol: "AAPL",
          date: "2026-01-15",
          currency: "USD",
          realizedProfitLoss: 149,
          gain: 148.5,
        },
      ],
      fsi: [],
      tr: [],
      fa: [],
    },
    validations: [],
  };
  const rates = parseSbiReferenceRatesCsv("DATE,TT BUY\n2025-12-31,90", {
    sourceUrl: "https://example.test/2025-12-31.pdf",
  });

  const enriched = enrichReviewWithReferenceData(review, {
    usdTtBuyRates: rates,
    companyLookup: {},
  });

  assert.equal(enriched.schedules.capitalGains[0].conversion.amountInr, 13_365);
});

test("checked-in reference snapshots parse to the manifest-backed coverage", async () => {
  const rates = parseSbiReferenceRatesCsv(BUNDLED_SBI_USD_CSV);
  const companies = parseSecCompanyTickersExchange(BUNDLED_SEC_COMPANY_JSON);
  const manifest = JSON.parse(await readFile(new URL("../reference-data/manifest.json", import.meta.url), "utf8"));
  const expectedSbi = manifest.datasets.sbiUsdTtBuyCommunity;
  const expectedSec = manifest.datasets.secCompanyTickersExchange;

  assert.equal(rates.count, expectedSbi.records);
  assert.equal(rates.records[0].date, "2020-01-06");
  assert.equal(rates.records[0].date, expectedSbi.coverage.first);
  assert.equal(rates.records.at(-1).date, expectedSbi.coverage.last);
  assert.equal(lookupUsdTtBuyRate(rates, "2024-06-04").status, "ambiguous");
  assert.equal(companies.count, expectedSec.records);
  assert.equal(companies.entries.AAPL.name, "Apple Inc.");
});
