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
  const derivedEntities = [...symbols]
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
  const entities = derivedEntities.map((entity, entityIndex) => {
    const filingEntityId = `fa-a3-${entityIndex + 1}`;
    const filingRows = entity.filingRows.map((row, rowIndex) => ({
      ...row,
      filingEntityId,
      filingRowId: `${filingEntityId}-row-${rowIndex + 1}`,
    }));
    return {
      ...entity,
      filingEntityId,
      filingRows,
    };
  });
  const filingRows = entities.flatMap((entity) => entity.filingRows);
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
  if (
    filingRows.some((row) =>
      [row.peakStatus, row.closingStatus].includes(
        "position-lot-mismatch-review",
      ),
    )
  ) {
    findings.push(
      finding(
        "warning",
        "FA_A3_POSITION_LOT_MISMATCH",
        "One or more Schedule FA A3 lot allocations do not reconcile to the imported position quantity and must be reviewed manually.",
      ),
    );
  }
  if (filingRows.some((row) => row.evidence?.unmatchedSale)) {
    findings.push(
      finding(
        "warning",
        "FA_A3_UNMATCHED_SALE",
        "One or more Schedule FA A3 sales exceed the imported acquisition-lot evidence; closing values were not inferred from those sales.",
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
    filingRows,
    holdings,
    audit: {
      rawPositionRows: openPositions.length,
      supportedPositionRows: positions.length,
      snapshotDates: [...new Set(positions.map((position) => position.snapshotDate).filter(Boolean))].sort(),
      latestSnapshotDate,
      latestHoldingRows: holdings.length,
      entityCount: entities.length,
      filingRowCount: filingRows.length,
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

  const filingRows = scheduleFaFilingRows(
    securityTrades,
    securityPositions,
    periodStart,
    periodEnd,
    first,
    hasExactPeriodEndSnapshot,
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
    filingRows.map((row) => row.acquisitionDate).filter(Boolean).sort()[0] ?? "";
  const filingRowsInitialValue = roundMoney(
    filingRows.reduce(
      (total, row) => total + (Number(row.initialValue) || 0),
      0,
    ),
  );
  const filingBuyRows = filingRows.reduce(
    (total, row) => total + (Number(row.evidence?.buyRows) || 0),
    0,
  );
  const initialValue = filingRowsInitialValue > 0
    ? filingRowsInitialValue
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
        : hasAnySale || filingBuyRows > 1
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
      buyRows: filingBuyRows,
      positionRows: securityPositions.length,
      dividendRows: incomeRows.length,
    },
    filingRows,
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

function scheduleFaFilingRows(
  trades,
  positions,
  periodStart,
  periodEnd,
  identityRow,
  hasExactPeriodEndSnapshot,
) {
  const sortedTrades = [...trades]
    .filter((trade) => trade.date && (!periodEnd || trade.date <= periodEnd))
    .sort(compareDatedRows);
  const lots = [];
  let nextLotNumber = 1;
  let unmatchedSaleQuantity = 0;

  for (const trade of sortedTrades.filter(
    (row) => !periodStart || row.date < periodStart,
  )) {
    const quantity = Number(trade.quantity) || 0;
    if (quantity > 0) {
      lots.push(createScheduleFaLot(trade, nextLotNumber++));
      continue;
    }
    if (quantity < 0) {
      unmatchedSaleQuantity += allocateLotSale(lots, trade, false);
    }
  }

  for (const lot of lots) {
    lot.periodStartQuantity = lot.remainingQuantity;
    lot.overlapsPeriod = lot.periodStartQuantity > QUANTITY_EPSILON;
  }

  for (const trade of sortedTrades.filter(
    (row) => !periodStart || row.date >= periodStart,
  )) {
    const quantity = Number(trade.quantity) || 0;
    if (quantity > 0) {
      const lot = createScheduleFaLot(trade, nextLotNumber++);
      lot.overlapsPeriod = true;
      lots.push(lot);
      continue;
    }
    if (quantity < 0) {
      unmatchedSaleQuantity += allocateLotSale(lots, trade, true);
    }
  }

  const hasUnmatchedSale = unmatchedSaleQuantity > QUANTITY_EPSILON;
  const filingRows = lots
    .filter((lot) => lot.overlapsPeriod)
    .map((lot) =>
      buildScheduleFaFilingRow(
        lot,
        lots,
        positions,
        periodStart,
        periodEnd,
        identityRow,
        hasExactPeriodEndSnapshot,
        hasUnmatchedSale,
      ),
    )
    .sort((left, right) =>
      `${left.acquisitionDate}\u0000${String(left.acquisitionLotNumber).padStart(6, "0")}`.localeCompare(
        `${right.acquisitionDate}\u0000${String(right.acquisitionLotNumber).padStart(6, "0")}`,
      ),
    );

  return filingRows.length > 0
    ? filingRows
    : [
        buildScheduleFaReviewFilingRow(
          trades,
          positions,
          periodStart,
          periodEnd,
          identityRow,
          hasUnmatchedSale,
        ),
      ];
}

function createScheduleFaLot(trade, lotNumber) {
  const quantity = Number(trade.quantity) || 0;
  const initialValue = positiveBasis(trade);
  return {
    lotNumber,
    acquisitionDate: trade.date,
    quantity,
    remainingQuantity: quantity,
    periodStartQuantity: 0,
    valuePerUnit: quantity > 0 ? initialValue / quantity : 0,
    saleProceeds: 0,
    soldQuantity: 0,
    saleRows: 0,
    saleEvents: [],
    overlapsPeriod: false,
    events: [{ date: trade.date, quantity }],
  };
}

function allocateLotSale(lots, trade, isInPeriod) {
  let remainingSaleQuantity = Math.abs(Number(trade.quantity) || 0);
  const saleQuantity = remainingSaleQuantity;
  const saleProceeds = grossSaleProceeds(trade);
  while (remainingSaleQuantity > QUANTITY_EPSILON) {
    const lot = lots.find((candidate) =>
      candidate.remainingQuantity > QUANTITY_EPSILON,
    );
    if (!lot) return remainingSaleQuantity;
    const consumed = Math.min(remainingSaleQuantity, lot.remainingQuantity);
    lot.remainingQuantity = roundQuantity(lot.remainingQuantity - consumed);
    lot.events.push({ date: trade.date, quantity: -consumed });
    if (isInPeriod) {
      lot.overlapsPeriod = true;
      lot.soldQuantity = roundQuantity(lot.soldQuantity + consumed);
      const allocatedProceeds = saleQuantity > 0
        ? saleProceeds * (consumed / saleQuantity)
        : 0;
      lot.saleProceeds += allocatedProceeds;
      lot.saleRows += 1;
      lot.saleEvents.push({
        date: trade.date,
        quantity: roundQuantity(consumed),
        proceeds: roundMoney(allocatedProceeds),
      });
    }
    remainingSaleQuantity = roundQuantity(remainingSaleQuantity - consumed);
  }
  return 0;
}

function buildScheduleFaFilingRow(
  lot,
  lots,
  positions,
  periodStart,
  periodEnd,
  identityRow,
  hasExactPeriodEndSnapshot,
  hasUnmatchedSale,
) {
  const reportedQuantity =
    lot.acquisitionDate < periodStart
      ? lot.periodStartQuantity
      : lot.quantity;
  const initialValue = roundMoney(reportedQuantity * lot.valuePerUnit);
  const peakAllocation = peakPositionAllocation(
    lot,
    lots,
    positions,
    periodStart,
    periodEnd,
  );
  const inPeriodPositions = positions.filter((position) =>
    position.snapshotDate &&
    (!periodStart || position.snapshotDate >= periodStart) &&
    (!periodEnd || position.snapshotDate <= periodEnd),
  );
  const hasPositionLotMismatch = inPeriodPositions.some(
    (position) => !positionLotsReconcile(lots, position),
  );
  const exactClosing = positions.findLast(
    (position) => position.snapshotDate === periodEnd,
  );
  const nearestClosing = positions
    .filter((position) =>
      position.snapshotDate &&
      (!periodStart || position.snapshotDate >= periodStart) &&
      (!periodEnd || position.snapshotDate <= periodEnd),
    )
    .at(-1);
  const closingPosition = exactClosing ?? nearestClosing;
  const closingAllocation = exactClosing || nearestClosing
    ? positionValueAllocation(lot, closingPosition, lots)
    : null;
  const closingPositionMismatch =
    closingPosition && !positionLotsReconcile(lots, closingPosition);
  const isFullySold = lot.remainingQuantity <= QUANTITY_EPSILON;
  const confirmedFullDisposal =
    isFullySold &&
    hasExactPeriodEndSnapshot &&
    !hasUnmatchedSale &&
    !exactClosing;
  const exactClosingQuantity =
    exactClosing && !closingPositionMismatch
      ? quantityOnDate(lot, exactClosing.snapshotDate)
      : null;
  const nearestClosingQuantity =
    nearestClosing && !closingPositionMismatch
      ? quantityOnDate(lot, nearestClosing.snapshotDate)
      : null;
  const soldAmount = roundMoney(lot.saleProceeds);

  return {
    filingRowId: "",
    acquisitionLotNumber: lot.lotNumber,
    assetCategory: identityRow?.assetCategory,
    symbol: identityRow?.symbol,
    currency: identityRow?.currency,
    acquisitionDate: lot.acquisitionDate,
    acquisitionStatus: "derived-from-imported-buy",
    quantity: roundQuantity(reportedQuantity),
    initialValue,
    initialValueStatus:
      initialValue > 0
        ? lot.acquisitionDate < periodStart
          ? "review-acquisition-basis"
          : "source-basis"
        : "missing-evidence",
    grossAmountPaidOrCredited: soldAmount,
    grossAmountStatus:
      lot.saleRows > 0 ? "allocated-source-sold-proceeds" : "not-sold",
    peakDate: peakAllocation?.date ?? "",
    peakValue: peakAllocation?.value ?? null,
    peakStatus: peakAllocation
      ? "snapshot-limited-allocation"
      : hasPositionLotMismatch
        ? "position-lot-mismatch-review"
        : "missing-evidence",
    closingDate:
      exactClosing?.snapshotDate ??
      (confirmedFullDisposal
        ? periodEnd
        : nearestClosing?.snapshotDate ?? ""),
    closingQuantity: closingPositionMismatch
      ? null
      : exactClosing
        ? roundQuantity(exactClosingQuantity)
        : confirmedFullDisposal
          ? 0
          : nearestClosing
            ? roundQuantity(nearestClosingQuantity)
            : null,
    closingValue: closingPositionMismatch
      ? null
      : exactClosing
        ? isFullySold
          ? 0
          : closingAllocation
        : confirmedFullDisposal
          ? 0
          : nearestClosing
            ? closingAllocation
            : null,
    closingStatus: closingPositionMismatch
      ? "position-lot-mismatch-review"
      : exactClosing
        ? "exact-period-end-allocation"
        : confirmedFullDisposal
          ? "derived-full-disposal"
          : nearestClosing
            ? "nearest-prior-snapshot-allocation"
            : "missing-evidence",
    saleRedemptionProceeds: soldAmount,
    saleRedemptionStatus: lot.saleRows > 0 ? "allocated-source-proceeds" : "not-sold",
    saleEvents: lot.saleEvents,
    soldQuantity: roundQuantity(lot.soldQuantity),
    evidence: {
      buyRows: 1,
      saleRows: lot.saleRows,
      positionRows: positions.length,
      unmatchedSale: hasUnmatchedSale,
    },
    needsFx: identityRow?.currency !== "INR",
  };
}

function buildScheduleFaReviewFilingRow(
  trades,
  positions,
  periodStart,
  periodEnd,
  identityRow,
  hasUnmatchedSale,
) {
  const inPeriodPositions = positions.filter((position) =>
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
  const closingPosition = exactClosing ?? nearestClosing;
  const sales = trades.filter(
    (trade) =>
      Number(trade.quantity) < 0 &&
      isWithinPeriod(trade.date, periodStart, periodEnd),
  );
  const soldAmount = roundMoney(
    sales.reduce((total, trade) => total + grossSaleProceeds(trade), 0),
  );

  return {
    filingRowId: "",
    acquisitionLotNumber: 0,
    assetCategory: identityRow?.assetCategory,
    symbol: identityRow?.symbol,
    currency: identityRow?.currency,
    acquisitionDate: "",
    acquisitionStatus: "missing-evidence",
    quantity: null,
    initialValue: null,
    initialValueStatus: "missing-evidence",
    grossAmountPaidOrCredited: soldAmount,
    grossAmountStatus: sales.length > 0 ? "source-sold-proceeds-review" : "not-sold",
    peakDate: peakPosition?.snapshotDate ?? "",
    peakValue: finiteOrNull(peakPosition?.value),
    peakStatus: peakPosition ? "snapshot-limited-review" : "missing-evidence",
    closingDate: closingPosition?.snapshotDate ?? "",
    closingQuantity: finiteOrNull(closingPosition?.quantity),
    closingValue: finiteOrNull(closingPosition?.value),
    closingStatus: exactClosing
      ? "exact-period-end-review"
      : nearestClosing
        ? "nearest-prior-snapshot-review"
        : "missing-evidence",
    saleRedemptionProceeds: soldAmount,
    saleRedemptionStatus: sales.length > 0 ? "source-proceeds-review" : "not-sold",
    saleEvents: sales.map((trade) => ({
      date: trade.date,
      quantity: roundQuantity(Math.abs(Number(trade.quantity) || 0)),
      proceeds: roundMoney(grossSaleProceeds(trade)),
    })),
    soldQuantity: roundQuantity(
      sales.reduce(
        (total, trade) => total + Math.abs(Number(trade.quantity) || 0),
        0,
      ),
    ),
    evidence: {
      buyRows: 0,
      saleRows: sales.length,
      positionRows: positions.length,
      unmatchedSale: hasUnmatchedSale,
    },
    needsFx: identityRow?.currency !== "INR",
  };
}

function peakPositionAllocation(lot, lots, positions, periodStart, periodEnd) {
  return positions
    .filter((position) =>
      position.snapshotDate &&
      (!periodStart || position.snapshotDate >= periodStart) &&
      (!periodEnd || position.snapshotDate <= periodEnd),
    )
    .map((position) => ({
      date: position.snapshotDate,
      value: positionValueAllocation(lot, position, lots),
    }))
    .filter((allocation) => allocation.value !== null)
    .sort((left, right) => right.value - left.value)[0];
}

function positionValueAllocation(lot, position, lots) {
  if (!position) return null;
  const positionQuantity = Number(position.quantity);
  const positionValue = Number(position.value);
  const lotQuantity = quantityOnDate(lot, position.snapshotDate);
  if (
    !positionLotsReconcile(lots, position) ||
    !Number.isFinite(positionQuantity) ||
    Math.abs(positionQuantity) <= QUANTITY_EPSILON ||
    !Number.isFinite(positionValue) ||
    lotQuantity <= QUANTITY_EPSILON
  ) {
    return null;
  }
  return roundMoney(positionValue * (lotQuantity / positionQuantity));
}

function positionLotsReconcile(lots, position) {
  if (!position?.snapshotDate) return false;
  const positionQuantity = Number(position.quantity);
  if (!Number.isFinite(positionQuantity)) return false;
  const lotQuantity = lots.reduce(
    (total, lot) => total + quantityOnDate(lot, position.snapshotDate),
    0,
  );
  return Math.abs(lotQuantity - positionQuantity) <= QUANTITY_EPSILON;
}

function quantityOnDate(lot, date) {
  if (!date) return 0;
  return roundQuantity(
    lot.events
      .filter((event) => event.date && event.date <= date)
      .reduce((quantity, event) => quantity + event.quantity, 0),
  );
}

function grossSaleProceeds(trade) {
  const proceeds = Number(trade?.proceeds);
  return Number.isFinite(proceeds) ? Math.abs(proceeds) : 0;
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e9) / 1e9;
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
