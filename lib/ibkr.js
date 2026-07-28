import { buildFifoCapitalGains } from "./fifo.js";
import { deriveScheduleFa } from "./schedule-fa.js";

const STOCK_CATEGORIES = new Set(["STK", "STOCK", "COMMON STOCK"]);
const OPTION_CATEGORIES = new Set(["OPT", "OPTION", "OPTIONS"]);
const SUPPORTED_CASH_SECTIONS = new Set([
  "Dividends",
  "Withholding Tax",
  "Interest",
]);
const DEFAULT_CSV_LIMITS = Object.freeze({
  maxRows: 250_000,
  maxColumns: 256,
  maxCellCharacters: 1_000_000,
});

export const DEMO_ACTIVITY_CSV = `Statement,Header,Field Name,Field Value
Statement,Data,Account,DU1234567
Statement,Data,Base Currency,USD
Statement,Data,Period,"2025-04-01 - 2026-03-31"
Trades,Header,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Basis,Realized P/L
Trades,Data,STK,USD,AAPL,2025-05-10 10:30:00,10,180,-1800,-1,1801,0
Trades,Data,STK,USD,AAPL,2025-05-10 10:30:00,10,180,-1800,-1,1801,0
Trades,Data,STK,USD,AAPL,2026-01-15 15:00:00,-5,210,1050,-1,-900,149
Trades,Data,OPT,USD,AAPL  260117C00200000,2025-06-01 10:00:00,1,12,-1200,-1,1201,0
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2025-08-15,"AAPL CASH DIVIDEND",12.50
Withholding Tax,Header,Currency,Date,Description,Amount
Withholding Tax,Data,USD,2025-08-15,"AAPL US TAX WITHHELD",-3.75
Interest,Header,Currency,Date,Description,Amount
Interest,Data,USD,2025-09-30,"BROKER CREDIT INTEREST",1.25
Open Positions,Header,Asset Category,Currency,Symbol,Quantity,Cost Basis,Close Price,Value,Unrealized P/L
Open Positions,Data,STK,USD,AAPL,5,901,220,1100,199
Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount
Deposits & Withdrawals,Data,USD,2025-04-03,"ACH DEPOSIT",2500
Corporate Actions,Header,Currency,Date,Description,Amount
Corporate Actions,Data,USD,2025-11-01,"SAMPLE SPIN OFF",0
`;

export function parseCsv(input, limits = {}) {
  if (typeof input !== "string") {
    throw new TypeError("parseCsv expects a string");
  }

  const maxRows = positiveLimit(limits.maxRows, DEFAULT_CSV_LIMITS.maxRows);
  const maxColumns = positiveLimit(limits.maxColumns, DEFAULT_CSV_LIMITS.maxColumns);
  const maxCellCharacters = positiveLimit(
    limits.maxCellCharacters,
    DEFAULT_CSV_LIMITS.maxCellCharacters,
  );
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  function appendCharacter(character) {
    if (cell.length >= maxCellCharacters) {
      throw new Error(`CSV field exceeds the ${maxCellCharacters.toLocaleString("en-IN")} character limit`);
    }
    cell += character;
  }

  function appendCell() {
    if (row.length >= maxColumns) {
      throw new Error(`CSV row exceeds the ${maxColumns.toLocaleString("en-IN")} column limit`);
    }
    row.push(cell);
    cell = "";
  }

  function appendRow() {
    appendCell();
    if (rows.length >= maxRows) {
      throw new Error(`CSV exceeds the ${maxRows.toLocaleString("en-IN")} row limit`);
    }
    rows.push(row);
    row = [];
  }

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        appendCharacter('"');
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        appendCharacter(char);
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      appendCell();
    } else if (char === "\n") {
      appendRow();
    } else if (char === "\r") {
      if (next === "\n") {
        continue;
      }
      appendRow();
    } else {
      appendCharacter(char);
    }
  }

  if (quoted) {
    throw new Error("Unclosed quoted CSV field");
  }

  if (cell.length > 0 || row.length > 0) {
    appendRow();
  }

  return rows.filter((fields) => fields.some((field) => field.trim() !== ""));
}

