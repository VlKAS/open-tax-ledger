import { parseCsv } from "./ibkr.js";
import {
  deriveRule115SpecifiedDate,
  deriveRule128ForeignTaxDate,
} from "./rule115.js";

const SBI_LIMITS = Object.freeze({
  maxRows: 10_000,
  maxColumns: 32,
  maxCellCharacters: 2_000,
});
const MAX_SEC_JSON_CHARACTERS = 12_000_000;
const MAX_SEC_ROWS = 100_000;
const MAX_SEC_FIELDS = 24;
const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function parseSbiReferenceRatesCsv(input, options = {}) {
  const rows = parseCsv(input, SBI_LIMITS);
  if (rows.length === 0) {
    return referenceTable([], options);
  }

  const headers = rows[0].map(normalizeHeader);
  const dateIndex = findHeader(headers, ["date"]);
  const ttBuyIndex = findHeader(headers, ["tt buy", "tt_buy", "ttbuy", "tt buying", "tt buying rate"]);
  const sourceIndex = findHeader(headers, [
    "source url",
    "source_url",
    "url",
    "pdf",
    "pdf file",
    "pdf url",
  ]);

  if (dateIndex === -1 || ttBuyIndex === -1) {
    throw new Error("SBI reference CSV must include DATE and TT BUY columns");
  }

  const byObservation = new Map();
  for (const row of rows.slice(1)) {
    const parsedDate = normalizeDateTime(row[dateIndex]);
    const ttBuy = numberValue(row[ttBuyIndex]);
    if (!parsedDate || !Number.isFinite(ttBuy) || ttBuy <= 0) {
      continue;
    }

    const sourceUrl = sourceIndex === -1 ? "" : String(row[sourceIndex] ?? "").trim();
    const key = `${parsedDate.timestamp}\u0000${ttBuy}`;
    byObservation.set(key, {
      date: parsedDate.date,
      timestamp: parsedDate.timestamp,
      currency: "USD",
      ttBuy,
      sourceUrl,
    });
  }

  return referenceTable(
    [...byObservation.values()].sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.ttBuy - right.ttBuy,
    ),
    options,
  );
}

export function lookupUsdTtBuyRate(table, date) {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) {
    return {
      status: "invalid-date",
      date: "",
      currency: "USD",
      rate: null,
      sourceUrl: "",
    };
  }

  const records = Array.isArray(table) ? table : table?.records;
  const matches =
    records?.filter((item) => item.date === normalizedDate && item.currency === "USD") ?? [];
  if (matches.length === 0) {
    return {
      status: "missing",
      date: normalizedDate,
      currency: "USD",
      rate: null,
      sourceUrl: "",
    };
  }

  const distinctRates = [...new Set(matches.map((item) => item.ttBuy))];
  if (distinctRates.length > 1) {
    return {
      status: "ambiguous",
      date: normalizedDate,
      currency: "USD",
      rate: null,
      sourceUrl: "",
      observations: matches.map(({ timestamp, ttBuy, sourceUrl }) => ({
        timestamp,
        rate: ttBuy,
        sourceUrl,
      })),
    };
  }

  const [record] = matches;
  return {
        status: "matched",
        date: normalizedDate,
        currency: "USD",
        rate: record.ttBuy,
        sourceUrl: record.sourceUrl,
      };
}

export function parseSecCompanyTickersExchange(input, options = {}) {
  const payload = parseSecPayload(input);
  if (!Array.isArray(payload.fields) || !Array.isArray(payload.data)) {
    throw new Error("SEC ticker snapshot must include fields and data arrays");
  }

  if (payload.fields.length === 0 || payload.fields.length > MAX_SEC_FIELDS) {
    throw new Error(`SEC ticker snapshot fields exceed the ${MAX_SEC_FIELDS.toLocaleString("en-IN")} field limit`);
  }

  if (payload.data.length > MAX_SEC_ROWS) {
    throw new Error(`SEC ticker snapshot exceeds the ${MAX_SEC_ROWS.toLocaleString("en-IN")} row limit`);
  }

  const fields = payload.fields.map((field) => normalizeHeader(field));
  const cikIndex = findHeader(fields, ["cik"]);
  const nameIndex = findHeader(fields, ["name", "company name", "title"]);
  const tickerIndex = findHeader(fields, ["ticker", "symbol"]);
  const exchangeIndex = findHeader(fields, ["exchange"]);

  if (cikIndex === -1 || nameIndex === -1 || tickerIndex === -1 || exchangeIndex === -1) {
    throw new Error("SEC ticker snapshot must include cik, name, ticker, and exchange fields");
  }

  const entries = new Map();
  const ambiguous = new Set();
  for (const row of payload.data) {
    if (!Array.isArray(row)) {
      continue;
    }

    const ticker = normalizeTicker(row[tickerIndex]);
    if (!ticker) {
      continue;
    }

    const entry = {
      ticker,
      name: cleanText(row[nameIndex]),
      exchange: cleanText(row[exchangeIndex]),
      cik: cleanText(row[cikIndex]),
      provider: options.provider ?? "SEC EDGAR company_tickers_exchange",
      confidence: "sec-ticker-only",
    };

    const existing = entries.get(ticker);
    if (existing && !sameCompanyEntry(existing, entry)) {
      ambiguous.add(ticker);
      continue;
    }
    entries.set(ticker, entry);
  }

  for (const ticker of ambiguous) {
    const entry = entries.get(ticker);
    if (entry) {
      entries.set(ticker, {
        ...entry,
        confidence: "ambiguous-ticker",
      });
    }
  }

  return {
    provider: options.provider ?? "SEC EDGAR company_tickers_exchange",
    sourceUrl: options.sourceUrl ?? "",
    asOf: options.asOf ?? "",
    entries: Object.freeze(Object.fromEntries([...entries.entries()].sort())),
    ambiguousTickers: [...ambiguous].sort(),
    count: entries.size,
  };
}

