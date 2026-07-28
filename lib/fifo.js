const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

export function buildFifoCapitalGains({ trades, holdingPeriodLongTermDays = 730 } = {}) {
  if (!Array.isArray(trades)) {
    throw new TypeError("buildFifoCapitalGains expects trades to be an array");
  }

  const rows = [];
  const findings = [];
  const lotsByInstrument = new Map();
  const validTrades = [];
  const resolveInstrumentKey = createInstrumentKeyResolver(trades);

  trades.forEach((trade, inputIndex) => {
    const sourceKey = sourceRef(trade.source, inputIndex);

    if (trade.unsupported) {
      findings.push(finding("warning", "UNSUPPORTED_TRADE", "Unsupported trade was excluded from FIFO matching.", {
        symbol: trade.symbol,
        currency: trade.currency,
        date: trade.date,
        source: trade.source,
      }));
      return;
    }

    const tradeDate = parseTradeDate(trade.date);
    if (!tradeDate) {
      findings.push(finding("warning", "INVALID_TRADE_DATE", "Trade with an invalid date was excluded from FIFO matching.", {
        symbol: trade.symbol,
        currency: trade.currency,
        date: trade.date,
        source: trade.source,
      }));
      return;
    }

    const quantity = numberValue(trade.quantity);
    if (quantity === 0) {
      return;
    }

    validTrades.push({
      ...trade,
      inputIndex,
      sourceKey,
      tradeDate,
      tradeOrderTime:
        parseTradeTimestamp(trade.timestamp, trade.date) ??
        tradeDate.getTime(),
      instrumentKey: resolveInstrumentKey(trade),
      quantity,
      symbol: String(trade.symbol ?? "").trim(),
      currency: String(trade.currency ?? "").trim().toUpperCase(),
    });
  });

  validTrades.sort(compareTrades);

  let totalBuyQuantity = 0;
  let totalSaleQuantity = 0;
  let matchedQuantity = 0;
  let unmatchedQuantity = 0;

  for (const trade of validTrades) {
    if (!trade.symbol || !trade.currency) {
      findings.push(finding("warning", "INVALID_TRADE_INSTRUMENT", "Trade without symbol or currency was excluded from FIFO matching.", {
        symbol: trade.symbol,
        currency: trade.currency,
        date: trade.date,
        source: trade.source,
      }));
      continue;
    }

    const instrumentKey = trade.instrumentKey;

    if (trade.quantity > 0) {
      const lot = buildBuyLot(trade);
      ensureLots(lotsByInstrument, instrumentKey).push(lot);
      totalBuyQuantity += trade.quantity;
      continue;
    }

    const saleQuantity = Math.abs(trade.quantity);
    totalSaleQuantity += saleQuantity;
    let remainingSaleQuantity = saleQuantity;
    const lots = ensureLots(lotsByInstrument, instrumentKey);

    while (remainingSaleQuantity > EPSILON && lots.length > 0) {
      const lot = lots[0];
      const quantitySold = Math.min(remainingSaleQuantity, lot.remainingQuantity);
      const saleRatio = quantitySold / saleQuantity;
      const lotRatio = quantitySold / lot.quantity;
      const proceeds = roundMoney((numberValue(trade.proceeds) + numberValue(trade.commission)) * saleRatio);
      const costBasis = roundMoney(lot.costBasis * lotRatio);
      const buyCommission = roundMoney(lot.commission * lotRatio);
      const sellCommission = roundMoney(numberValue(trade.commission) * saleRatio);
      const realizedProfitLoss = roundMoney(numberValue(trade.realizedProfitLoss) * saleRatio);
      const holdingDays = daysBetween(lot.tradeDate, trade.tradeDate);

      rows.push({
        symbol: trade.symbol,
        currency: trade.currency,
        date: trade.date,
        saleDate: trade.date,
        acquisitionDate: lot.date,
        quantitySold: roundQuantity(quantitySold),
        proceeds,
        costBasis,
        buyCommission,
        sellCommission,
        realizedProfitLoss,
        gain: roundMoney(proceeds - costBasis),
        holdingDays,
        gainBucket: holdingDays <= holdingPeriodLongTermDays ? "STCG" : "LTCG",
        lotId: lot.id,
        saleId: tradeId(trade, "sale"),
        source: {
          buy: lot.source,
          sale: trade.source,
        },
      });

      lot.remainingQuantity = roundQuantity(lot.remainingQuantity - quantitySold);
      remainingSaleQuantity = roundQuantity(remainingSaleQuantity - quantitySold);
      matchedQuantity += quantitySold;

      if (lot.remainingQuantity <= EPSILON) {
        lots.shift();
      }
    }

    if (remainingSaleQuantity > EPSILON) {
      unmatchedQuantity += remainingSaleQuantity;
      findings.push(finding("warning", "UNMATCHED_SALE", "Sale quantity exceeded available FIFO buy lots; unmatched quantity has no invented basis.", {
        symbol: trade.symbol,
        currency: trade.currency,
        date: trade.date,
        quantity: roundQuantity(remainingSaleQuantity),
        source: trade.source,
      }));
    }
  }

  return {
    rows,
    audit: {
      tradesReceived: trades.length,
      tradesConsidered: validTrades.length,
      rows: rows.length,
      totalBuyQuantity: roundQuantity(totalBuyQuantity),
      totalSaleQuantity: roundQuantity(totalSaleQuantity),
      matchedQuantity: roundQuantity(matchedQuantity),
      unmatchedQuantity: roundQuantity(unmatchedQuantity),
      openLotQuantity: roundQuantity(
        [...lotsByInstrument.values()].flat().reduce((total, lot) => total + lot.remainingQuantity, 0),
      ),
    },
    findings,
  };
}