export function parseIbkrStatements(inputs, options = {}) {
  const csvs = Array.isArray(inputs) ? inputs : [inputs];
  const fileNames = options.fileNames ?? csvs.map((_, index) => `statement-${index + 1}.csv`);
  const sections = new Map();
  const duplicates = [];
  const findings = [];
  const seen = new Set();
  const statementPeriodsByFile = new Map();

  for (const [fileIndex, csv] of csvs.entries()) {
    const rows = parseCsv(csv);

    for (const [rowIndex, fields] of rows.entries()) {
      const [sectionName, rowType, ...values] = fields;
      if (!sectionName || !rowType) {
        findings.push(finding("warning", "MALFORMED_ROW", "Ignored a row without section/type columns.", {
          fileIndex,
          rowNumber: rowIndex + 1,
        }));
        continue;
      }

      const section = ensureSection(sections, sectionName.trim());
      const type = rowType.trim().toLowerCase();

      if (type === "header") {
        section.headers = values.map((value) => value.trim());
        continue;
      }

      if (type !== "data") {
        continue;
      }

      const data = mapDataRow(section.headers, values);
      if (
        section.name === "Statement" &&
        pick(data, ["Field Name"]).toLowerCase() === "period"
      ) {
        statementPeriodsByFile.set(fileIndex, pick(data, ["Field Value"]));
      }
      const snapshotContext =
        section.name === "Open Positions"
          ? statementPeriodsByFile.get(fileIndex) || `file-${fileIndex}`
          : "";
      const key = JSON.stringify([
        section.name,
        snapshotContext,
        normalizeComparableRow(data),
      ]);
      const source = {
        fileIndex,
        fileName: fileNames[fileIndex],
        rowNumber: rowIndex + 1,
        section: section.name,
      };

      if (section.name !== "Statement" && seen.has(key)) {
        duplicates.push({
          section: section.name,
          fileIndex,
          rowNumber: rowIndex + 1,
        });
        continue;
      }

      seen.add(key);
      section.rows.push({
        data,
        source,
      });
    }
  }

  const normalized = normalizeSections(sections, findings);
  return {
    source: {
      fileNames,
    },
    sections: Object.fromEntries(
      [...sections.entries()].map(([name, section]) => [name, section.rows.map((row) => row.data)]),
    ),
    normalized,
    findings: [...findings, ...validate(normalized, sections, duplicates)],
    duplicates,
  };
}

