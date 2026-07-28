const STOCK_CATEGORIES = new Set(["STK", "STOCK", "COMMON STOCK"]);

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
  const latestSnapshotPositions = latestSnapshotDate
    ? collapseSnapshot(
        positions.filter(
          (position) =>
            position.snapshotDate === latestSnapshotDate &&
            Number(position.quantity) !== 0,
        ),
      )
    : [];
  const activityKeys = new Set(
    [...activityTrades, ...activityPositions]
      .map((row) => securityKey(row))
      .filter(Boolean),
  );
  const possiblePassiveHoldingKeys = new Set(
    latestSnapshotPositions
      .filter((position) =>
        couldHaveBeenHeldDuringCalendarYear(
          position,
          trades,
          periodEnd,
        ),
      )
      .map((position) => securityKey(position))
      .filter(Boolean),
  );
  const symbols = new Set(
    [...activityKeys, ...possiblePassiveHoldingKeys],
  );
  const reviewOnlyEntityKeys = [...possiblePassiveHoldingKeys].filter(
    (key) => !activityKeys.has(key),
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
      }),
    )
    .filter(Boolean)
    .sort((left, right) =>
      `${left.symbol}\u0000${left.currency}`.localeCompare(
        `${right.symbol}\u0000${right.currency}`,
      ),
    );
  const holdings = latestSnapshotPositions;
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
  if (reviewOnlyEntityKeys.length > 0) {
    findings.push(
      finding(
        "warning",
        "FA_CALENDAR_YEAR_EVIDENCE_INCOMPLETE",
        "One or more latest holdings may have existed during the Schedule FA calendar year but lack an in-year trade or position snapshot; they are included as review-only entities.",
        { entities: reviewOnlyEntityKeys.length },
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
      reviewOnlyEntityCount: reviewOnlyEntityKeys.length,
      calendarYearEvidenceComplete: reviewOnlyEntityKeys.length === 0,
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
}) {
  const securityTrades = trades
    .filter((trade) => securityKey(trade) === key)
    .sort(compareDatedRows);
  const securityPositions = positions
    .filter((position) => securityKey(position) === key)
    .sort((left, right) =>
      `${left.snapshotDate}\u0000${sourceOrder(left)}`.localeCompare(
        `${right.snapshotDate}\u0000${sourceOrder(right)}`,
      ),
    );
  const first = securityTrades[0] ?? securityPositions[0];
  if (!first) return null;

  const buys = securityTrades.filter((trade) => Number(trade.quantity) > 0);
  const sales = securityTrades.filter(
    (trade) =>
      Number(trade.quantity) < 0 &&
      isWithinPeriod(trade.date, periodStart, periodEnd),
  );
  const acquisitionDate = buys.map((trade) => trade.date).filter(Boolean).sort()[0] ?? "";
  const initialValue = buys.length
    ? positiveBasis(buys[0])
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
  const closingPosition = exactClosing ?? nearestClosing;
  const companyToken = String(first.symbol ?? "").trim().toUpperCase();
  const incomeRows = dividends.filter(
    (row) =>
      isWithinPeriod(row.date, periodStart, periodEnd) &&
      descriptionStartsWithSymbol(row.description, companyToken),
  );

  return {
    assetCategory: first.assetCategory,
    symbol: first.symbol,
    currency: first.currency,
    acquisitionDate,
    acquisitionStatus: acquisitionDate
      ? "derived-from-imported-buy"
      : "prior-period-or-transfer-review",
    initialValue,
    initialValueStatus: initialValue > 0 ? "source-basis" : "missing-evidence",
    peakDate: peakPosition?.snapshotDate ?? "",
    peakValue: finiteOrNull(peakPosition?.value),
    peakStatus: peakPosition ? "snapshot-limited" : "missing-evidence",
    closingDate: closingPosition?.snapshotDate ?? "",
    closingValue: finiteOrNull(closingPosition?.value),
    closingQuantity: finiteOrNull(closingPosition?.quantity),
    closingStatus: exactClosing
      ? "exact-period-end"
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
      positionRows: securityPositions.length,
      dividendRows: incomeRows.length,
    },
    needsFx: first.currency !== "INR",
  };
}

function collapseSnapshot(rows) {
  const bySecurity = new Map();
  for (const row of rows) {
    const key = securityKey(row);
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
    quantity: position.quantity,
    value: position.value,
    snapshotDate: position.snapshotDate,
    source: position.source,
    needsFx: position.currency !== "INR",
  }));
}

function couldHaveBeenHeldDuringCalendarYear(position, trades, periodEnd) {
  const key = securityKey(position);
  if (!key || !periodEnd) return true;
  const securityTrades = trades.filter(
    (trade) => isSupportedStock(trade) && securityKey(trade) === key,
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

function descriptionStartsWithSymbol(description, symbol) {
  if (!symbol) return false;
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

function securityKey(row) {
  const symbol = String(row?.symbol ?? "").trim().toUpperCase();
  const currency = String(row?.currency ?? "").trim().toUpperCase();
  return symbol ? `${symbol}\u0000${currency}` : "";
}

function compareDatedRows(left, right) {
  return `${left.date}\u0000${sourceOrder(left)}`.localeCompare(
    `${right.date}\u0000${sourceOrder(right)}`,
  );
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