function buildBuyLot(trade) {
  const quantity = trade.quantity;
  const explicitBasis = Math.abs(numberValue(trade.basis));
  const derivedBasis = Math.abs(numberValue(trade.proceeds)) + Math.abs(numberValue(trade.commission));

  return {
    id: tradeId(trade, "lot"),
    date: trade.date,
    source: trade.source,
    tradeDate: trade.tradeDate,
    quantity,
    remainingQuantity: quantity,
    costBasis: explicitBasis > 0 ? explicitBasis : derivedBasis,
    commission: Math.abs(numberValue(trade.commission)),
  };
}

function ensureLots(lotsByInstrument, instrumentKey) {
  if (!lotsByInstrument.has(instrumentKey)) {
    lotsByInstrument.set(instrumentKey, []);
  }
  return lotsByInstrument.get(instrumentKey);
}

function compareTrades(left, right) {
  return (
    left.tradeOrderTime - right.tradeOrderTime ||
    left.sourceKey.localeCompare(right.sourceKey) ||
    left.inputIndex - right.inputIndex
  );
}

function parseTradeTimestamp(value, expectedDate) {
  const match = String(value ?? "").match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match || match[1] !== expectedDate) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return Date.UTC(
    Number(match[1].slice(0, 4)),
    Number(match[1].slice(5, 7)) - 1,
    Number(match[1].slice(8, 10)),
    hour,
    minute,
    second,
  );
}

function createInstrumentKeyResolver(trades) {
  const stableBySymbol = new Map();
  const ambiguousSymbols = new Set();

  for (const trade of trades) {
    const stableKey = stableInstrumentKey(trade);
    const symbolKey = symbolInstrumentKey(trade);
    if (!stableKey || !symbolKey) continue;
    const existing = stableBySymbol.get(symbolKey);
    if (existing && existing !== stableKey) {
      ambiguousSymbols.add(symbolKey);
      stableBySymbol.delete(symbolKey);
    } else if (!ambiguousSymbols.has(symbolKey)) {
      stableBySymbol.set(symbolKey, stableKey);
    }
  }

  return (trade) => {
    const stableKey = stableInstrumentKey(trade);
    if (stableKey) return stableKey;
    const symbolKey = symbolInstrumentKey(trade);
    return stableBySymbol.get(symbolKey) ?? symbolKey;
  };
}

function stableInstrumentKey(trade) {
  const identifiers = [
    ["conid", trade?.conid],
    ["isin", trade?.isin],
    ["figi", trade?.figi],
    ["cusip", trade?.cusip],
    ["security-id", trade?.securityId],
  ];
  for (const [name, value] of identifiers) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized) return `${name}:${normalized}`;
  }
  return "";
}

function symbolInstrumentKey(trade) {
  const symbol = String(trade?.symbol ?? "").trim().toUpperCase();
  const currency = String(trade?.currency ?? "").trim().toUpperCase();
  return symbol ? `symbol:${symbol}\u0000${currency}` : "";
}

function parseTradeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function daysBetween(acquisitionDate, saleDate) {
  return Math.floor((saleDate.getTime() - acquisitionDate.getTime()) / DAY_MS);
}

function sourceRef(source, inputIndex) {
  if (!source || typeof source !== "object") {
    return `input:${inputIndex}`;
  }

  return [
    source.fileIndex ?? "",
    source.rowNumber ?? "",
    source.section ?? "",
    source.id ?? "",
    inputIndex,
  ].join(":");
}

function tradeId(trade, prefix) {
  return [
    prefix,
    trade.symbol,
    trade.currency,
    trade.date,
    trade.sourceKey,
  ].join(":");
}

function numberValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value) {
  return Math.round((value + Number.EPSILON) * 1e10) / 1e10;
}

function finding(severity, code, message, details = {}) {
  return { severity, code, message, details };
}