export function buildReviewModel(parsed, options = {}) {
  const model = parsed?.normalized ? parsed : parseIbkrStatements(parsed);
  const { normalized, duplicates } = model;
  const assessmentYear = options.assessmentYear ?? "2026-27";
  const financialYear = financialYearForAssessmentYear(assessmentYear);
  const buyTrades = normalized.trades.filter((trade) => trade.quantity > 0);
  const saleTrades = normalized.trades.filter((trade) => trade.quantity < 0);
  const fifo = buildFifoCapitalGains({ trades: normalized.trades });
  const capitalGainRows = fifo.rows.filter((row) =>
    isWithinPeriod(row.saleDate, financialYear.start, financialYear.end),
  );
  const dividends = normalized.dividends.filter((row) =>
    isWithinPeriod(row.date, financialYear.start, financialYear.end),
  );
  const withholdingTaxes = normalized.withholdingTaxes.filter((row) =>
    isWithinPeriod(row.date, financialYear.start, financialYear.end),
  );
  const interest = normalized.interest.filter((row) =>
    isWithinPeriod(row.date, financialYear.start, financialYear.end),
  );
  const scheduleFa = deriveScheduleFa({
    trades: normalized.trades,
    dividends: normalized.dividends,
    openPositions: normalized.openPositions,
    statements: normalized.statements,
    assessmentYear,
  });
  const sectionRows = Object.values(model.sections ?? {}).reduce(
    (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
  const normalizedRows =
    normalized.trades.length +
    normalized.dividends.length +
    normalized.withholdingTaxes.length +
    normalized.interest.length +
    normalized.openPositions.length +
    normalized.transfers.length +
    normalized.cashMovements.length;
  const dataRowsAccepted = sectionRows || normalizedRows;
  const sectionCount = Object.values(model.sections ?? {}).filter(
    (rows) => Array.isArray(rows) && rows.length > 0,
  ).length;
  const instruments = new Set(
    [...normalized.trades, ...normalized.openPositions]
      .map((row) => String(row.symbol ?? "").trim())
      .filter(Boolean),
  );
  const fsi = [...dividends, ...interest].map((item) => ({
    incomeType: item.type === "dividend" ? "dividend" : "interest",
    symbol: item.symbol,
    date: item.date,
    currency: item.currency,
    description: item.description,
    amount: item.amount,
    needsFx: item.currency !== "INR",
  }));
  const tr = withholdingTaxes.map((item) => ({
    symbol: item.symbol,
    date: item.date,
    currency: item.currency,
    description: item.description,
    taxPaid: Math.abs(item.amount),
    needsFx: item.currency !== "INR",
  }));
  const fa = scheduleFa.entities;
  const holdings = scheduleFa.holdings.map((holding) => ({
    ...holding,
    source: sanitizeSource(holding.source),
  }));
  const validations = [
    ...model.findings,
    ...fifo.findings,
    ...scheduleFa.findings,
  ].map(({ severity, code, message, details }) => ({
    severity,
    code,
    message,
    details: sanitizeFindingDetails(details),
  }));

  return {
    generatedAt: new Date().toISOString(),
    source: {
      fileNames: (model.source?.fileNames ?? []).map(
        (_, index) => `statement-${index + 1}.csv`,
      ),
    },
    assessmentYear,
    financialYear,
    summary: {
      files: model.source?.fileNames?.length ?? 0,
      dataRowsReceived: dataRowsAccepted + duplicates.length,
      dataRowsAccepted,
      sections: sectionCount,
      trades: normalized.trades.length,
      buyTrades: buyTrades.length,
      saleTrades: saleTrades.length,
      instruments: instruments.size,
      positions: holdings.length,
      rawPositions: normalized.rawOpenPositions.length,
      dividends: dividends.length,
      rawDividends: normalized.rawDividends.length,
      withholding: withholdingTaxes.length,
      rawWithholding: normalized.rawWithholdingTaxes.length,
      interest: interest.length,
      transfers: normalized.transfers.length,
      cashMovements: normalized.cashMovements.length,
      capitalGainRows: capitalGainRows.length,
      faEntities: scheduleFa.audit.entityCount,
      duplicateRowsSuppressed: duplicates.length,
    },
    schedules: {
      capitalGains: capitalGainRows.map((row) => ({
        ...row,
        source: {
          buy: sanitizeSource(row.source?.buy),
          sale: sanitizeSource(row.source?.sale),
        },
        needsFx: row.currency !== "INR",
      })),
      fsi,
      tr,
      fa,
      holdings,
    },
    validations,
    assumptions: {
      fxRates: normalized.exchangeRates,
      status: normalized.exchangeRates.length > 0 ? "provided" : "missing",
      capitalGainConversion:
        "Net FIFO gain or loss in foreign currency is converted at the Rule 115 prescribed date for the transfer; purchase and sale legs are not converted at separate months.",
      inrRounding: "Each converted schedule row is rounded to the nearest whole rupee.",
      holdingsSnapshot:
        "The latest imported statement period-end snapshot supplies the headline holdings count and value.",
      scheduleFa:
        "Calendar-year entities are grouped by security; peak and closing values retain snapshot evidence status and are not synthetically filled.",
    },
    privacy: {
      storesFiles: false,
      note: "Designed for browser-side parsing. Do not commit real statements or generated tax workbooks.",
    },
    totals: {
      buys: sumMoney(buyTrades, "proceeds"),
      sells: sumMoney(saleTrades, "proceeds"),
      realizedProfitLoss: sumMoney(normalized.trades, "realizedProfitLoss"),
      dividends: sumMoney(dividends, "amount"),
      withholdingTax: sumMoney(withholdingTaxes, "amount"),
      interest: sumMoney(interest, "amount"),
      openPositionValue: sumMoney(holdings, "value"),
      transfers: sumMoney(normalized.transfers, "amount"),
      cashMovements: sumMoney(normalized.cashMovements, "amount"),
    },
    currencies: normalized.currencies,
    stats: {
      dataRowsReceived: dataRowsAccepted + duplicates.length,
      dataRowsAccepted,
      sections: sectionCount,
      trades: normalized.trades.length,
      buyTrades: buyTrades.length,
      saleTrades: saleTrades.length,
      instruments: instruments.size,
      dividends: dividends.length,
      rawDividends: normalized.rawDividends.length,
      excludedDividends: normalized.excludedDividends.length,
      withholdingTaxes: withholdingTaxes.length,
      rawWithholdingTaxes: normalized.rawWithholdingTaxes.length,
      excludedWithholdingTaxes: normalized.excludedWithholdingTaxes.length,
      interest: interest.length,
      openPositions: holdings.length,
      rawOpenPositions: normalized.rawOpenPositions.length,
      transfers: normalized.transfers.length,
      cashMovements: normalized.cashMovements.length,
      duplicateRowsSuppressed: duplicates.length,
      fifo: fifo.audit,
      scheduleFa: scheduleFa.audit,
    },
    checklist: [
      "Upload annual IBKR Activity Statement CSV for the Indian financial year.",
      "Determine each prescribed Rule 115 date and retain primary SBI TT buying-rate evidence; community reference data is not final support.",
      "Review transfers separately; deposits and withdrawals are reconciliation items, not income by default.",
      "Manually review corporate actions, options, futures, bonds, forex, and crypto before filing.",
      "Use the generated output as schedule preparation support, not as tax advice.",
    ],
  };
}

export function makeDemoReview(options = {}) {
  return buildReviewModel(
    parseIbkrStatements(DEMO_ACTIVITY_CSV, { fileNames: ["demo-activity.csv"] }),
    options,
  );
}

function ensureSection(sections, name) {
  if (!sections.has(name)) {
    sections.set(name, {
      name,
      headers: [],
      rows: [],
    });
  }
  return sections.get(name);
}

function mapDataRow(headers, values) {
  const data = {};
  values.forEach((value, index) => {
    const key = headers[index] || `Column ${index + 1}`;
    data[key] = value.trim();
  });
  return data;
}

function normalizeComparableRow(row) {
  return Object.fromEntries(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value.trim()]),
  );
}

