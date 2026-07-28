const STOCK_CATEGORIES = new Set(["STK", "STOCK", "STOCKS", "COMMON STOCK"]);
const QUANTITY_EPSILON = 1e-9;

export function calendarYearForAssessmentYear(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) - 1;
}

export function deriveScheduleFa({
  trades = [],
  dividends = [],
  openPositions = [],
  statements = [],
  assessmentYear = "2026-27",
} = {}) {
  const calendarYear = calendarYearForAssessmentYear(assessmentYear);
  const periodStart = calendarYear ? `${calendarYear}-01-01` : "";
  const periodEnd = calendarYear ? `${calendarYear}-12-31` : "";
  const statementByFile = new Map(
    statements.map((statement) => [statement.fileIndex, statement]),
  );
  const positions = openPositions
    .filter(isSupportedStock)
    .map((position) => ({
      ...position,
      snapshotDate:
        position.snapshotDate ||
        statementByFile.get(position.source?.fileIndex)?.periodEnd ||
        "",
    }));
  const availableTrades = trades.filter(
    (trade) =>
      isSupportedStock(trade) &&
      (!periodEnd || !trade.date || trade.date <= periodEnd),
  );
  const activityDividends = dividends.filter((dividend) =>
    isWithinPeriod(dividend.date, periodStart, periodEnd),
  );
  const seedDividends = activityDividends.filter(
    hasReliableSecurityIdentity,
  );
  const descriptionOnlyDividendCount =
    activityDividends.length - seedDividends.length;
  const resolveSecurityKey = createSecurityKeyResolver([
    ...availableTrades,
    ...positions,
    ...activityDividends,
  ]);
  const activityTrades = availableTrades.filter((trade) =>
    isWithinPeriod(trade.date, periodStart, periodEnd),
  );
  const activityPositions = positions.filter((position) =>
    isWithinPeriod(position.snapshotDate, periodStart, periodEnd),
  );
  const latestSnapshotDate = positions
    .map((position) => position.snapshotDate)
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
  const hasExactPeriodEndSnapshot = positions.some(
    (position) => position.snapshotDate === periodEnd,
  );
  const latestSnapshotPositions = latestSnapshotDate
    ? collapseSnapshot(
        positions.filter(
          (position) =>
            position.snapshotDate === latestSnapshotDate &&
            Number(position.quantity) !== 0,
        ),
      )
    : [];
  const evidenceActivityKeys = new Set(
    [...activityTrades, ...activityPositions]
      .map((row) => resolveSecurityKey(row))
      .filter(Boolean),
  );
  const dividendKeys = new Set(
    seedDividends
      .map((row) => resolveSecurityKey(row))
      .filter(Boolean),
  );
  const possiblePassiveHoldingKeys = new Set(
    latestSnapshotPositions
      .filter((position) =>
        couldHaveBeenHeldDuringCalendarYear(
          position,
          trades,
          periodEnd,
          resolveSecurityKey,
        ),
      )
      .map((position) => resolveSecurityKey(position))
      .filter(Boolean),
  );
  const symbols = new Set(
    [
      ...evidenceActivityKeys,
      ...dividendKeys,
      ...possiblePassiveHoldingKeys,
    ],
  );
  const dividendOnlyEntityKeys = [...dividendKeys].filter(
    (key) =>
      !evidenceActivityKeys.has(key) &&
      !possiblePassiveHoldingKeys.has(key),
  );
  const reviewOnlyEntityKeys = new Set(
    [...possiblePassiveHoldingKeys, ...dividendKeys].filter(
      (key) => !evidenceActivityKeys.has(key),
    ),
  );
  const entities = [...symbols]
    .map((key) =>
      deriveEntity({
        key,
        trades: availableTrades,
        dividends,
        positions,
        periodStart,
        periodEnd,
        resolveSecurityKey,
        hasExactPeriodEndSnapshot,
      }),
    )
    .filter(Boolean)
    .sort((left, right) =>
      `${left.symbol}\u0000${left.currency}`.localeCompare(
        `${right.symbol}\u0000${right.currency}`,
      ),
    );
  const holdings = latestSnapshotPositions.map(
    ({
      conid: _conid,
      isin: _isin,
      figi: _figi,
      cusip: _cusip,
      securityId: _securityId,
      ...position
    }) => position,
  );
  const findings = [];

  if (!calendarYear) {
    findings.push(
      finding(
        "warning",
        "FA_INVALID_ASSESSMENT_YEAR",
        "Schedule FA calendar-year scope could not be derived from the assessment year.",
      ),
    );
  }
  if (positions.length > 0 && !latestSnapshotDate) {
    findings.push(
      finding(
        "warning",
        "FA_POSITION_DATES_MISSING",
        "Open-position rows were found without statement period-end dates.",
      ),
    );
  }
  if (entities.some((entity) => entity.peakStatus !== "exact-daily-evidence")) {
    findings.push(
      finding(
        "warning",
        "FA_PEAK_VALUE_EVIDENCE_LIMITED",
        "Schedule FA peak values use imported position snapshots only; retain daily or broker peak-value evidence.",
      ),
    );
  }
  if (entities.some((entity) => entity.closingStatus !== "exact-period-end")) {
    findings.push(
      finding(
        "warning",
        "FA_CLOSING_VALUE_EVIDENCE_LIMITED",
        "One or more Schedule FA closing values do not come from an exact calendar-year-end position snapshot.",
      ),
    );
  }
  if (
    entities.some(
      (entity) => entity.initialValueStatus === "review-acquisition-basis",
    )
  ) {
    findings.push(
      finding(
        "info",
        "FA_INITIAL_VALUE_AGGREGATION_REVIEW",
        "Schedule FA initial value uses imported acquisition-basis evidence for lots held or acquired during the calendar year; sales or multiple lots require professional review.",
      ),
    );
  }
  if (descriptionOnlyDividendCount > 0) {
    findings.push(
      finding(
        "info",
        "FA_DESCRIPTION_ONLY_DIVIDENDS",
        "Dividend descriptions without an explicit symbol or stable security identifier were not used to create standalone Schedule FA entities; they can still support an entity established by trade or position evidence.",
        { rows: descriptionOnlyDividendCount },
      ),
    );
  }
  if (dividendOnlyEntityKeys.length > 0) {
    findings.push(
      finding(
        "warning",
        "FA_DIVIDEND_ONLY_EVIDENCE",
        "One or more Schedule FA entities are inferred only from calendar-year dividend evidence and need acquisition, peak, and closing-value review.",
        { entities: dividendOnlyEntityKeys.length },
      ),
    );
  }
  if (reviewOnlyEntityKeys.size > 0) {
    findings.push(
      finding(
        "warning",
        "FA_CALENDAR_YEAR_EVIDENCE_INCOMPLETE",
        "One or more latest holdings may have existed during the Schedule FA calendar year but lack an in-year trade or position snapshot; they are included as review-only entities.",
        { entities: reviewOnlyEntityKeys.size },
      ),
    );
  }

  return {
    calendarYear,
    periodStart,
    periodEnd,
    entities,
    holdings,
    audit: {
      rawPositionRows: openPositions.length,
      supportedPositionRows: positions.length,
      snapshotDates: [...new Set(positions.map((position) => position.snapshotDate).filter(Boolean))].sort(),
      latestSnapshotDate,
      latestHoldingRows: holdings.length,
      entityCount: entities.length,
      reviewOnlyEntityCount: reviewOnlyEntityKeys.size,
      dividendOnlyEntityCount: dividendOnlyEntityKeys.length,
      calendarYearEvidenceComplete: reviewOnlyEntityKeys.size === 0,
    },
    findings,
  };
}

