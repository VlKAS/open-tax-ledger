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

export function lookupUsdTtBuyRateOnOrBefore(table, date, { maxDays = 7 } = {}) {
  const exact = lookupUsdTtBuyRate(table, date);
  const specifiedDate = exact.date;
  if (exact.status !== "missing") {
    return {
      ...exact,
      specifiedDate,
      observationDate: exact.status === "matched" || exact.status === "ambiguous" ? specifiedDate : "",
      selection: exact.status === "matched" || exact.status === "ambiguous" ? "exact" : "",
      daysPrior: exact.status === "matched" || exact.status === "ambiguous" ? 0 : null,
    };
  }

  const windowDays = Number.isFinite(Number(maxDays)) ? Math.max(0, Number(maxDays)) : 7;
  const specifiedTimestamp = Date.parse(`${specifiedDate}T00:00:00Z`);
  const records = Array.isArray(table) ? table : table?.records;
  const candidates =
    records?.filter((item) => {
      if (item.currency !== "USD" || !item.date) {
        return false;
      }
      const daysPrior = dateDifferenceInDays(specifiedDate, item.date);
      return daysPrior !== null && daysPrior > 0 && daysPrior <= windowDays;
    }) ?? [];
  if (!Number.isFinite(specifiedTimestamp) || candidates.length === 0) {
    return {
      ...exact,
      specifiedDate,
      observationDate: "",
      selection: "",
      daysPrior: null,
    };
  }

  const observationDate = candidates
    .map((item) => item.date)
    .sort((left, right) => right.localeCompare(left))[0];
  const matches = candidates.filter((item) => item.date === observationDate);
  const daysPrior = dateDifferenceInDays(specifiedDate, observationDate);
  const distinctRates = [...new Set(matches.map((item) => item.ttBuy))];
  if (distinctRates.length > 1) {
    return {
      status: "ambiguous",
      date: specifiedDate,
      specifiedDate,
      observationDate,
      selection: "prior-observation",
      daysPrior,
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
    date: specifiedDate,
    specifiedDate,
    observationDate,
    selection: "prior-observation",
    daysPrior,
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
  const capitalGains = enrichSecurityRows(schedules.capitalGains, companyLookup).map((row) =>
    attachRule115Conversion(
      row,
      "capital-gains",
      Object.hasOwn(row, "gain") ? "gain" : "realizedProfitLoss",
      rateTable,
    ),
  );
  const fa = enrichSecurityRows(schedules.fa, companyLookup).map((row) =>
    attachScheduleFaConversions(row, rateTable),
  );
  const holdings = enrichSecurityRows(schedules.holdings, companyLookup).map((row) =>
    attachScheduleFaHoldingConversion(row, rateTable),
  );
  const enrichedSchedules = {
    ...schedules,
    capitalGains,
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
    fa,
    holdings,
  };
  const conversionSummary = summarizeConversions(enrichedSchedules);
  const faConversionSummary = summarizeFaConversions(enrichedSchedules);

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
    faConversionSummary,
    referenceData: {
      usdTtBuyRates: summarizeRateTable(rateTable),
      companyLookup: summarizeCompanyLookup(options.companyLookup),
    },
  };
}

function attachScheduleFaConversions(row, rateTable) {
  const initial = attachValueDateConversion(
    row.currency,
    row.acquisitionDate,
    row.initialValue,
    "initial-value",
    rateTable,
  );
  const peak = attachValueDateConversion(
    row.currency,
    row.peakDate,
    row.peakValue,
    "peak-value",
    rateTable,
  );
  const closing = attachValueDateConversion(
    row.currency,
    row.closingDate,
    row.closingValue,
    "closing-value",
    rateTable,
  );

  return {
    ...row,
    valueConversions: { initial, peak, closing },
    initialValueInr: initial.amountInr,
    peakValueInr: peak.amountInr,
    closingValueInr: closing.amountInr,
  };
}

function attachScheduleFaHoldingConversion(row, rateTable) {
  const conversion = attachValueDateConversion(
    row.currency,
    row.snapshotDate,
    row.value,
    "latest-holding-value",
    rateTable,
  );
  return {
    ...row,
    conversion,
    valueInr: conversion.amountInr,
    needsFx: !["matched", "not-required"].includes(conversion.status),
  };
}

function attachValueDateConversion(currencyValue, eventDate, amountValue, category, rateTable) {
  const currency = String(currencyValue ?? "").trim().toUpperCase();
  const amount = finiteNumber(amountValue);
  const derivedDate = {
    authority: "Schedule FA instructions",
    category,
    eventDate: eventDate ?? "",
    specifiedDate: eventDate ?? "",
    dateRule: "TT buying rate for the date of the reported foreign-asset value.",
    classificationReview: false,
  };
  if (amount === null) {
    return {
      ...derivedDate,
      status: "missing-value",
      rate: null,
      sourceUrl: "",
      observations: [],
      observationDate: "",
      selection: "",
      daysPrior: null,
      currency,
      amountForeign: null,
      amountInr: null,
      exactDateOnly: false,
    };
  }
  return attachConversion({}, derivedDate, "amount", rateTable, {
    currency,
    amount,
  }).conversion;
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

function attachConversion(row, derivedDate, amountKey, rateTable, overrides = {}) {
  const currency = String(overrides.currency ?? row.currency ?? "").trim().toUpperCase();
  const amount = Object.hasOwn(overrides, "amount")
    ? finiteNumber(overrides.amount)
    : finiteNumber(row[amountKey]);
  const match = resolveRate(rateTable, currency, derivedDate.specifiedDate);
  const converted =
    (match.status === "matched" || match.status === "not-required") &&
    amount !== null &&
    Number.isFinite(match.rate)
      ? Math.round(amount * match.rate)
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
      observationDate: match.observationDate ?? "",
      selection: match.selection ?? "",
      daysPrior: match.daysPrior ?? null,
      currency,
      amountForeign: amount,
      amountInr: converted,
      exactDateOnly: match.selection === "exact" || match.status === "not-required",
    },
  };
}