export function enrichReviewWithReferenceData(review, options = {}) {
  const companyLookup = options.companyLookup?.entries ?? options.companyLookup ?? {};
  const rateTable = options.usdTtBuyRates ?? options.rateTable ?? { records: [] };
  const cloned = deepClone(review);
  const schedules = cloned.schedules ?? {};
  const enrichedSchedules = {
    ...schedules,
    capitalGains: enrichSecurityRows(schedules.capitalGains, companyLookup).map((row) =>
      attachRule115Conversion(row, "capital-gains", "realizedProfitLoss", rateTable),
    ),
    fsi: enrichDescriptionRows(schedules.fsi, companyLookup).map((row) =>
      attachRule115Conversion(
        row,
        row.incomeType === "dividend" ? "dividend" : "other-sources",
        "amount",
        rateTable,
      ),
    ),
    tr: enrichDescriptionRows(schedules.tr, companyLookup).map((row) =>
      attachRule128Conversion(row, "taxPaid", rateTable),
    ),
    fa: enrichSecurityRows(schedules.fa, companyLookup),
  };
  const conversionSummary = summarizeConversions(enrichedSchedules);

  return {
    ...cloned,
    schedules: enrichedSchedules,
    validations: reconcileConversionValidations(
      cloned.validations,
      enrichedSchedules,
      conversionSummary,
      rateTable,
    ),
    conversionSummary,
    referenceData: {
      usdTtBuyRates: summarizeRateTable(rateTable),
      companyLookup: summarizeCompanyLookup(options.companyLookup),
    },
  };
}

function attachRule115Conversion(row, category, amountKey, rateTable) {
  return attachConversion(
    row,
    deriveRule115SpecifiedDate({
      category,
      eventDate: row.date,
    }),
    amountKey,
    rateTable,
  );
}

function attachRule128Conversion(row, amountKey, rateTable) {
  return attachConversion(
    row,
    deriveRule128ForeignTaxDate(row.date),
    amountKey,
    rateTable,
  );
}

function attachConversion(row, derivedDate, amountKey, rateTable) {
  const currency = String(row.currency ?? "").trim().toUpperCase();
  const amount = finiteNumber(row[amountKey]);
  const match = resolveRate(rateTable, currency, derivedDate.specifiedDate);
  const converted =
    (match.status === "matched" || match.status === "not-required") &&
    amount !== null &&
    Number.isFinite(match.rate)
      ? roundMoney(amount * match.rate)
      : null;

  return {
    ...row,
    needsFx: !["matched", "not-required"].includes(match.status),
    conversion: {
      ...derivedDate,
      status: match.status,
      rate: match.rate,
      sourceUrl: match.sourceUrl,
      observations: match.observations ?? [],
      currency,
      amountForeign: amount,
      amountInr: converted,
      exactDateOnly: true,
    },
  };
}

function resolveRate(rateTable, currency, specifiedDate) {
  if (!specifiedDate) {
    return {
      status: "invalid-date",
      rate: null,
      sourceUrl: "",
    };
  }

  if (currency === "INR") {
    return {
      status: "not-required",
      rate: 1,
      sourceUrl: "",
    };
  }

  if (currency !== "USD") {
    return {
      status: "unsupported-currency",
      rate: null,
      sourceUrl: "",
    };
  }

  return lookupUsdTtBuyRate(rateTable, specifiedDate);
}