function deriveEntity({
  key,
  trades,
  dividends,
  positions,
  periodStart,
  periodEnd,
  resolveSecurityKey,
  hasExactPeriodEndSnapshot,
}) {
  const securityTrades = trades
    .filter((trade) => resolveSecurityKey(trade) === key)
    .sort(compareDatedRows);
  const securityPositions = positions
    .filter((position) => resolveSecurityKey(position) === key)
    .sort((left, right) =>
      `${left.snapshotDate}\u0000${sourceOrder(left)}`.localeCompare(
        `${right.snapshotDate}\u0000${sourceOrder(right)}`,
      ),
    );
  const securityDividends = dividends
    .filter(
      (dividend) =>
        isWithinPeriod(dividend.date, periodStart, periodEnd) &&
        resolveSecurityKey(dividend) === key,
    )
    .sort(compareDatedRows);
  const first =
    securityTrades[0] ??
    securityPositions[0] ??
    securityDividends[0];
  if (!first) return null;

  const acquisitionLots = scheduleFaAcquisitionLots(
    securityTrades,
    periodStart,
    periodEnd,
  );
  const sales = securityTrades.filter(
    (trade) =>
      Number(trade.quantity) < 0 &&
      isWithinPeriod(trade.date, periodStart, periodEnd),
  );
  const hasAnySale = securityTrades.some(
    (trade) =>
      Number(trade.quantity) < 0 &&
      (!periodEnd || !trade.date || trade.date <= periodEnd),
  );
  const acquisitionDate =
    acquisitionLots.map((lot) => lot.date).filter(Boolean).sort()[0] ?? "";
  const initialValue = acquisitionLots.length > 0
    ? roundMoney(
        acquisitionLots.reduce((total, lot) => total + lot.value, 0),
      )
    : positiveBasis(securityPositions[0]);
  const inPeriodPositions = securityPositions.filter(
    (position) =>
      position.snapshotDate &&
      (!periodStart || position.snapshotDate >= periodStart) &&
      (!periodEnd || position.snapshotDate <= periodEnd),
  );
  const peakPosition = [...inPeriodPositions].sort(
    (left, right) => Number(right.value) - Number(left.value),
  )[0];
  const exactClosing = inPeriodPositions.findLast(
    (position) => position.snapshotDate === periodEnd,
  );
  const nearestClosing = inPeriodPositions.at(-1);
  const fullyDisposed =
    !exactClosing &&
    wasFullyDisposedByPeriodEnd(
      securityTrades,
      nearestClosing,
      periodEnd,
      hasExactPeriodEndSnapshot,
    );
  const closingPosition = exactClosing ?? (fullyDisposed ? null : nearestClosing);
  const companyTokens = new Set(
    [...securityTrades, ...securityPositions, ...securityDividends]
      .map((row) => String(row.symbol ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  const incomeRows = dividends.filter(
    (row) =>
      isWithinPeriod(row.date, periodStart, periodEnd) &&
      dividendMatchesEntity(
        row,
        key,
        resolveSecurityKey,
        companyTokens,
        first.currency,
      ),
  );
  const currentSymbol =
    exactClosing?.symbol ??
    nearestClosing?.symbol ??
    securityPositions.at(-1)?.symbol ??
    first.symbol;

  return {
    assetCategory: first.assetCategory,
    symbol: currentSymbol,
    currency: first.currency,
    acquisitionDate,
    acquisitionStatus: acquisitionDate
      ? "derived-from-imported-buy"
      : "prior-period-or-transfer-review",
    initialValue,
    initialValueStatus:
      initialValue <= 0
        ? "missing-evidence"
        : hasAnySale || acquisitionLots.length > 1
          ? "review-acquisition-basis"
          : "source-basis",
    peakDate: peakPosition?.snapshotDate ?? "",
    peakValue: finiteOrNull(peakPosition?.value),
    peakStatus: peakPosition ? "snapshot-limited" : "missing-evidence",
    closingDate:
      closingPosition?.snapshotDate ??
      (fullyDisposed ? periodEnd : ""),
    closingValue: fullyDisposed
      ? 0
      : finiteOrNull(closingPosition?.value),
    closingQuantity: fullyDisposed
      ? 0
      : finiteOrNull(closingPosition?.quantity),
    closingStatus: exactClosing
      ? "exact-period-end"
      : fullyDisposed
        ? "derived-full-disposal"
      : nearestClosing
        ? "nearest-prior-snapshot"
        : "missing-evidence",
    grossDividends: roundMoney(
      incomeRows.reduce((total, row) => total + (Number(row.amount) || 0), 0),
    ),
    grossProceeds: roundMoney(
      sales.reduce((total, row) => total + (Number(row.proceeds) || 0), 0),
    ),
    evidence: {
      tradeRows: securityTrades.length,
      buyRows: acquisitionLots.length,
      positionRows: securityPositions.length,
      dividendRows: incomeRows.length,
    },
    needsFx: first.currency !== "INR",
  };
}

function collapseSnapshot(rows, resolveSecurityKey = createSecurityKeyResolver(rows)) {
  const bySecurity = new Map();
  for (const row of rows) {
    const key = resolveSecurityKey(row);
    if (!key) continue;
    const previous = bySecurity.get(key);
    if (!previous || sourceOrder(previous) <= sourceOrder(row)) {
      bySecurity.set(key, row);
    }
  }
  return [...bySecurity.values()].map((position) => ({
    assetCategory: position.assetCategory,
    symbol: position.symbol,
    currency: position.currency,
    conid: position.conid,
    isin: position.isin,
    figi: position.figi,
    cusip: position.cusip,
    securityId: position.securityId,
    quantity: position.quantity,
    value: position.value,
    snapshotDate: position.snapshotDate,
    source: position.source,
    needsFx: position.currency !== "INR",
  }));
}

function couldHaveBeenHeldDuringCalendarYear(
  position,
  trades,
  periodEnd,
  resolveSecurityKey,
) {
  const key = resolveSecurityKey(position);
  if (!key || !periodEnd) return true;
  const securityTrades = trades.filter(
    (trade) =>
      isSupportedStock(trade) &&
      resolveSecurityKey(trade) === key,
  );
  if (securityTrades.some((trade) => trade.date && trade.date <= periodEnd)) {
    return true;
  }
  return !securityTrades.some(
    (trade) =>
      Number(trade.quantity) > 0 &&
      trade.date &&
      trade.date > periodEnd,
  );
}

function rowMatchesSymbol(row, symbol, currency) {
  if (!symbol) return false;
  const rowCurrency = String(row?.currency ?? "").trim().toUpperCase();
  const expectedCurrency = String(currency ?? "").trim().toUpperCase();
  if (rowCurrency && expectedCurrency && rowCurrency !== expectedCurrency) {
    return false;
  }
  const normalized = String(row?.symbol ?? "").trim().toUpperCase();
  if (normalized === symbol) return true;
  return descriptionStartsWithSymbol(row?.description, symbol);
}

function dividendMatchesEntity(
  row,
  key,
  resolveSecurityKey,
  companyTokens,
  currency,
) {
  if (stableSecurityKey(row)) {
    return resolveSecurityKey(row) === key;
  }
  if (resolveSecurityKey(row) === key) return true;
  return [...companyTokens].some((symbol) =>
    rowMatchesSymbol(row, symbol, currency),
  );
}

function descriptionStartsWithSymbol(description, symbol) {
  return String(description ?? "").trim().toUpperCase().startsWith(`${symbol} `);
}

function isWithinPeriod(date, start, end) {
  if (!start || !end) return true;
  return Boolean(date && date >= start && date <= end);
}

function positiveBasis(row) {
  const basis = Number(row?.basis ?? row?.costBasis);
  if (Number.isFinite(basis) && basis !== 0) return Math.abs(basis);
  const proceeds = Number(row?.proceeds);
  const commission = Number(row?.commission);
  if (!Number.isFinite(proceeds)) return 0;
  return Math.abs(proceeds) + Math.abs(Number.isFinite(commission) ? commission : 0);
}

function isSupportedStock(row) {
  if (row?.unsupported) return false;
  const category = String(row?.assetCategory ?? "").trim().toUpperCase();
  return !category || STOCK_CATEGORIES.has(category);
}

function createSecurityKeyResolver(rows) {
  const stableBySymbol = new Map();
  const ambiguousSymbols = new Set();

  for (const row of rows) {
    const stableKey = stableSecurityKey(row);
    const symbolKey = symbolSecurityKey(row);
    if (!stableKey || !symbolKey) continue;
    const existing = stableBySymbol.get(symbolKey);
    if (existing && existing !== stableKey) {
      ambiguousSymbols.add(symbolKey);
      stableBySymbol.delete(symbolKey);
    } else if (!ambiguousSymbols.has(symbolKey)) {
      stableBySymbol.set(symbolKey, stableKey);
    }
  }

  return (row) => {
    const stableKey = stableSecurityKey(row);
    if (stableKey) return stableKey;
    const symbolKey = symbolSecurityKey(row);
    return stableBySymbol.get(symbolKey) ?? symbolKey;
  };
}

function stableSecurityKey(row) {
  const identifiers = [
    ["conid", row?.conid],
    ["isin", row?.isin],
    ["figi", row?.figi],
    ["cusip", row?.cusip],
    ["security-id", row?.securityId],
  ];
  for (const [name, value] of identifiers) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized) return `${name}:${normalized}`;
  }
  return "";
}

function hasReliableSecurityIdentity(row) {
  if (stableSecurityKey(row)) return true;
  return Boolean(
    row?.symbol &&
    row?.symbolEvidence !== "description",
  );
}

function symbolSecurityKey(row) {
  const symbol = String(row?.symbol ?? "").trim().toUpperCase();
  const currency = String(row?.currency ?? "").trim().toUpperCase();
  return symbol ? `symbol:${symbol}\u0000${currency}` : "";
}

function compareDatedRows(left, right) {
  return `${left.timestamp || left.date}\u0000${sourceOrder(left)}`.localeCompare(
    `${right.timestamp || right.date}\u0000${sourceOrder(right)}`,
  );
}

function wasFullyDisposedByPeriodEnd(
  trades,
  nearestPosition,
  periodEnd,
  hasExactPeriodEndSnapshot,
) {
  if (!periodEnd) return false;
  if (!hasExactPeriodEndSnapshot) return false;
  const datedTrades = trades
    .filter((trade) => trade.date && trade.date <= periodEnd)
    .sort(compareDatedRows);

  if (nearestPosition?.snapshotDate) {
    const subsequentTrades = datedTrades.filter(
      (trade) => trade.date > nearestPosition.snapshotDate,
    );
    if (
      subsequentTrades.length === 0 ||
      !subsequentTrades.some((trade) => Number(trade.quantity) < 0)
    ) {
      return false;
    }
    const closingQuantity = subsequentTrades.reduce(
      (quantity, trade) => quantity + (Number(trade.quantity) || 0),
      Number(nearestPosition.quantity) || 0,
    );
    return Math.abs(closingQuantity) <= QUANTITY_EPSILON;
  }
  let quantity = 0;
  let sawBuy = false;
  let sawSale = false;
  for (const trade of datedTrades) {
    const tradeQuantity = Number(trade.quantity) || 0;
    quantity += tradeQuantity;
    sawBuy ||= tradeQuantity > 0;
    sawSale ||= tradeQuantity < 0;
    if (quantity < -QUANTITY_EPSILON) return false;
  }
  return sawBuy && sawSale && Math.abs(quantity) <= QUANTITY_EPSILON;
}

function scheduleFaAcquisitionLots(trades, periodStart, periodEnd) {
  const openPriorLots = [];
  const inPeriodLots = [];

  for (const trade of [...trades].sort(compareDatedRows)) {
    if (!trade.date || (periodEnd && trade.date > periodEnd)) continue;
    const quantity = Number(trade.quantity) || 0;
    if (quantity > 0) {
      const value = positiveBasis(trade);
      if (!periodStart || trade.date >= periodStart) {
        inPeriodLots.push({ date: trade.date, value });
      } else {
        openPriorLots.push({
          date: trade.date,
          remainingQuantity: quantity,
          valuePerUnit: value / quantity,
        });
      }
      continue;
    }
    if (quantity >= 0 || !periodStart || trade.date >= periodStart) {
      continue;
    }

    let remainingSaleQuantity = Math.abs(quantity);
    while (
      remainingSaleQuantity > QUANTITY_EPSILON &&
      openPriorLots.length > 0
    ) {
      const lot = openPriorLots[0];
      const consumed = Math.min(
        remainingSaleQuantity,
        lot.remainingQuantity,
      );
      lot.remainingQuantity -= consumed;
      remainingSaleQuantity -= consumed;
      if (lot.remainingQuantity <= QUANTITY_EPSILON) {
        openPriorLots.shift();
      }
    }
  }

  return [
    ...openPriorLots.map((lot) => ({
      date: lot.date,
      value: roundMoney(lot.remainingQuantity * lot.valuePerUnit),
    })),
    ...inPeriodLots,
  ].filter((lot) => lot.value > 0);
}

function sourceOrder(row) {
  return [
    String(row?.source?.fileIndex ?? "").padStart(6, "0"),
    String(row?.source?.rowNumber ?? "").padStart(9, "0"),
  ].join(":");
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function finding(severity, code, message, details = {}) {
  return { severity, code, message, details };
}
