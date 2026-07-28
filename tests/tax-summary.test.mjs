import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaxSummary,
  countryCodeFromTaxDescription,
} from "../lib/tax-summary.js";
import {
  buildReviewModel,
  parseIbkrStatements,
} from "../lib/ibkr.js";
import {
  enrichReviewWithReferenceData,
  parseSbiReferenceRatesCsv,
} from "../lib/reference-data.js";

function review(schedules) {
  return { schedules };
}

function converted(amountInr) {
  return { conversion: { amountInr } };
}

function convertedRow({ amountInr, ...row }) {
  return {
    ...row,
    ...converted(amountInr),
  };
}

test("extracts country code from explicit withholding tax description", () => {
  assert.equal(countryCodeFromTaxDescription("AAPL(US0378331005) US TAX"), "US");
});

test("extracts known country name from withholding tax description", () => {
  assert.equal(countryCodeFromTaxDescription("ASML NETHERLANDS TAX"), "NL");
});

test("returns blank country code when description has no tax country evidence", () => {
  assert.equal(countryCodeFromTaxDescription("AAPL CASH DIVIDEND"), "");
});

test("groups dividends and withholding by tax-row country evidence", () => {
  const result = buildTaxSummary(
    review({
      fsi: [
        {
          incomeType: "dividend",
          symbol: "AAPL",
          description: "AAPL CASH DIVIDEND",
          ...converted(500),
        },
      ],
      tr: [
        {
          symbol: "AAPL",
          description: "AAPL(US0378331005) US TAX",
          ...converted(120),
        },
      ],
    }),
    { marginalTaxRate: 0.312 },
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].countryCode, "US");
  assert.equal(result.rows[0].dividends, 500);
  assert.equal(result.rows[0].foreignTax, 120);
});

test("computes FTC relief as lower of foreign tax and Indian tax per country", () => {
  const result = buildTaxSummary(
    review({
      fsi: [
        {
          incomeType: "dividend",
          symbol: "AAPL",
          countryCode: "US",
          ...converted(500),
        },
      ],
      tr: [
        {
          symbol: "AAPL",
          countryCode: "US",
          ...converted(300),
        },
      ],
    }),
    { marginalTaxRate: 0.312 },
  );

  assert.equal(result.rows[0].indianTax, 156);
  assert.equal(result.rows[0].relief, 156);
  assert.equal(result.totals.relief, 156);
});

test("uses 12.5 percent LTCG rate and slab rate for STCG and income", () => {
  const result = buildTaxSummary(
    review({
      capitalGains: [
        { gainBucket: "LTCG", countryCode: "US", ...converted(1000) },
        { gainBucket: "STCG", countryCode: "US", ...converted(200) },
      ],
      fsi: [
        { incomeType: "dividend", countryCode: "US", ...converted(300) },
        { incomeType: "interest", countryCode: "US", ...converted(100) },
      ],
      tr: [{ countryCode: "US", ...converted(999) }],
    }),
    { marginalTaxRate: 0.3 },
  );

  assert.equal(result.rows[0].indianTax, 305);
  assert.equal(result.rows[0].foreignIncome, 1600);
  assert.equal(result.rows[0].relief, 305);
});

test("keeps FTC relief independent for each country", () => {
  const result = buildTaxSummary(
    review({
      fsi: [
        { incomeType: "dividend", countryCode: "US", ...converted(1000) },
        { incomeType: "dividend", countryCode: "TW", ...converted(100) },
      ],
      tr: [
        { countryCode: "US", ...converted(10) },
        { countryCode: "TW", ...converted(100) },
      ],
    }),
    { marginalTaxRate: 0.312 },
  );

  assert.equal(result.rows.find((row) => row.countryCode === "US").relief, 10);
  assert.equal(result.rows.find((row) => row.countryCode === "TW").relief, 31);
  assert.equal(result.totals.relief, 41);
});

test("marks unclassified income when security country cannot be inferred", () => {
  const result = buildTaxSummary(
    review({
      fsi: [
        {
          incomeType: "dividend",
          symbol: "UNKNOWN",
          description: "UNKNOWN CASH DIVIDEND",
          ...converted(100),
        },
      ],
    }),
    { marginalTaxRate: 0.312 },
  );

  assert.equal(result.rows[0].countryCode, "ZZ");
  assert.equal(result.rows[0].country, "Unclassified");
  assert.equal(result.unclassifiedRows, 1);
});

test("sets Form 67 required when any country has FTC relief", () => {
  const result = buildTaxSummary(
    review({
      fsi: [{ incomeType: "dividend", countryCode: "US", ...converted(100) }],
      tr: [{ countryCode: "US", ...converted(10) }],
    }),
    { marginalTaxRate: 0.312, dtaaSection: "90" },
  );

  assert.equal(result.form67Required, true);
  assert.equal(result.rows[0].form67Required, true);
  assert.equal(result.rows[0].dtaaSection, "90");
});

test("reports incomplete conversion coverage instead of treating missing INR as zero", () => {
  const result = buildTaxSummary(
    review({
      fsi: [
        {
          incomeType: "dividend",
          countryCode: "US",
          conversion: { amountInr: null },
        },
        {
          incomeType: "dividend",
          countryCode: "US",
          ...converted(500),
        },
      ],
      tr: [
        {
          countryCode: "US",
          conversion: { amountInr: null },
        },
      ],
    }),
    { marginalTaxRate: 0.312 },
  );

  assert.deepEqual(result.coverage, {
    totalRows: 3,
    convertedRows: 1,
    missingRows: 2,
    verifiedRows: 1,
    priorObservationRows: 0,
    complete: false,
    evidenceReady: false,
  });
  assert.equal(result.rows[0].dividends, 500);
  assert.equal(result.rows[0].foreignTax, 0);
  assert.equal(result.rows[0].conversionComplete, false);
  assert.equal(result.rows[0].missingConversionRows, 2);
});