function normalizeSections(sections, findings) {
  const trades = sectionRows(sections, "Trades")
    .map((row) => normalizeTrade(row, findings))
    .filter(Boolean);
  const statements = normalizeStatements(sectionRows(sections, "Statement"));
  const rawDividends = sectionRows(sections, "Dividends").map((row) =>
    normalizeCash(row, "dividend", findings),
  );
  const { included: dividends, excluded: excludedDividends } = partitionCashRows(rawDividends, {
    code: "DIVIDEND_SUMMARY_ROWS_EXCLUDED",
    findings,
    message:
      "Dividend rows without a valid payment date or amount were excluded from taxable-income rows.",
  });
  const rawWithholdingTaxes = sectionRows(sections, "Withholding Tax").map((row) =>
    normalizeCash(row, "withholding_tax", findings),
  );
  const { included: datedWithholdingTaxes, excluded: invalidWithholdingTaxes } = partitionCashRows(rawWithholdingTaxes, {
    code: "WHT_SUMMARY_ROWS_EXCLUDED",
    findings,
    message:
      "Withholding-tax rows without a valid tax date or amount were excluded from foreign-tax rows.",
  });
  const withholdingReversals = datedWithholdingTaxes.filter((row) => row.amount >= 0);
  const withholdingTaxes = datedWithholdingTaxes.filter((row) => row.amount < 0);
  if (withholdingReversals.length > 0) {
    findings.push(
      finding("info", "WHT_REVERSALS_EXCLUDED", "Positive withholding-tax reversals were excluded from tax-paid totals.", {
        count: withholdingReversals.length,
      }),
    );
  }
  const excludedWithholdingTaxes = [...invalidWithholdingTaxes, ...withholdingReversals];
  const interest = sectionRows(sections, "Interest")
    .map((row) => normalizeCash(row, "interest", findings))
    .filter((row) => row.date && Number.isFinite(row.amount));
  const rawOpenPositions = sectionRows(sections, "Open Positions").map((row) =>
    normalizeOpenPosition(row, findings),
  );
  const statementByFile = new Map(statements.map((statement) => [statement.fileIndex, statement]));
  const openPositions = rawOpenPositions
    .filter((position) => !position.invalidNumeric)
    .map((position) => ({
      ...position,
      snapshotDate:
        position.snapshotDate ||
        statementByFile.get(position.source?.fileIndex)?.periodEnd ||
        "",
    }));
  const cashMovements = [
    ...sectionRows(sections, "Deposits & Withdrawals"),
    ...sectionRows(sections, "Deposits and Withdrawals"),
  ]
    .map((row) => normalizeTransfer(row, "cash_movement", findings))
    .filter(Boolean);
  const transfers = sectionRows(sections, "Transfers")
    .map((row) => normalizeTransfer(row, "transfer", findings))
    .filter(Boolean);
  const exchangeRates = [
    ...sectionRows(sections, "Exchange Rates"),
    ...sectionRows(sections, "Forex Rates"),
  ]
    .map((row) => normalizeExchangeRate(row, findings))
    .filter(Boolean);

  for (const name of sections.keys()) {
    if (/dividend|withholding|interest/i.test(name) && !SUPPORTED_CASH_SECTIONS.has(name)) {
      findings.push(finding("info", "UNMAPPED_CASH_SECTION", `Cash-like section "${name}" was retained raw only.`));
    }
  }

  const currencies = [
    ...new Set(
      [...trades, ...dividends, ...withholdingTaxes, ...interest, ...openPositions, ...transfers]
        .concat(cashMovements)
        .map((item) => item.currency)
        .filter(Boolean),
    ),
  ].sort();

  return {
    statements,
    trades,
    rawDividends,
    dividends,
    excludedDividends,
    rawWithholdingTaxes,
    withholdingTaxes,
    excludedWithholdingTaxes,
    interest,
    rawOpenPositions,
    openPositions,
    transfers,
    cashMovements,
    exchangeRates,
    currencies,
  };
}