function summarizeConversions(schedules) {
  const capitalGains = schedules.capitalGains ?? [];
  const fsi = schedules.fsi ?? [];
  const tr = schedules.tr ?? [];
  const rows = [...capitalGains, ...fsi, ...tr].filter((row) => row.conversion);
  const statuses = rows.map((row) => row.conversion.status);
  const dates = new Map();

  for (const row of rows) {
    const conversion = row.conversion;
    const key = [
      conversion.authority,
      conversion.category,
      conversion.specifiedDate,
      conversion.currency,
    ].join("\u0000");
    if (!dates.has(key)) {
      dates.set(key, {
        authority: conversion.authority,
        category: conversion.category,
        eventDate: conversion.eventDate,
        specifiedDate: conversion.specifiedDate,
        dateRule: conversion.dateRule,
        currency: conversion.currency,
        status: conversion.status,
        rate: conversion.rate,
        sourceUrl: conversion.sourceUrl,
        classificationReview: conversion.classificationReview,
      });
    }
  }

  const dividends = fsi.filter((row) => row.incomeType === "dividend");
  const interest = fsi.filter((row) => row.incomeType !== "dividend");

  const dateLedger = [...dates.values()].sort(
    (left, right) =>
      left.specifiedDate.localeCompare(right.specifiedDate) ||
      left.authority.localeCompare(right.authority) ||
      left.category.localeCompare(right.category),
  );

  return {
    total: rows.length,
    matched: statuses.filter((status) => status === "matched").length,
    missing: statuses.filter((status) => status === "missing").length,
    ambiguous: statuses.filter((status) => status === "ambiguous").length,
    unsupported: statuses.filter((status) =>
      ["invalid-date", "unsupported-currency"].includes(status),
    ).length,
    notRequired: statuses.filter((status) => status === "not-required").length,
    dates: dateLedger.length,
    dateLedger,
    totalsInr: {
      capitalGains: sumConverted(capitalGains),
      dividends: sumConverted(dividends),
      interest: sumConverted(interest),
      foreignTax: sumConverted(tr),
    },
    completeness: {
      capitalGains: conversionCompleteness(capitalGains),
      dividends: conversionCompleteness(dividends),
      interest: conversionCompleteness(interest),
      foreignTax: conversionCompleteness(tr),
    },
  };
}

function reconcileConversionValidations(
  validations = [],
  schedules,
  conversionSummary,
  rateTable,
) {
  const generatedCodes = new Set([
    "MISSING_FX",
    "RULE_RATE_EVIDENCE_MISSING",
    "UNSUPPORTED_FX_CURRENCY",
    "INTEREST_CLASSIFICATION_REVIEW",
    "FA_FX_REVIEW_REQUIRED",
    "COMMUNITY_RATE_EVIDENCE",
  ]);
  const next = validations.filter((validation) => !generatedCodes.has(validation.code));

  if (
    conversionSummary.missing > 0 ||
    conversionSummary.ambiguous > 0 ||
    conversionSummary.unsupported > 0
  ) {
    next.push({
      severity: "warning",
      code: "RULE_RATE_EVIDENCE_MISSING",
      message:
        "One or more automatically derived conversion dates lack a single exact USD TT BUY observation. No prior-business-day fallback was applied.",
      details: {
        missing: conversionSummary.missing,
        ambiguous: conversionSummary.ambiguous,
        unsupported: conversionSummary.unsupported,
      },
    });
  }

  if (
    [...(schedules.capitalGains ?? []), ...(schedules.fsi ?? []), ...(schedules.tr ?? [])]
      .some((row) => row.conversion?.status === "unsupported-currency")
  ) {
    next.push({
      severity: "warning",
      code: "UNSUPPORTED_FX_CURRENCY",
      message:
        "Automatic conversion currently supports USD reference rows only; other currencies remain for manual review.",
    });
  }

  if ((schedules.fsi ?? []).some((row) => row.conversion?.classificationReview)) {
    next.push({
      severity: "info",
      code: "INTEREST_CLASSIFICATION_REVIEW",
      message:
        "IBKR Interest rows default to other-source interest and use the financial-year end. Confirm whether any row is interest on securities.",
    });
  }

  if ((schedules.fa ?? []).some((row) => row.currency && row.currency !== "INR")) {
    next.push({
      severity: "warning",
      code: "FA_FX_REVIEW_REQUIRED",
      message:
        "Schedule FA peak and closing-value conversion is not inferred from Rule 115 income dates and remains a reviewer task.",
    });
  }

  if (
    conversionSummary.matched > 0 &&
    /community/i.test(`${rateTable?.provider ?? ""} ${rateTable?.license ?? ""}`)
  ) {
    next.push({
      severity: "info",
      code: "COMMUNITY_RATE_EVIDENCE",
      message:
        "Matched TT BUY values come from the bundled community archive. Retain and verify primary SBI evidence for material dates.",
    });
  }

  return next;
}