test("keeps prior-observation arithmetic visible while marking its evidence for review", () => {
  const result = buildTaxSummary(
    review({
      fsi: [
        {
          incomeType: "dividend",
          countryCode: "US",
          conversion: {
            amountInr: 500,
            selection: "prior-observation",
          },
        },
      ],
    }),
    { marginalTaxRate: 0.312 },
  );

  assert.equal(result.totals.dividends, 500);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.evidenceReady, false);
  assert.equal(result.coverage.priorObservationRows, 1);
  assert.equal(result.rows[0].evidenceReady, false);
});

test("country totals preserve row-rounded reference parity while using net Rule 115 capital gain", () => {
  const review = {
    schedules: {
      capitalGains: [
        convertedRow({
          symbol: "ALFA",
          gainBucket: "STCG",
          amountInr: -60,
          company: { exchange: "NASDAQ" },
        }),
      ],
      fsi: [
        convertedRow({
          incomeType: "dividend",
          symbol: "ALFA",
          amountInr: 5_105,
        }),
        convertedRow({
          incomeType: "dividend",
          symbol: "BETA",
          amountInr: 426,
        }),
        convertedRow({
          incomeType: "dividend",
          symbol: "GAMM",
          amountInr: 129,
        }),
      ],
      tr: [
        convertedRow({
          symbol: "ALFA",
          description: "ALFA US TAX",
          amountInr: 1_278,
        }),
        convertedRow({
          symbol: "BETA",
          description: "BETA TW TAX",
          amountInr: 75,
        }),
        convertedRow({
          symbol: "GAMM",
          description: "GAMM NL TAX",
          amountInr: 20,
        }),
      ],
    },
  };

  const result = buildTaxSummary(review, {
    marginalTaxRate: 0.312,
    dtaaSection: "90",
  });

  assert.deepEqual(result.totals, {
    stcg: -60,
    ltcg: 0,
    dividends: 5_660,
    interest: 0,
    foreignIncome: 5_600,
    foreignTax: 1_373,
    indianTax: 1_747,
    relief: 1_373,
  });
  assert.equal(result.rows.find((row) => row.countryCode === "US").indianTax, 1_574);
  assert.equal(result.rows.find((row) => row.countryCode === "TW").indianTax, 133);
  assert.equal(result.rows.find((row) => row.countryCode === "NL").indianTax, 40);
});

test("parser-to-enrichment country linking preserves the parity totals without a company lookup", () => {
  const csv = [
    "Statement,Header,Field Name,Field Value",
    "Statement,Data,Period,\"2025-04-01 - 2026-03-31\"",
    "Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L",
    "Trades,Data,STK,USD,ALFA,2025-08-25 09:30:00,1,12.35,-12.35,0,12.35,0",
    "Trades,Data,STK,USD,ALFA,2025-11-25 09:30:00,-1,11.67,11.67,0,-12.35,-0.68",
    "Dividends,Header,Currency,Date,Description,Amount",
    "Dividends,Data,USD,2025-11-15,\"ALFA CASH DIVIDEND\",57.88",
    "Dividends,Data,USD,2025-11-15,\"BETA CASH DIVIDEND\",4.83",
    "Dividends,Data,USD,2025-11-15,\"GAMM CASH DIVIDEND\",1.46",
    "Withholding Tax,Header,Currency,Date,Description,Amount",
    "Withholding Tax,Data,USD,2025-11-15,\"ALFA US TAX\",-14.49",
    "Withholding Tax,Data,USD,2025-11-15,\"BETA TW TAX\",-0.85",
    "Withholding Tax,Data,USD,2025-11-15,\"GAMM NL TAX\",-0.23",
  ].join("\n");
  const baseReview = buildReviewModel(parseIbkrStatements(csv), {
    assessmentYear: "2026-27",
  });
  const enriched = enrichReviewWithReferenceData(baseReview, {
    usdTtBuyRates: parseSbiReferenceRatesCsv(
      "DATE,TT BUY\n2025-10-31,88.2",
    ),
    companyLookup: {},
  });

  const result = buildTaxSummary(enriched, {
    marginalTaxRate: 0.312,
    dtaaSection: "90",
  });

  assert.equal(enriched.schedules.fsi[0].symbol, "ALFA");
  assert.equal(enriched.schedules.tr[0].symbol, "ALFA");
  assert.deepEqual(result.totals, {
    stcg: -60,
    ltcg: 0,
    dividends: 5_660,
    interest: 0,
    foreignIncome: 5_600,
    foreignTax: 1_373,
    indianTax: 1_747,
    relief: 1_373,
  });
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(
    result.rows.map(({ countryCode, indianTax, relief }) => ({
      countryCode,
      indianTax,
      relief,
    })),
    [
      { countryCode: "NL", indianTax: 40, relief: 20 },
      { countryCode: "TW", indianTax: 133, relief: 75 },
      { countryCode: "US", indianTax: 1_574, relief: 1_278 },
    ],
  );
});
