const COUNTRY_NAMES = Object.freeze({
  AU: "Australia",
  CA: "Canada",
  CH: "Switzerland",
  DE: "Germany",
  FR: "France",
  GB: "United Kingdom",
  IE: "Ireland",
  IN: "India",
  JP: "Japan",
  KR: "South Korea",
  NL: "Netherlands",
  SG: "Singapore",
  TW: "Taiwan",
  US: "United States",
});

export function buildTaxSummary(
  review,
  { marginalTaxRate = 0, dtaaSection = "90" } = {},
) {
  const schedules = review?.schedules ?? {};
  const countryByTicker = countryMapFromTaxRows(schedules.tr ?? []);
  const byCountry = new Map();
  const coverage = {
    totalRows: 0,
    convertedRows: 0,
    missingRows: 0,
    verifiedRows: 0,
    priorObservationRows: 0,
  };

  for (const row of schedules.capitalGains ?? []) {
    const code = countryForSecurityRow(row, countryByTicker);
    const group = ensureCountry(byCountry, code);
    const amount = convertedAmount(row);
    recordConversionCoverage(group, coverage, row, amount);
    if (amount === null) continue;
    if (row.gainBucket === "LTCG") {
      group.ltcg += amount;
    } else {
      group.stcg += amount;
    }
  }

  for (const row of schedules.fsi ?? []) {
    const code = countryForSecurityRow(row, countryByTicker);
    const group = ensureCountry(byCountry, code);
    const amount = convertedAmount(row);
    recordConversionCoverage(group, coverage, row, amount);
    if (amount === null) continue;
    if (row.incomeType === "dividend") {
      group.dividends += amount;
    } else {
      group.interest += amount;
    }
  }

  for (const row of schedules.tr ?? []) {
    const code = countryForTaxRow(row);
    const group = ensureCountry(byCountry, code);
    const amount = convertedAmount(row);
    recordConversionCoverage(group, coverage, row, amount);
    if (amount === null) continue;
    group.foreignTax += amount;
  }

  const rate = finiteRate(marginalTaxRate);
  const rows = [...byCountry.values()]
    .map((row) => {
      const slabIncome = row.stcg + row.dividends + row.interest;
      const indianTax = Math.max(
        0,
        Math.round(row.ltcg * 0.125 + slabIncome * rate),
      );
      const foreignIncome = row.stcg + row.ltcg + row.dividends + row.interest;
      const relief = Math.max(0, Math.min(row.foreignTax, indianTax));
      return {
        ...row,
        stcg: roundInr(row.stcg),
        ltcg: roundInr(row.ltcg),
        dividends: roundInr(row.dividends),
        interest: roundInr(row.interest),
        foreignIncome: roundInr(foreignIncome),
        foreignTax: roundInr(row.foreignTax),
        indianTax,
        relief,
        conversionComplete: row.missingConversionRows === 0,
        evidenceReady:
          row.missingConversionRows === 0 &&
          row.priorObservationRows === 0,
        dtaaSection: String(dtaaSection || "90"),
        form67Required: relief > 0,
      };
    })
    .filter(
      (row) =>
        row.foreignIncome !== 0 ||
        row.foreignTax !== 0 ||
        row.conversionRows > 0,
    )
    .sort((left, right) => left.country.localeCompare(right.country));

  return {
    marginalTaxRate: rate,
    rows,
    totals: {
      stcg: sum(rows, "stcg"),
      ltcg: sum(rows, "ltcg"),
      dividends: sum(rows, "dividends"),
      interest: sum(rows, "interest"),
      foreignIncome: sum(rows, "foreignIncome"),
      foreignTax: sum(rows, "foreignTax"),
      indianTax: sum(rows, "indianTax"),
      relief: sum(rows, "relief"),
    },
    form67Required: rows.some((row) => row.form67Required),
    unclassifiedRows: rows.filter((row) => row.countryCode === "ZZ").length,
    coverage: {
      ...coverage,
      complete: coverage.missingRows === 0,
      evidenceReady:
        coverage.missingRows === 0 &&
        coverage.priorObservationRows === 0,
    },
  };
}

export function countryCodeFromTaxDescription(value) {
  const text = String(value ?? "").toUpperCase();
  const explicit = text.match(/\b([A-Z]{2})\s+TAX\b/);
  if (explicit) return explicit[1];
  if (/\bUNITED STATES\b|\bU\.?S\.? TAX\b/.test(text)) return "US";
  if (/\bTAIWAN\b/.test(text)) return "TW";
  if (/\bNETHERLANDS\b/.test(text)) return "NL";
  return "";
}

function countryMapFromTaxRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const ticker = normalizedTicker(row);
    const code = countryForTaxRow(row);
    if (!ticker || code === "ZZ") continue;
    const existing = map.get(ticker);
    if (!existing) {
      map.set(ticker, code);
    } else if (existing !== code) {
      map.set(ticker, "ZZ");
    }
  }
  return map;
}

function countryForSecurityRow(row, countryByTicker) {
  const explicit = normalizeCountryCode(row?.countryCode);
  if (explicit) return explicit;
  const isin = String(row?.isin ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) return isin.slice(0, 2);
  const ticker = normalizedTicker(row);
  const linked = countryByTicker.get(ticker);
  if (linked) return linked;
  const exchange = String(row?.company?.exchange ?? "").toUpperCase();
  if (["NASDAQ", "NYSE", "NYSE ARCA", "CBOE", "AMEX"].includes(exchange)) {
    return "US";
  }
  return "ZZ";
}

function countryForTaxRow(row) {
  return (
    normalizeCountryCode(row?.countryCode) ||
    normalizeCountryCode(countryCodeFromTaxDescription(row?.description)) ||
    "ZZ"
  );
}

function ensureCountry(map, code) {
  const normalized = normalizeCountryCode(code) || "ZZ";
  if (!map.has(normalized)) {
    map.set(normalized, {
      countryCode: normalized,
      country: COUNTRY_NAMES[normalized] ?? "Unclassified",
      stcg: 0,
      ltcg: 0,
      dividends: 0,
      interest: 0,
      foreignTax: 0,
      conversionRows: 0,
      missingConversionRows: 0,
      priorObservationRows: 0,
    });
  }
  return map.get(normalized);
}

function recordConversionCoverage(group, coverage, row, amount) {
  coverage.totalRows += 1;
  group.conversionRows += 1;
  if (amount === null) {
    coverage.missingRows += 1;
    group.missingConversionRows += 1;
    return;
  }
  coverage.convertedRows += 1;
  if (row?.conversion?.selection === "prior-observation") {
    coverage.priorObservationRows += 1;
    group.priorObservationRows += 1;
  } else {
    coverage.verifiedRows += 1;
  }
}

function normalizeCountryCode(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function normalizedTicker(row) {
  return String(row?.company?.ticker || row?.symbol || "")
    .trim()
    .toUpperCase();
}

function convertedAmount(row) {
  const value = row?.conversion?.amountInr;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : 0;
}

function roundInr(value) {
  return Math.round(Number(value) || 0);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}