function sectionRows(sections, name) {
  return sections.get(name)?.rows ?? [];
}

function normalizeTrade(entry, findings) {
  const row = entry.data;
  const assetCategory = pick(row, ["Asset Category", "AssetClass", "Asset Class"]).toUpperCase();
  const quantity = numericField(pick(row, ["Quantity", "Qty"]), {
    field: "quantity",
    section: "Trades",
    source: entry.source,
    findings,
  });
  const price = numericField(pick(row, ["T. Price", "Trade Price", "Price"]), {
    field: "price",
    section: "Trades",
    source: entry.source,
    findings,
  });
  const proceeds = numericField(pick(row, ["Proceeds"]), {
    field: "proceeds",
    section: "Trades",
    source: entry.source,
    findings,
  });
  const commission = numericField(
    pick(row, ["Comm/Fee", "Commission", "Commission/Fee"]),
    {
      allowBlank: true,
      blankValue: 0,
      field: "commission",
      section: "Trades",
      source: entry.source,
      findings,
    },
  );
  const basis = numericField(pick(row, ["Basis", "Cost Basis"]), {
    allowBlank: true,
    blankValue: 0,
    field: "basis",
    section: "Trades",
    source: entry.source,
    findings,
  });
  const realizedProfitLoss = numericField(
    pick(row, ["Realized P/L", "Realized P&L", "Realized PNL"]),
    {
      allowBlank: true,
      blankValue: 0,
      field: "realized profit/loss",
      section: "Trades",
      source: entry.source,
      findings,
    },
  );
  const numericFields = [
    quantity,
    price,
    proceeds,
    commission,
    basis,
    realizedProfitLoss,
  ];
  if (numericFields.some((field) => !field.valid)) {
    return null;
  }

  return {
    type: "trade",
    assetCategory,
    unsupported: !STOCK_CATEGORIES.has(assetCategory),
    symbol: pick(row, ["Symbol", "Description"]),
    date: isoDate(pick(row, ["Date/Time", "Date", "Trade Date"])),
    currency: pick(row, ["Currency", "Currency Primary"]).toUpperCase(),
    quantity: quantity.value,
    price: price.value,
    proceeds: proceeds.value,
    commission: commission.value,
    basis: basis.value,
    realizedProfitLoss: realizedProfitLoss.value,
    source: entry.source,
    raw: row,
  };
}

