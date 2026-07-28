const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const RULE_115_DATE_RULES = Object.freeze({
  "capital-gains": Object.freeze({
    derive: lastDayOfPreviousMonth,
    dateRule:
      "Last calendar day of the month immediately preceding the transfer month.",
    classificationReview: false,
  }),
  dividend: Object.freeze({
    derive: lastDayOfPreviousMonth,
    dateRule:
      "Last calendar day of the month immediately preceding the statement payment month.",
    classificationReview: false,
  }),
  "interest-on-securities": Object.freeze({
    derive: lastDayOfPreviousMonth,
    dateRule:
      "Last calendar day of the month immediately preceding the month in which the interest is due.",
    classificationReview: true,
  }),
  "other-sources": Object.freeze({
    derive: indianFinancialYearEnd,
    dateRule:
      "Last day of the Indian financial year containing the statement date.",
    classificationReview: true,
  }),
  "business-income": Object.freeze({
    derive: indianFinancialYearEnd,
    dateRule:
      "Last day of the Indian financial year containing the statement date.",
    classificationReview: true,
  }),
});

export function lastDayOfPreviousMonth(value) {
  const parts = validDateParts(value);
  if (!parts) return "";

  const date = new Date(Date.UTC(parts.year, parts.month - 1, 0));
  return date.toISOString().slice(0, 10);
}

export function indianFinancialYearEnd(value) {
  const parts = validDateParts(value);
  if (!parts) return "";

  const endYear = parts.month >= 4 ? parts.year + 1 : parts.year;
  return `${endYear}-03-31`;
}

export function deriveRule115SpecifiedDate({ category, eventDate }) {
  const rule = RULE_115_DATE_RULES[category];
  if (!rule) {
    throw new Error(`Unsupported Rule 115 category: ${category}`);
  }

  const normalizedEventDate = normalizeIsoDate(eventDate);
  return {
    authority: "Rule 115",
    category,
    eventDate: normalizedEventDate,
    specifiedDate: normalizedEventDate ? rule.derive(normalizedEventDate) : "",
    dateRule: rule.dateRule,
    classificationReview: rule.classificationReview,
    status: normalizedEventDate ? "derived" : "invalid-event-date",
  };
}

export function deriveRule128ForeignTaxDate(eventDate) {
  const normalizedEventDate = normalizeIsoDate(eventDate);
  return {
    authority: "Rule 128(5)(ii)",
    category: "foreign-tax-credit",
    eventDate: normalizedEventDate,
    specifiedDate: normalizedEventDate
      ? lastDayOfPreviousMonth(normalizedEventDate)
      : "",
    dateRule:
      "Last calendar day of the month immediately preceding the foreign-tax payment or deduction month.",
    classificationReview: false,
    status: normalizedEventDate ? "derived" : "invalid-event-date",
  };
}

function normalizeIsoDate(value) {
  const parts = validDateParts(value);
  if (!parts) return "";
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function validDateParts(value) {
  const match = String(value ?? "").match(ISO_DATE_PATTERN);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}