function summarizeFaConversions(schedules) {
  const entityConversions = (schedules.fa ?? []).flatMap((row) =>
    Object.entries(row.valueConversions ?? {}).map(([field, conversion]) => ({
      field,
      symbol: row.symbol,
      conversion,
    })),
  );
  const holdingConversions = (schedules.holdings ?? []).map((row) => ({
    field: "holding",
    symbol: row.symbol,
    conversion: row.conversion,
  }));
  const rows = [...entityConversions, ...holdingConversions].filter(
    (row) => row.conversion,
  );
  const completeStatuses = new Set(["matched", "not-required"]);
  const holdings = holdingConversions.filter((row) => row.conversion);
  const evidenceReady = (conversion) =>
    conversion.status === "not-required" ||
    (conversion.status === "matched" && conversion.selection === "exact");

  return {
    rows: rows.length,
    convertedRows: rows.filter((row) => completeStatuses.has(row.conversion.status)).length,
    verifiedRows: rows.filter((row) => evidenceReady(row.conversion)).length,
    priorObservationRows: rows.filter(
      (row) =>
        row.conversion.status === "matched" &&
        row.conversion.selection === "prior-observation",
    ).length,
    missingRows: rows.filter((row) => !completeStatuses.has(row.conversion.status)).length,
    holdings: {
      total: holdings.length,
      converted: holdings.filter((row) => completeStatuses.has(row.conversion.status)).length,
      verified: holdings.filter((row) => evidenceReady(row.conversion)).length,
      priorObservation: holdings.filter(
        (row) =>
          row.conversion.status === "matched" &&
          row.conversion.selection === "prior-observation",
      ).length,
      amountInr: holdings.reduce(
        (total, row) =>
          Number.isFinite(row.conversion.amountInr)
            ? total + row.conversion.amountInr
            : total,
        0,
      ),
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

  return lookupUsdTtBuyRateOnOrBefore(rateTable, specifiedDate);
}

function summarizeConversions(schedules) {
  const capitalGains = schedules.capitalGains ?? [];
  const fsi = schedules.fsi ?? [];
  const tr = schedules.tr ?? [];
  const rows = [...capitalGains, ...fsi, ...tr].filter((row) => row.conversion);
  const statuses = rows.map((row) => row.conversion.status);
  const dates = new Map();
  const specifiedDates = new Set();

  for (const row of rows) {
    const conversion = row.conversion;
    if (conversion.specifiedDate) {
      specifiedDates.add(conversion.specifiedDate);
    }
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
        observationDate: conversion.observationDate,
        selection: conversion.selection,
        daysPrior: conversion.daysPrior,
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
  const matchedRows = statuses.filter((status) => status === "matched").length;
  const exactMatchedRows = rows.filter(
    (row) =>
      row.conversion.status === "matched" &&
      row.conversion.selection === "exact",
  ).length;
  const priorObservationRows = rows.filter(
    (row) =>
      row.conversion.status === "matched" &&
      row.conversion.selection === "prior-observation",
  ).length;
  const missingRows = statuses.filter((status) => status === "missing").length;
  const ambiguousRows = statuses.filter((status) => status === "ambiguous").length;
  const unsupportedRows = statuses.filter((status) =>
    ["invalid-date", "unsupported-currency"].includes(status),
  ).length;
  const notRequiredRows = statuses.filter((status) => status === "not-required").length;

  return {
    total: rows.length,
    totalRows: rows.length,
    conversionRows: rows.length,
    matched: matchedRows,
    matchedRows,
    exactMatchedRows,
    priorObservationRows,
    missing: missingRows,
    missingRows,
    ambiguous: ambiguousRows,
    ambiguousRows,
    unsupported: unsupportedRows,
    unsupportedRows,
    notRequired: notRequiredRows,
    notRequiredRows,
    dates: dateLedger.length,
    dateBucketCount: dateLedger.length,
    matchedDateBucketCount: dateLedger.filter((row) => row.status === "matched").length,
    priorObservationDateBucketCount: dateLedger.filter(
      (row) => row.status === "matched" && row.selection === "prior-observation",
    ).length,
    distinctSpecifiedDateCount: specifiedDates.size,
    specifiedDates: [...specifiedDates].sort(),
    dateBuckets: dateLedger,
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
    "PRIOR_OBSERVATION_RATE_USED",
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
        "One or more automatically derived conversion dates lack a usable USD TT BUY observation. The app uses the latest published observation on or before the statutory date only within a seven-day evidence window.",
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

  if (
    (schedules.fa ?? []).some((row) =>
      Object.values(row.valueConversions ?? {}).some(
        (conversion) =>
          !["matched", "not-required"].includes(conversion?.status),
      ),
    )
  ) {
    next.push({
      severity: "warning",
      code: "FA_FX_REVIEW_REQUIRED",
      message:
        "One or more Schedule FA values lack a usable value date, source amount, or TT buying-rate observation and remain reviewer tasks.",
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

  const priorObservationRows = [
    ...(schedules.capitalGains ?? []),
    ...(schedules.fsi ?? []),
    ...(schedules.tr ?? []),
  ].filter((row) => row.conversion?.selection === "prior-observation");
  const priorFaConversions = [
    ...(schedules.fa ?? []).flatMap((row) =>
      Object.values(row.valueConversions ?? {}),
    ),
    ...(schedules.holdings ?? []).map((row) => row.conversion),
  ].filter((conversion) => conversion?.selection === "prior-observation");
  const allPriorConversions = [
    ...priorObservationRows.map((row) => row.conversion),
    ...priorFaConversions,
  ];
  if (allPriorConversions.length > 0) {
    next.push({
      severity: "info",
      code: "PRIOR_OBSERVATION_RATE_USED",
      message:
        "One or more prescribed or foreign-asset value dates used the latest available USD TT BUY observation on or before that date.",
      details: {
        rows: allPriorConversions.length,
        dates: [
          ...new Set(
            allPriorConversions.map((conversion) =>
              [
                conversion.specifiedDate,
                conversion.observationDate,
                conversion.daysPrior,
              ].join("|"),
            ),
          ),
        ].map((entry) => {
          const [specifiedDate, observationDate, daysPrior] = entry.split("|");
          return {
            specifiedDate,
            observationDate,
            daysPrior: Number(daysPrior),
          };
        }),
      },
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
    verified: rows.filter(
      (row) =>
        row.conversion?.status === "not-required" ||
        (row.conversion?.status === "matched" &&
          row.conversion?.selection === "exact"),
    ).length,
    priorObservation: rows.filter(
      (row) =>
        row.conversion?.status === "matched" &&
        row.conversion?.selection === "prior-observation",
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
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
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
    const ticker =
      normalizeTicker(row.symbol) ||
      inferTickerFromDescription(row.description, lookup);
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

function dateDifferenceInDays(laterDate, earlierDate) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) {
    return null;
  }
  return Math.round((later - earlier) / 86_400_000);
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