function normalizeCash(entry, type, findings) {
  const row = entry.data;
  const description = pick(row, ["Description"]);
  const amount = numericField(pick(row, ["Amount"]), {
    field: "amount",
    section: entry.source?.section || type,
    source: entry.source,
    findings,
  });
  return {
    type,
    date: isoDate(pick(row, ["Date", "Settle Date"])),
    currency: pick(row, ["Currency"]).toUpperCase(),
    symbol: symbolFromDescription(description),
    description,
    amount: amount.value,
    invalidNumeric: !amount.valid,
    source: entry.source,
    raw: row,
  };
}

function normalizeOpenPosition(entry, findings) {
  const row = entry.data;
  const assetCategory = pick(row, ["Asset Category", "AssetClass", "Asset Class"]).toUpperCase();
  const quantity = numericField(pick(row, ["Quantity", "Qty"]), {
    field: "quantity",
    section: "Open Positions",
    source: entry.source,
    findings,
  });
  const costBasis = numericField(pick(row, ["Cost Basis", "Basis"]), {
    allowBlank: true,
    blankValue: 0,
    field: "cost basis",
    section: "Open Positions",
    source: entry.source,
    findings,
  });
  const closePrice = numericField(pick(row, ["Close Price", "Price"]), {
    allowBlank: true,
    blankValue: 0,
    field: "close price",
    section: "Open Positions",
    source: entry.source,
    findings,
  });
  const value = numericField(pick(row, ["Value"]), {
    field: "value",
    section: "Open Positions",
    source: entry.source,
    findings,
  });
  const unrealizedProfitLoss = numericField(
    pick(row, ["Unrealized P/L", "Unrealized P&L"]),
    {
      allowBlank: true,
      blankValue: 0,
      field: "unrealized profit/loss",
      section: "Open Positions",
      source: entry.source,
      findings,
    },
  );
  const invalidNumeric = [
    quantity,
    costBasis,
    closePrice,
    value,
    unrealizedProfitLoss,
  ].some((field) => !field.valid);

  return {
    type: "open_position",
    assetCategory,
    unsupported: !STOCK_CATEGORIES.has(assetCategory),
    symbol: pick(row, ["Symbol", "Description"]),
    currency: pick(row, ["Currency"]).toUpperCase(),
    quantity: quantity.value,
    costBasis: costBasis.value,
    closePrice: closePrice.value,
    value: value.value,
    unrealizedProfitLoss: unrealizedProfitLoss.value,
    invalidNumeric,
    source: entry.source,
    raw: row,
  };
}

