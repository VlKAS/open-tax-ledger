const STOCK_CATEGORIES = new Set(["STK", "STOCK", "COMMON STOCK"]);
const OPTION_CATEGORIES = new Set(["OPT", "OPTION", "OPTIONS"]);
const SUPPORTED_CASH_SECTIONS = new Set([
  "Dividends",
  "Withholding Tax",
  "Interest",
]);

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

export function parseCsv(input) {
  if (typeof input !== "string") {
    throw new TypeError("parseCsv expects a string");
  }

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char === "\r") {
      if (next === "\n") {
        continue;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (quoted) {
    throw new Error("Unclosed quoted CSV field");
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
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
      const key = JSON.stringify([section.name, normalizeComparableRow(data)]);
      if (seen.has(key)) {
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
        source: {
          fileIndex,
          rowNumber: rowIndex + 1,
        },
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

export function buildReviewModel(parsed) {
  const model = parsed?.normalized ? parsed : parseIbkrStatements(parsed);
  const { normalized, duplicates } = model;
  const saleTrades = normalized.trades.filter((trade) => trade.quantity < 0);
  const buyTrades = normalized.trades.filter((trade) => trade.quantity > 0);
  const fsi = [...normalized.dividends, ...normalized.interest].map((item) => ({
    incomeType: item.type === "dividend" ? "dividend" : "interest",
    date: item.date,
    currency: item.currency,
    description: item.description,
    amount: item.amount,
    needsFx: item.currency !== "INR",
  }));
  const tr = normalized.withholdingTaxes.map((item) => ({
    date: item.date,
    currency: item.currency,
    description: item.description,
    taxPaid: Math.abs(item.amount),
    needsFx: item.currency !== "INR",
  }));
  const fa = normalized.openPositions.map((position) => ({
    assetCategory: position.assetCategory,
    symbol: position.symbol,
    currency: position.currency,
    quantity: position.quantity,
    value: position.value,
    needsFx: position.currency !== "INR",
  }));

  return {
    generatedAt: new Date().toISOString(),
    source: {
      fileNames: model.source?.fileNames ?? [],
    },
    summary: {
      files: model.source?.fileNames?.length ?? 0,
      trades: normalized.trades.length,
      positions: normalized.openPositions.length,
      dividends: normalized.dividends.length,
      withholding: normalized.withholdingTaxes.length,
      interest: normalized.interest.length,
      transfers: normalized.transfers.length,
      duplicateRowsSuppressed: duplicates.length,
    },
    schedules: {
      capitalGains: saleTrades.map((trade) => ({
        symbol: trade.symbol,
        date: trade.date,
        currency: trade.currency,
        quantitySold: Math.abs(trade.quantity),
        proceeds: trade.proceeds,
        costBasis: Math.abs(trade.basis),
        realizedProfitLoss: trade.realizedProfitLoss,
        needsFx: trade.currency !== "INR",
      })),
      fsi,
      tr,
      fa,
    },
    validations: model.findings.map(({ severity, code, message, details }) => ({
      severity,
      code,
      message,
      details,
    })),
    assumptions: {
      fxRates: normalized.exchangeRates,
      status: normalized.exchangeRates.length > 0 ? "provided" : "missing",
    },
    privacy: {
      storesFiles: false,
      note: "Designed for browser-side parsing. Do not commit real statements or generated tax workbooks.",
    },
    totals: {
      buys: sumMoney(buyTrades, "proceeds"),
      sells: sumMoney(saleTrades, "proceeds"),
      realizedProfitLoss: sumMoney(normalized.trades, "realizedProfitLoss"),
      dividends: sumMoney(normalized.dividends, "amount"),
      withholdingTax: sumMoney(normalized.withholdingTaxes, "amount"),
      interest: sumMoney(normalized.interest, "amount"),
      openPositionValue: sumMoney(normalized.openPositions, "value"),
      transfers: sumMoney(normalized.transfers, "amount"),
    },
    legacySchedules: {
      scheduleCapitalGains: saleTrades,
      scheduleOtherSources: fsi,
      scheduleForeignAssetsSeed: normalized.openPositions,
      foreignTaxCreditSeed: normalized.withholdingTaxes,
      reconciliationItems: normalized.transfers,
    },
    currencies: normalized.currencies,
    findings: model.findings,
    stats: {
      trades: normalized.trades.length,
      dividends: normalized.dividends.length,
      withholdingTaxes: normalized.withholdingTaxes.length,
      interest: normalized.interest.length,
      openPositions: normalized.openPositions.length,
      transfers: normalized.transfers.length,
      duplicateRowsSuppressed: duplicates.length,
    },
    checklist: [
      "Upload annual IBKR Activity Statement CSV for the Indian financial year.",
      "Add official RBI/telegraphic transfer buy-rate FX evidence for every non-INR cash flow date.",
      "Review transfers separately; deposits and withdrawals are reconciliation items, not income by default.",
      "Manually review corporate actions, options, futures, bonds, forex, and crypto before filing.",
      "Use the generated output as schedule preparation support, not as tax advice.",
    ],
  };
}

export function makeDemoReview() {
  return buildReviewModel(parseIbkrStatements(DEMO_ACTIVITY_CSV, { fileNames: ["demo-activity.csv"] }));
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
    .map(normalizeTrade)
    .filter(Boolean);
  const dividends = sectionRows(sections, "Dividends").map((row) => normalizeCash(row, "dividend"));
  const withholdingTaxes = sectionRows(sections, "Withholding Tax").map((row) =>
    normalizeCash(row, "withholding_tax"),
  );
  const interest = sectionRows(sections, "Interest").map((row) => normalizeCash(row, "interest"));
  const openPositions = sectionRows(sections, "Open Positions").map(normalizeOpenPosition);
  const transfers = [
    ...sectionRows(sections, "Deposits & Withdrawals"),
    ...sectionRows(sections, "Deposits and Withdrawals"),
    ...sectionRows(sections, "Transfers"),
  ].map(normalizeTransfer);
  const exchangeRates = [
    ...sectionRows(sections, "Exchange Rates"),
    ...sectionRows(sections, "Forex Rates"),
  ].map(normalizeExchangeRate);

  for (const name of sections.keys()) {
    if (/dividend|withholding|interest/i.test(name) && !SUPPORTED_CASH_SECTIONS.has(name)) {
      findings.push(finding("info", "UNMAPPED_CASH_SECTION", `Cash-like section "${name}" was retained raw only.`));
    }
  }

  const currencies = [
    ...new Set(
      [...trades, ...dividends, ...withholdingTaxes, ...interest, ...openPositions, ...transfers]
        .map((item) => item.currency)
        .filter(Boolean),
    ),
  ].sort();

  return {
    trades,
    dividends,
    withholdingTaxes,
    interest,
    openPositions,
    transfers,
    exchangeRates,
    currencies,
  };
}

function sectionRows(sections, name) {
  return sections.get(name)?.rows.map((row) => row.data) ?? [];
}

function normalizeTrade(row) {
  const assetCategory = pick(row, ["Asset Category", "AssetClass", "Asset Class"]).toUpperCase();
  return {
    type: "trade",
    assetCategory,
    unsupported: !STOCK_CATEGORIES.has(assetCategory),
    symbol: pick(row, ["Symbol", "Description"]),
    date: isoDate(pick(row, ["Date/Time", "Date", "Trade Date"])),
    currency: pick(row, ["Currency", "Currency Primary"]).toUpperCase(),
    quantity: numberValue(pick(row, ["Quantity", "Qty"])),
    price: numberValue(pick(row, ["T. Price", "Trade Price", "Price"])),
    proceeds: numberValue(pick(row, ["Proceeds"])),
    commission: numberValue(pick(row, ["Comm/Fee", "Commission", "Commission/Fee"])),
    basis: numberValue(pick(row, ["Basis", "Cost Basis"])),
    realizedProfitLoss: numberValue(pick(row, ["Realized P/L", "Realized P&L", "Realized PNL"])),
    raw: row,
  };
}

function normalizeCash(row, type) {
  return {
    type,
    date: isoDate(pick(row, ["Date", "Settle Date"])),
    currency: pick(row, ["Currency"]).toUpperCase(),
    description: pick(row, ["Description"]),
    amount: numberValue(pick(row, ["Amount"])),
    raw: row,
  };
}

function normalizeOpenPosition(row) {
  const assetCategory = pick(row, ["Asset Category", "AssetClass", "Asset Class"]).toUpperCase();
  return {
    type: "open_position",
    assetCategory,
    unsupported: !STOCK_CATEGORIES.has(assetCategory),
    symbol: pick(row, ["Symbol", "Description"]),
    currency: pick(row, ["Currency"]).toUpperCase(),
    quantity: numberValue(pick(row, ["Quantity", "Qty"])),
    costBasis: numberValue(pick(row, ["Cost Basis", "Basis"])),
    closePrice: numberValue(pick(row, ["Close Price", "Price"])),
    value: numberValue(pick(row, ["Value"])),
    unrealizedProfitLoss: numberValue(pick(row, ["Unrealized P/L", "Unrealized P&L"])),
    raw: row,
  };
}

function normalizeTransfer(row) {
  return {
    type: "transfer",
    date: isoDate(pick(row, ["Date", "Settle Date"])),
    currency: pick(row, ["Currency"]).toUpperCase(),
    description: pick(row, ["Description"]),
    amount: numberValue(pick(row, ["Amount"])),
    raw: row,
  };
}

function normalizeExchangeRate(row) {
  return {
    date: isoDate(pick(row, ["Date"])),
    currency: pick(row, ["Currency", "From Currency"]).toUpperCase(),
    rateToInr: numberValue(pick(row, ["Rate To INR", "INR Rate", "Exchange Rate"])),
    raw: row,
  };
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

function numberValue(value) {
  if (value === "") {
    return 0;
  }
  const cleaned = String(value).replace(/[(),]/g, (match) => (match === "(" ? "-" : ""));
  const numeric = Number.parseFloat(cleaned);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isoDate(value) {
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
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
