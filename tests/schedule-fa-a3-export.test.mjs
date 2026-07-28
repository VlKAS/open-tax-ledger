import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScheduleFaA3Csv,
  SCHEDULE_FA_A3_HEADERS,
  ScheduleFaA3CsvValidationError,
} from "../lib/export.js";

function portalRow(overrides = {}) {
  return {
    countryRegionName: "United States",
    countryNameAndCode: "2-UNITED STATES OF AMERICA",
    entityName: "Example Inc.",
    entityAddress: "1 Market Street, San Francisco, CA",
    zipCode: "94105",
    natureOfEntity: "Listed equity share",
    acquisitionDate: "2025-01-15",
    initialValueOfInvestment: 100,
    peakValueOfInvestmentDuringPeriod: 125.5,
    closingBalance: 110,
    totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod: 3.25,
    totalGrossProceedsFromSaleOrRedemptionOfInvestmentDuringPeriod: 0,
    ...overrides,
  };
}

test("buildScheduleFaA3Csv emits the fixed official A3 header order with CRLF rows", () => {
  const csv = buildScheduleFaA3Csv([
    portalRow({
      entityName: "Comma, Quote \"Corp\"",
      acquisitionDate: new Date(Date.UTC(2025, 11, 31)),
    }),
  ]);

  assert.equal(
    csv,
    `${SCHEDULE_FA_A3_HEADERS.join(",")}\r\n` +
      "United States,2-UNITED STATES OF AMERICA,\"Comma, Quote \"\"Corp\"\"\",\"1 Market Street, San Francisco, CA\",94105,Listed equity share,31-Dec-2025,100,125.5,110,3.25,0",
  );
});

test("buildScheduleFaA3Csv accepts explicit zero numeric values", () => {
  const csv = buildScheduleFaA3Csv([
    portalRow({
      initialValueOfInvestment: 0,
      peakValueOfInvestmentDuringPeriod: "0",
      closingBalance: 0,
      totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod: 0,
      totalGrossProceedsFromSaleOrRedemptionOfInvestmentDuringPeriod: 0,
    }),
  ]);

  assert.match(csv, /15-Jan-2025,0,0,0,0,0$/);
});

test("buildScheduleFaA3Csv reuses csvCell formula neutralization", () => {
  const csv = buildScheduleFaA3Csv([
    portalRow({
      entityName: "=HYPERLINK(\"https://example.test\")",
      entityAddress: " \t+SUM(A1:A2)",
    }),
  ]);

  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /' \t\+SUM/);
});

test("buildScheduleFaA3Csv throws structured validation errors for missing portal fields", () => {
  assert.throws(
    () =>
      buildScheduleFaA3Csv([
        portalRow({
          countryRegionName: "",
          entityName: " ",
          entityAddress: null,
          zipCode: undefined,
          natureOfEntity: "",
          acquisitionDate: "2025-02-31",
          initialValueOfInvestment: "",
          peakValueOfInvestmentDuringPeriod: "not-a-number",
          closingBalance: null,
          totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod: undefined,
          totalGrossProceedsFromSaleOrRedemptionOfInvestmentDuringPeriod: Number.NaN,
        }),
      ]),
    (error) => {
      assert.ok(error instanceof ScheduleFaA3CsvValidationError);
      assert.equal(error.code, "SCHEDULE_FA_A3_VALIDATION_FAILED");
      assert.deepEqual(
        error.errors.map(({ row, field, code }) => ({ row, field, code })),
        [
          { row: 1, field: "countryRegionName", code: "required" },
          { row: 1, field: "entityName", code: "required" },
          { row: 1, field: "entityAddress", code: "required" },
          { row: 1, field: "zipCode", code: "required" },
          { row: 1, field: "natureOfEntity", code: "required" },
          { row: 1, field: "acquisitionDate", code: "required_date" },
          { row: 1, field: "initialValueOfInvestment", code: "required_number" },
          {
            row: 1,
            field: "peakValueOfInvestmentDuringPeriod",
            code: "required_number",
          },
          { row: 1, field: "closingBalance", code: "required_number" },
          {
            row: 1,
            field: "totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod",
            code: "required_number",
          },
          {
            row: 1,
            field: "totalGrossProceedsFromSaleOrRedemptionOfInvestmentDuringPeriod",
            code: "required_number",
          },
        ],
      );
      return true;
    },
  );
});

test("buildScheduleFaA3Csv validates the top-level rows shape", () => {
  assert.throws(
    () => buildScheduleFaA3Csv({}),
    (error) => {
      assert.ok(error instanceof ScheduleFaA3CsvValidationError);
      assert.deepEqual(error.errors, [
        {
          row: null,
          field: "rows",
          code: "required_array",
          message: "Schedule FA A3 rows must be an array.",
        },
      ]);
      return true;
    },
  );
});

test("buildScheduleFaA3Csv enforces portal address and ZIP limits", () => {
  assert.throws(
    () =>
      buildScheduleFaA3Csv([
        portalRow({
          entityAddress: "A".repeat(36),
          zipCode: "123456789",
        }),
      ]),
    (error) => {
      assert.ok(error instanceof ScheduleFaA3CsvValidationError);
      assert.deepEqual(
        error.errors.map(({ field, code }) => ({ field, code })),
        [
          { field: "entityAddress", code: "max_length" },
          { field: "zipCode", code: "max_length" },
        ],
      );
      return true;
    },
  );
});