function conversionCompleteness(rows) {
  return {
    total: rows.length,
    converted: rows.filter((row) =>
      ["matched", "not-required"].includes(row.conversion?.status),
    ).length,
  };
}

function sumConverted(rows) {
  return roundMoney(
    rows.reduce(
      (total, row) =>
        Number.isFinite(row.conversion?.amountInr)
          ? total + row.conversion.amountInr
          : total,
      0,
    ),
  );
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function enrichSecurityRows(rows = [], lookup = {}) {
  return rows.map((row) => {
    const ticker = normalizeTicker(row.symbol);
    return {
      ...row,
      company: companyMatch(ticker, lookup),
    };
  });
}

function enrichDescriptionRows(rows = [], lookup = {}) {
  return rows.map((row) => {
    const ticker = inferTickerFromDescription(row.description, lookup);
    return {
      ...row,
      company: companyMatch(ticker, lookup),
    };
  });
}

function companyMatch(ticker, lookup) {
  const entry = ticker ? lookup[ticker] : null;
  if (!entry) {
    return {
      status: "unmatched",
      ticker: ticker ?? "",
      name: "",
      exchange: "",
      cik: "",
      provider: "",
      confidence: "none",
    };
  }

  return {
    status: entry.confidence === "ambiguous-ticker" ? "ambiguous" : "matched",
    ticker: entry.ticker,
    name: entry.name,
    exchange: entry.exchange,
    cik: entry.cik,
    provider: entry.provider,
    confidence: entry.confidence,
  };
}

function inferTickerFromDescription(description, lookup) {
  const tokens = String(description ?? "")
    .toUpperCase()
    .match(/[A-Z][A-Z0-9.-]{0,9}/g);
  return tokens?.find((token) => Object.hasOwn(lookup, token)) ?? "";
}

function referenceTable(records, options) {
  return {
    provider: options.provider ?? "SBI TT buying-rate reference",
    sourceUrl: options.sourceUrl ?? "",
    license: options.license ?? "",
    asOf: options.asOf ?? "",
    records,
    count: records.length,
  };
}

function summarizeRateTable(table) {
  const records = Array.isArray(table) ? table : table?.records ?? [];
  return {
    provider: table?.provider ?? "SBI TT buying-rate reference",
    sourceUrl: table?.sourceUrl ?? "",
    license: table?.license ?? "",
    asOf: table?.asOf ?? "",
    currency: "USD",
    records: records.length,
    firstDate: records[0]?.date ?? "",
    lastDate: records.at(-1)?.date ?? "",
  };
}

function summarizeCompanyLookup(lookup) {
  const entries = lookup?.entries ?? lookup ?? {};
  return {
    provider: lookup?.provider ?? "SEC EDGAR company_tickers_exchange",
    sourceUrl: lookup?.sourceUrl ?? "",
    asOf: lookup?.asOf ?? "",
    records: Object.keys(entries).length,
    ambiguousTickers: lookup?.ambiguousTickers ?? [],
  };
}

function parseSecPayload(input) {
  if (typeof input === "string") {
    if (input.length > MAX_SEC_JSON_CHARACTERS) {
      throw new Error(
        `SEC ticker snapshot exceeds the ${MAX_SEC_JSON_CHARACTERS.toLocaleString("en-IN")} character limit`,
      );
    }
    return JSON.parse(input);
  }

  if (input && typeof input === "object") {
    return input;
  }

  throw new TypeError("SEC ticker snapshot must be a JSON string or object");
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findHeader(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function normalizeDateTime(value) {
  const raw = String(value ?? "").trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2})?$/);
  if (iso) {
    return {
      date: iso[1],
      timestamp: raw.replace("T", " "),
    };
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, day, month, year] = slash;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return { date, timestamp: date };
  }

  return null;
}

function normalizeDate(value) {
  return normalizeDateTime(value)?.date ?? "";
}

function numberValue(value) {
  const normalized = String(value ?? "").replace(/[,₹$]/g, "").trim();
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function normalizeTicker(value) {
  const ticker = String(value ?? "")
    .trim()
    .toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function sameCompanyEntry(left, right) {
  return left.cik === right.cik && left.name === right.name && left.exchange === right.exchange;
}

function deepClone(value) {
  if (globalThis.structuredClone) {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
