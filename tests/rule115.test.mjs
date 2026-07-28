import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveRule115SpecifiedDate,
  deriveRule128ForeignTaxDate,
  indianFinancialYearEnd,
  lastDayOfPreviousMonth,
} from "../lib/rule115.js";

test("lastDayOfPreviousMonth handles year boundaries and leap years", () => {
  assert.equal(lastDayOfPreviousMonth("2026-01-15"), "2025-12-31");
  assert.equal(lastDayOfPreviousMonth("2024-03-02"), "2024-02-29");
  assert.equal(lastDayOfPreviousMonth("2025-03-02"), "2025-02-28");
  assert.equal(lastDayOfPreviousMonth("not-a-date"), "");
});

test("indianFinancialYearEnd derives the March 31 year-end containing the event", () => {
  assert.equal(indianFinancialYearEnd("2025-04-01"), "2026-03-31");
  assert.equal(indianFinancialYearEnd("2025-12-31"), "2026-03-31");
  assert.equal(indianFinancialYearEnd("2026-03-31"), "2026-03-31");
  assert.equal(indianFinancialYearEnd("2026-04-01"), "2027-03-31");
});

test("Rule 115 dates are derived from the applicable income category", () => {
  assert.deepEqual(
    deriveRule115SpecifiedDate({
      category: "capital-gains",
      eventDate: "2026-01-15",
    }),
    {
      authority: "Rule 115",
      category: "capital-gains",
      eventDate: "2026-01-15",
      specifiedDate: "2025-12-31",
      dateRule:
        "Last calendar day of the month immediately preceding the transfer month.",
      classificationReview: false,
      status: "derived",
    },
  );

  assert.equal(
    deriveRule115SpecifiedDate({
      category: "dividend",
      eventDate: "2025-08-15",
    }).specifiedDate,
    "2025-07-31",
  );
  assert.equal(
    deriveRule115SpecifiedDate({
      category: "interest-on-securities",
      eventDate: "2025-08-15",
    }).specifiedDate,
    "2025-07-31",
  );

  const otherSources = deriveRule115SpecifiedDate({
    category: "other-sources",
    eventDate: "2025-09-30",
  });
  assert.equal(otherSources.specifiedDate, "2026-03-31");
  assert.equal(otherSources.classificationReview, true);
});

test("Rule 115 returns an explicit invalid state instead of guessing", () => {
  assert.deepEqual(
    deriveRule115SpecifiedDate({
      category: "capital-gains",
      eventDate: "31/01/2026",
    }),
    {
      authority: "Rule 115",
      category: "capital-gains",
      eventDate: "",
      specifiedDate: "",
      dateRule:
        "Last calendar day of the month immediately preceding the transfer month.",
      classificationReview: false,
      status: "invalid-event-date",
    },
  );

  assert.throws(
    () =>
      deriveRule115SpecifiedDate({
        category: "unsupported",
        eventDate: "2026-01-15",
      }),
    /Unsupported Rule 115 category/,
  );
});

test("Rule 128 foreign-tax conversion date uses the preceding month-end", () => {
  assert.deepEqual(deriveRule128ForeignTaxDate("2025-08-15"), {
    authority: "Rule 128(5)(ii)",
    category: "foreign-tax-credit",
    eventDate: "2025-08-15",
    specifiedDate: "2025-07-31",
    dateRule:
      "Last calendar day of the month immediately preceding the foreign-tax payment or deduction month.",
    classificationReview: false,
    status: "derived",
  });
});