function normalizeTransfer(entry, type = "transfer", findings) {
  const row = entry.data;
  const amount = numericField(pick(row, ["Amount"]), {
    field: "amount",
    section: entry.source?.section || type,
    source: entry.source,
    findings,
  });
  if (!amount.valid) {
    return null;
  }
  return {
    type,
    date: isoDate(pick(row, ["Date", "Settle Date"])),
    currency: pick(row, ["Currency"]).toUpperCase(),
    description: pick(row, ["Description"]),
    amount: amount.value,
    source: entry.source,
    raw: row,
  };
}

function normalizeExchangeRate(entry, findings) {
  const row = entry.data;
  const rateToInr = numericField(
    pick(row, ["Rate To INR", "INR Rate", "Exchange Rate"]),
    {
      field: "rate to INR",
      section: entry.source?.section || "Exchange Rates",
      source: entry.source,
      findings,
    },
  );
  if (!rateToInr.valid) {
    return null;
  }
  return {
    date: isoDate(pick(row, ["Date"])),
    currency: pick(row, ["Currency", "From Currency"]).toUpperCase(),
    rateToInr: rateToInr.value,
  };
}

function normalizeStatements(entries) {
  const byFile = new Map();
  for (const entry of entries) {
    const row = entry.data;
    const fileIndex = entry.source.fileIndex;
    const statement = byFile.get(fileIndex) ?? {
      fileIndex,
      fileName: entry.source.fileName,
      account: "",
      baseCurrency: "",
      period: "",
      periodStart: "",
      periodEnd: "",
    };
    const fieldName = pick(row, ["Field Name"]).toLowerCase();
    const fieldValue = pick(row, ["Field Value"]);

    if (fieldName === "account") {
      statement.account = fieldValue;
    } else if (fieldName === "base currency") {
      statement.baseCurrency = fieldValue.toUpperCase();
    } else if (fieldName === "period") {
      const period = parsePeriod(fieldValue);
      statement.period = fieldValue;
      statement.periodStart = period.start;
      statement.periodEnd = period.end;
    }

    byFile.set(fileIndex, statement);
  }

  return [...byFile.values()].sort((left, right) => left.fileIndex - right.fileIndex);
}

function partitionCashRows(rows, { code, message, findings }) {
  const included = [];
  const excluded = [];
  for (const row of rows) {
    if (row.date && Number.isFinite(row.amount)) {
      included.push(row);
    } else {
      excluded.push(row);
    }
  }

  if (excluded.length > 0) {
    findings.push(finding("info", code, message, { count: excluded.length }));
  }

  return { included, excluded };
}

function parsePeriod(value) {
  const dates = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return {
    start: dates[0] ?? "",
    end: dates[1] ?? dates[0] ?? "",
  };
}

function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function validate(normalized, sections, duplicates) {
  const findings = [];
  const nonInrCurrencies = normalized.currencies.filter((currency) => currency && currency !== "INR");

  if (nonInrCurrencies.length > 0 && normalized.exchangeRates.length === 0) {
    findings.push(
      finding(
        "warning",
        "MISSING_FX",
        "Non-INR activity needs verified INR conversion rates before ITR schedules can be prepared.",
        { currencies: nonInrCurrencies },
      ),
    );
  }

  const unsupportedTrades = normalized.trades.filter((trade) => trade.unsupported);
  const unsupportedPositions = normalized.openPositions.filter((position) => position.unsupported);
  const unsupportedCategories = [
    ...new Set([...unsupportedTrades, ...unsupportedPositions].map((item) => item.assetCategory).filter(Boolean)),
  ];

  for (const category of unsupportedCategories) {
    const label = OPTION_CATEGORIES.has(category) ? "Options" : category;
    findings.push(
      finding("warning", "UNSUPPORTED_ASSET_CLASS", `${label} activity requires manual review before filing.`, {
        assetCategory: category,
      }),
    );
  }

  if (normalized.transfers.length > 0) {
    findings.push(
      finding("info", "TRANSFERS_PRESENT", "Transfers are listed for reconciliation and are not classified as income."),
    );
  }

  const corporateActionSections = [...sections.keys()].filter((name) => /corporate action/i.test(name));
  if (corporateActionSections.length > 0) {
    findings.push(
      finding(
        "warning",
        "CORPORATE_ACTIONS_PRESENT",
        "Corporate actions can change cost basis and holding periods; review them manually.",
        { sections: corporateActionSections },
      ),
    );
  }

  if (duplicates.length > 0) {
    findings.push(
      finding("info", "DUPLICATE_ROWS_SUPPRESSED", "Identical statement rows were parsed only once.", {
        count: duplicates.length,
      }),
    );
  }

  return findings;
}

function pick(row, names) {
  for (const name of names) {
    if (Object.hasOwn(row, name) && row[name] !== "") {
      return row[name];
    }
  }
  return "";
}

function numericField(
  value,
  {
    allowBlank = false,
    blankValue = null,
    field,
    section,
    source,
    findings,
  },
) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (allowBlank) {
      return { valid: true, value: blankValue };
    }
    findings.push(
      finding(
        "warning",
        "MISSING_NUMERIC_VALUE",
        `A ${section} row was excluded because ${field} is missing.`,
        {
          field,
          section,
          source: sanitizeSource(source),
        },
      ),
    );
    return { valid: false, value: null };
  }

  const parenthesized = raw.match(/^\((.*)\)$/);
  const cleaned = (parenthesized ? `-${parenthesized[1]}` : raw).replace(
    /[₹$,\s]/g,
    "",
  );
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) {
    findings.push(
      finding(
        "warning",
        "INVALID_NUMERIC_VALUE",
        `A ${section} row was excluded because ${field} is not a valid number.`,
        {
          field,
          section,
          source: sanitizeSource(source),
        },
      ),
    );
    return { valid: false, value: null };
  }

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    findings.push(
      finding(
        "warning",
        "INVALID_NUMERIC_VALUE",
        `A ${section} row was excluded because ${field} is outside the supported numeric range.`,
        {
          field,
          section,
          source: sanitizeSource(source),
        },
      ),
    );
    return { valid: false, value: null };
  }
  return { valid: true, value: numeric };
}

function isoDate(value) {
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function symbolFromDescription(value) {
  const match = String(value ?? "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z][A-Z0-9.-]{0,9})(?=\s|\()/);
  return match?.[1] ?? "";
}

function financialYearForAssessmentYear(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return { start: "", end: "" };
  }
  const assessmentStartYear = Number(match[1]);
  return {
    start: `${assessmentStartYear - 1}-04-01`,
    end: `${assessmentStartYear}-03-31`,
  };
}

function isWithinPeriod(date, start, end) {
  if (!start || !end) return true;
  return Boolean(date && date >= start && date <= end);
}

function sanitizeSource(source) {
  if (!source) return undefined;
  return {
    fileIndex: source.fileIndex,
    rowNumber: source.rowNumber,
    section: source.section,
  };
}

function sanitizeFindingDetails(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeFindingDetails);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["fileName", "fileNames", "account", "raw"].includes(key))
      .map(([key, child]) => [
        key,
        key === "source" ? sanitizeSource(child) : sanitizeFindingDetails(child),
      ]),
  );
}

function sumMoney(rows, field) {
  return roundCurrency(rows.reduce((total, row) => total + (Number(row[field]) || 0), 0));
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finding(severity, code, message, details = {}) {
  return {
    severity,
    code,
    message,
    details,
  };
}
