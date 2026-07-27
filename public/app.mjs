import {
  buildReviewModel,
  makeDemoReview,
  parseIbkrStatements,
} from "./lib/ibkr.js";
import { csvCell } from "./lib/export.js";
import {
  enrichReviewWithReferenceData,
  lookupUsdTtBuyRate,
  parseSbiReferenceRatesCsv,
  parseSecCompanyTickersExchange,
} from "./lib/reference-data.js";
import {
  BUNDLED_SBI_USD_CSV,
  BUNDLED_SEC_COMPANY_JSON,
} from "./lib/reference-data.generated.js";

const BUNDLED_USD_TT_BUY_RATES = parseSbiReferenceRatesCsv(BUNDLED_SBI_USD_CSV, {
  provider: "SBI FX RateKeeper community archive",
  sourceUrl: "https://github.com/sahilgupta/sbi-fx-ratekeeper",
  license: "MIT repository · community-derived reference data",
  asOf: "2026-07-27",
});
const BUNDLED_COMPANY_LOOKUP = parseSecCompanyTickersExchange(
  BUNDLED_SEC_COMPANY_JSON,
  {
    provider: "SEC EDGAR company_tickers_exchange",
    sourceUrl: "https://www.sec.gov/files/company_tickers_exchange.json",
    asOf: "2026-07-24",
  },
);

const state = {
  currentStep: "import",
  files: [],
  review: null,
  reviewTab: "overview",
  sourceKind: null,
  rateSourceKind: "bundled-community",
  usdTtBuyRates: BUNDLED_USD_TT_BUY_RATES,
};

const MAX_FILE_COUNT = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const stepOrder = ["import", "configure", "review", "export"];
const elements = {
  auditFiles: document.querySelector('[data-audit="files"]'),
  auditRows: document.querySelector('[data-audit="rows"]'),
  clearDialog: document.querySelector("[data-clear-dialog]"),
  fileInput: document.querySelector("[data-file-input]"),
  fileList: document.querySelector("[data-file-list]"),
  importStatus: document.querySelector("[data-import-status]"),
  issueCount: document.querySelector("[data-issue-count]"),
  processButton: document.querySelector('[data-action="process"]'),
  rateFileInput: document.querySelector("[data-rate-file-input]"),
  rateLookupDate: document.querySelector("[data-rate-lookup-date]"),
  rateLookupResult: document.querySelector("[data-rate-lookup-result]"),
  rateStatus: document.querySelector("[data-rate-status]"),
  rateSummary: document.querySelector("[data-rate-summary]"),
  rateTableBody: document.querySelector("[data-rate-table-body]"),
  reviewContent: document.querySelector("[data-review-content]"),
  reviewStamp: document.querySelector("[data-review-stamp]"),
  companySummary: document.querySelector("[data-company-summary]"),
  toast: document.querySelector("[data-toast]"),
  validationList: document.querySelector("[data-validation-list]"),
};

function withReferenceData(review) {
  return enrichReviewWithReferenceData(review, {
    companyLookup: BUNDLED_COMPANY_LOOKUP,
    usdTtBuyRates: state.usdTtBuyRates,
  });
}

function selectStep(step) {
  if (!stepOrder.includes(step)) return;
  state.currentStep = step;
  const activeIndex = stepOrder.indexOf(step);

  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    const active = panel.dataset.stepPanel === step;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });

  document.querySelectorAll("[data-step-target]").forEach((button) => {
    const index = stepOrder.indexOf(button.dataset.stepTarget);
    button.classList.toggle("is-active", button.dataset.stepTarget === step);
    button.classList.toggle("is-complete", index < activeIndex);
    if (button.dataset.stepTarget === step) {
      button.setAttribute("aria-current", "step");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(number);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function setRateStatus(message, kind = "") {
  elements.rateStatus.textContent = message;
  elements.rateStatus.className = `inline-status${kind ? ` is-${kind}` : ""}`;
}

function appendTextCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = String(value ?? "—");
  row.append(cell);
}

function renderReferenceData() {
  const rates = state.usdTtBuyRates.records;
  const first = rates[0]?.date ?? "—";
  const last = rates.at(-1)?.date ?? "—";
  elements.rateSummary.textContent =
    `${rates.length.toLocaleString("en-IN")} usable USD rows · ${first} to ${last}`;
  elements.companySummary.textContent =
    `${BUNDLED_COMPANY_LOOKUP.count.toLocaleString("en-IN")} SEC ticker associations · snapshot 24 Jul 2026`;

  elements.rateTableBody.replaceChildren();
  rates
    .slice(-12)
    .reverse()
    .forEach((rate) => {
      const row = document.createElement("tr");
      appendTextCell(row, rate.timestamp);
      appendTextCell(row, formatNumber(rate.ttBuy));

      const evidence = document.createElement("td");
      const href = safeExternalUrl(rate.sourceUrl);
      if (href) {
        const link = document.createElement("a");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent =
          state.rateSourceKind === "user-supplied"
            ? "User-supplied evidence URL"
            : "Archived evidence";
        evidence.append(link);
      } else {
        evidence.textContent = "Source URL unavailable";
      }
      row.append(evidence);
      elements.rateTableBody.append(row);
    });
}

function renderRateLookup() {
  const match = lookupUsdTtBuyRate(
    state.usdTtBuyRates,
    elements.rateLookupDate.value,
  );
  elements.rateLookupResult.replaceChildren();

  const message = document.createElement("p");
  if (match.status === "invalid-date") {
    message.textContent = "Choose a date to perform an exact-date lookup.";
    elements.rateLookupResult.append(message);
    return;
  }
  if (match.status === "missing") {
    message.textContent =
      `No usable USD TT BUY row exists for ${match.date}. No prior-day or market-rate fallback was applied.`;
    elements.rateLookupResult.append(message);
    return;
  }
  if (match.status === "ambiguous") {
    message.textContent =
      `${match.observations.length} different intraday observations exist for ${match.date}. No rate was selected automatically.`;
    elements.rateLookupResult.append(message);
    const list = document.createElement("ul");
    match.observations.forEach((observation) => {
      const item = document.createElement("li");
      item.textContent = `${observation.timestamp}: ₹${formatNumber(observation.rate)} per USD`;
      list.append(item);
    });
    elements.rateLookupResult.append(list);
    return;
  }

  const strong = document.createElement("strong");
  strong.textContent = `${match.date}: ₹${formatNumber(match.rate)} per USD`;
  message.append(strong, document.createTextNode(" · community reference"));
  elements.rateLookupResult.append(message);

  const href = safeExternalUrl(match.sourceUrl);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent =
      state.rateSourceKind === "user-supplied"
        ? "Open user-supplied evidence URL"
        : "Open archived source evidence";
    elements.rateLookupResult.append(link);
  }
}

async function importRateFile() {
  const file = elements.rateFileInput.files?.[0];
  if (!file) return;
  if (!(file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv")) {
    setRateStatus("Choose a CSV file containing DATE and TT BUY columns.", "error");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setRateStatus("Reference CSVs larger than 5 MB are not accepted.", "error");
    return;
  }

  try {
    const table = parseSbiReferenceRatesCsv(await file.text(), {
      provider: `Local reference CSV · ${file.name}`,
      license: "User supplied",
      asOf: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10),
    });
    if (table.count === 0) {
      throw new Error("No positive TT BUY rows were found");
    }
    state.usdTtBuyRates = table;
    state.rateSourceKind = "user-supplied";
    if (state.review) {
      state.review = withReferenceData(state.review);
      renderReview();
    }
    renderReferenceData();
    renderRateLookup();
    setRateStatus(
      `Loaded ${table.count.toLocaleString("en-IN")} usable USD rates from ${file.name}.`,
      "success",
    );
  } catch (error) {
    setRateStatus(
      error instanceof Error
        ? `Could not use this rate CSV: ${error.message}`
        : "Could not use this rate CSV.",
      "error",
    );
  }
}

function setImportStatus(message, kind = "") {
  elements.importStatus.textContent = message;
  elements.importStatus.className = `inline-status${kind ? ` is-${kind}` : ""}`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2800);
}

function updateFileList() {
  elements.fileList.replaceChildren();
  elements.fileList.hidden = state.files.length === 0;

  state.files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "file-item";

    const description = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(file.size);
    description.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      updateFileList();
    });

    row.append(description, remove);
    elements.fileList.append(row);
  });

  elements.processButton.disabled = state.files.length === 0;
  elements.auditFiles.textContent = String(state.files.length);
  if (state.files.length > 0) {
    setImportStatus(
      `${state.files.length} statement${state.files.length === 1 ? "" : "s"} ready to parse.`,
    );
  } else if (!state.review) {
    setImportStatus("Choose CSVs or load the synthetic demo to begin.");
  }
}

function addFiles(files) {
  const known = new Set(state.files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  let totalBytes = state.files.reduce((sum, file) => sum + file.size, 0);
  let invalidType = 0;
  let oversized = 0;
  let overTotal = 0;
  let overCount = 0;
  let duplicates = 0;

  for (const file of [...files]) {
    const lowerName = file.name.toLowerCase();
    if (!(lowerName.endsWith(".csv") || file.type === "text/csv")) {
      invalidType += 1;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      oversized += 1;
      continue;
    }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (known.has(key)) {
      duplicates += 1;
      continue;
    }
    if (state.files.length >= MAX_FILE_COUNT) {
      overCount += 1;
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      overTotal += 1;
      continue;
    }
    state.files.push(file);
    known.add(key);
    totalBytes += file.size;
  }

  updateFileList();
  if (invalidType > 0) {
    setImportStatus("Only CSV files were added; other formats were ignored.", "error");
  } else if (oversized > 0) {
    setImportStatus("Files larger than 25 MB were ignored to protect this browser tab.", "error");
  } else if (overTotal > 0) {
    setImportStatus("The 50 MB total import limit was reached; remaining files were ignored.", "error");
  } else if (overCount > 0) {
    setImportStatus("Up to 5 statement files can be parsed in one local session.", "error");
  } else if (duplicates > 0) {
    setImportStatus("Duplicate statement files were ignored.", "error");
  }
}

async function processFiles() {
  if (state.files.length === 0) return;

  elements.processButton.disabled = true;
  elements.processButton.textContent = "Parsing locally…";
  setImportStatus("Reading statements in this browser tab…");

  try {
    const csvs = await Promise.all(state.files.map((file) => file.text()));
    const parsed = parseIbkrStatements(csvs, {
      fileNames: state.files.map((file) => file.name),
    });
    state.review = withReferenceData(buildReviewModel(parsed));
    state.sourceKind = "user";
    renderReview();
    setImportStatus(
      `Parsed ${state.review.summary.trades} trades, ${state.review.summary.dividends} dividends, and ${state.review.summary.positions} positions.`,
      "success",
    );
    selectStep("configure");
  } catch (error) {
    state.review = null;
    setImportStatus(
      error instanceof Error
        ? `Could not parse these CSVs: ${error.message}`
        : "Could not parse these CSVs.",
      "error",
    );
  } finally {
    elements.processButton.disabled = state.files.length === 0;
    elements.processButton.textContent = "Parse selected files";
  }
}

function loadDemo() {
  state.review = withReferenceData(makeDemoReview());
  state.sourceKind = "demo";
  state.files = [];
  updateFileList();
  renderReview();
  setImportStatus("Synthetic demo loaded. No personal data is present.", "success");
  selectStep("configure");
}

function getConfig() {
  return {
    ...Object.fromEntries(
      [...document.querySelectorAll("[data-config]")].map((input) => [
        input.dataset.config,
        input.value,
      ]),
    ),
    rateSource: state.rateSourceKind,
  };
}

function humanizeKey(key) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function renderTable(rows, columns) {
  if (!rows?.length) {
    return '<div class="empty-review">No source rows were mapped to this working table.</div>';
  }

  const header = columns
    .map(({ label }) => `<th scope="col">${escapeHtml(label)}</th>`)
    .join("");
  const body = rows
    .slice(0, 50)
    .map((row) => {
      const cells = columns
        .map(({ key, format, value: getValue }) => {
          const rawValue = getValue ? getValue(row) : row[key];
          const value = format === "number" ? formatNumber(rawValue) : rawValue;
          return `<td>${escapeHtml(value === true ? "Rate needed" : value === false ? "Ready" : value)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table class="data-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderReviewTab() {
  if (!state.review) {
    elements.reviewContent.innerHTML =
      '<div class="empty-review">Load a statement or the synthetic demo to preview review tables.</div>';
    return;
  }

  const { schedules, summary, totals } = state.review;
  if (state.reviewTab === "overview") {
    elements.reviewContent.innerHTML = `
      <div class="review-summary">
        <div class="summary-block">
          <small>Realized P/L · broker reference</small>
          <strong>${escapeHtml(formatNumber(totals.realizedProfitLoss))}</strong>
          <span>Foreign-currency values; Indian recomputation still required</span>
        </div>
        <div class="summary-block">
          <small>Dividends · broker reference</small>
          <strong>${escapeHtml(formatNumber(totals.dividends))}</strong>
          <span>${summary.dividends} source row${summary.dividends === 1 ? "" : "s"}</span>
        </div>
        <div class="summary-block">
          <small>Foreign withholding</small>
          <strong>${escapeHtml(formatNumber(Math.abs(totals.withholdingTax)))}</strong>
          <span>FTC eligibility and country mapping require review</span>
        </div>
        <div class="summary-block">
          <small>Open positions · closing value</small>
          <strong>${escapeHtml(formatNumber(totals.openPositionValue))}</strong>
          <span>Peak value and Rule 115 conversion not inferred</span>
        </div>
        <div class="summary-block">
          <small>Reference coverage</small>
          <strong>${escapeHtml(state.review.referenceData.companyLookup.records.toLocaleString("en-IN"))}</strong>
          <span>Offline SEC ticker associations · no live provider call</span>
        </div>
        <div class="summary-block">
          <small>USD TT BUY reference</small>
          <strong>${escapeHtml(state.review.referenceData.usdTtBuyRates.records.toLocaleString("en-IN"))}</strong>
          <span>Community archive rows · exact-date lookup only</span>
        </div>
      </div>`;
    return;
  }

  if (state.reviewTab === "capitalGains") {
    elements.reviewContent.innerHTML = renderTable(schedules.capitalGains, [
      { key: "symbol", label: "Symbol" },
      { label: "Company", value: (row) => row.company?.name || "Unmatched" },
      { label: "Exchange", value: (row) => row.company?.exchange || "—" },
      { key: "date", label: "Transfer date" },
      { key: "currency", label: "CCY" },
      { key: "quantitySold", label: "Qty", format: "number" },
      { key: "proceeds", label: "Proceeds", format: "number" },
      { key: "costBasis", label: "IBKR basis", format: "number" },
      { key: "realizedProfitLoss", label: "IBKR P/L", format: "number" },
    ]);
    return;
  }

  if (state.reviewTab === "fsi") {
    const income = schedules.fsi.map((row) => ({ ...row, workingPaper: "FSI" }));
    const relief = schedules.tr.map((row) => ({
      ...row,
      incomeType: "foreign tax",
      amount: row.taxPaid,
      workingPaper: "TR",
    }));
    elements.reviewContent.innerHTML = renderTable([...income, ...relief], [
      { key: "workingPaper", label: "Paper" },
      { key: "incomeType", label: "Type" },
      { label: "Company", value: (row) => row.company?.name || "Unmatched" },
      { key: "date", label: "Date" },
      { key: "currency", label: "CCY" },
      { key: "description", label: "Source description" },
      { key: "amount", label: "Amount", format: "number" },
      { key: "needsFx", label: "FX status" },
    ]);
    return;
  }

  if (state.reviewTab === "ttbr") {
    const rows = state.usdTtBuyRates.records.slice(-50).reverse();
    elements.reviewContent.innerHTML = `
      <div class="reference-table-note">
        <strong>USD TT BUY community reference</strong>
        <span>Latest 50 usable dates. No prior-day fallback and no automatic tax conversion.</span>
        <a href="./data/sbi-usd-tt-buy-community.csv" download>Download the complete CSV</a>
      </div>
      ${renderTable(rows, [
        { key: "timestamp", label: "Published at" },
        { key: "currency", label: "Currency" },
        { key: "ttBuy", label: "TT BUY (INR)", format: "number" },
      ])}`;
    return;
  }

  elements.reviewContent.innerHTML = renderTable(schedules.fa, [
    { key: "assetCategory", label: "Asset class" },
    { key: "symbol", label: "Symbol" },
    { label: "Company", value: (row) => row.company?.name || "Unmatched" },
    { label: "Exchange", value: (row) => row.company?.exchange || "—" },
    { key: "currency", label: "CCY" },
    { key: "quantity", label: "Quantity", format: "number" },
    { key: "value", label: "Closing value", format: "number" },
    { key: "needsFx", label: "FX status" },
  ]);
}

function renderValidations() {
  const validations = state.review?.validations ?? [];
  elements.validationList.replaceChildren();
  elements.issueCount.textContent = `${validations.length} check${validations.length === 1 ? "" : "s"}`;

  if (validations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = state.review
      ? "No automated findings. Professional review is still required."
      : "No review model loaded.";
    elements.validationList.append(empty);
    return;
  }

  validations.slice(0, 8).forEach((finding) => {
    const item = document.createElement("div");
    const severity = ["error", "warning", "info"].includes(finding.severity)
      ? finding.severity
      : "info";
    item.className = `validation-item ${severity}`;

    const mark = document.createElement("span");
    mark.className = "validation-mark";
    mark.textContent = severity === "error" ? "×" : severity === "warning" ? "!" : "i";
    mark.setAttribute("aria-label", severity);

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = humanizeKey(finding.code);
    const message = document.createElement("p");
    message.textContent = finding.message;
    copy.append(title, message);

    const code = document.createElement("span");
    code.className = "validation-code";
    code.textContent = finding.code;
    item.append(mark, copy, code);
    elements.validationList.append(item);
  });
}

function renderReview() {
  const summary = state.review?.summary ?? {
    files: 0,
    trades: 0,
    positions: 0,
    dividends: 0,
  };
  const validations = state.review?.validations ?? [];

  document.querySelector('[data-metric="trades"]').textContent = String(summary.trades);
  document.querySelector('[data-metric="positions"]').textContent = String(summary.positions);
  document.querySelector('[data-metric="dividends"]').textContent = String(summary.dividends);
  document.querySelector('[data-metric="checks"]').textContent = String(validations.length);
  elements.auditFiles.textContent = String(summary.files);
  elements.auditRows.textContent = String(
    summary.trades +
      summary.positions +
      summary.dividends +
      (summary.withholding ?? 0) +
      (summary.interest ?? 0) +
      (summary.transfers ?? 0),
  );
  elements.reviewStamp.textContent = validations.some((finding) => finding.severity === "error")
    ? "Blocked"
    : validations.length
      ? "Needs review"
      : "Draft ready";
  elements.reviewStamp.className = validations.length
    ? "stamp stamp-review"
    : "stamp stamp-ready";

  renderReviewTab();
  renderValidations();
}

function downloadBlob(name, type, body) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportTable(title, rows) {
  if (!rows.length) return `<h2>${escapeHtml(title)}</h2><p>No mapped rows.</p>`;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const header = columns.map((column) => `<th>${escapeHtml(humanizeKey(column))}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function flattenCompany(row) {
  const { company, ...rest } = row;
  if (!company) return rest;
  return {
    ...rest,
    companyName: company.name,
    companyExchange: company.exchange,
    companyCik: company.cik,
    companyMatch: company.status,
    companyProvider: company.provider,
  };
}

function makeReport() {
  const config = getConfig();
  const review = state.review;
  const validationRows = review.validations.map(({ severity, code, message }) => ({
    severity,
    code,
    message,
  }));
  const sourceLabel = state.sourceKind === "demo" ? "Synthetic demo" : "User-selected local statements";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OpenTax Ledger CA Review</title>
<style>
body{font-family:Arial,sans-serif;color:#171512;margin:40px;line-height:1.45}h1,h2{font-family:Georgia,serif;font-weight:500}h1{font-size:34px;margin-bottom:4px}h2{font-size:20px;margin-top:32px;border-bottom:2px solid #0a4f4a;padding-bottom:6px}p,li{font-size:12px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#d6ccbb;border:1px solid #d6ccbb;margin:24px 0}.meta div{background:#f7f3eb;padding:12px}.meta small{display:block;color:#5d574f;text-transform:uppercase;font-size:9px}.warning{background:#f2e6c9;border-left:4px solid #9b6818;padding:12px}table{border-collapse:collapse;font-size:9px;width:100%}th,td{border:1px solid #d6ccbb;padding:6px;text-align:left;vertical-align:top}th{background:#eee8dc}@media print{body{margin:15mm}.no-print{display:none}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}</style>
</head><body>
<h1>OpenTax Ledger · CA review packet</h1>
<p>Generated ${escapeHtml(new Date().toLocaleString("en-IN"))} · ${escapeHtml(sourceLabel)}</p>
<div class="warning"><strong>Draft working papers only.</strong> Not tax advice, not an ITR submission, and not filing evidence. Confirm all classifications, dates, FX rates, and foreign tax credit claims.</div>
<div class="meta">
<div><small>Assessment year</small>${escapeHtml(config.assessmentYear)}</div>
<div><small>Residential status</small>${escapeHtml(config.residentialStatus)}</div>
<div><small>Return assumption</small>${escapeHtml(config.returnForm)}</div>
</div>
${reportTable("Capital Gains working table", review.schedules.capitalGains.map(flattenCompany))}
${reportTable("Schedule FSI working table", review.schedules.fsi.map(flattenCompany))}
${reportTable("Schedule TR working table", review.schedules.tr.map(flattenCompany))}
${reportTable("Schedule FA working table", review.schedules.fa.map(flattenCompany))}
${reportTable("Reference-data provenance", [
  review.referenceData.usdTtBuyRates,
  review.referenceData.companyLookup,
])}
${reportTable("Validation register", validationRows)}
<h2>Required professional review</h2>
<ul>${review.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
<p><strong>Privacy note:</strong> this report was generated locally in the browser. It may contain sensitive financial information after you import your own files; store and share it carefully.</p>
</body></html>`;
}

function exportReport() {
  if (!state.review) {
    showToast("Load statements or the synthetic demo before exporting.");
    return;
  }
  downloadBlob(
    "opentax-ledger-ca-review.html",
    "text/html;charset=utf-8",
    makeReport(),
  );
  showToast("CA review report downloaded locally.");
}

function exportJson() {
  if (!state.review) {
    showToast("Load statements or the synthetic demo before exporting.");
    return;
  }
  const {
    generatedAt,
    source,
    summary,
    schedules,
    validations,
    assumptions,
    privacy,
    totals,
    currencies,
    stats,
    checklist,
    referenceData,
  } = state.review;
  downloadBlob(
    "opentax-ledger-audit.json",
    "application/json;charset=utf-8",
    JSON.stringify(
      {
        product: "OpenTax Ledger",
        version: "0.2.0",
        exportedAt: new Date().toISOString(),
        config: getConfig(),
        review: {
          generatedAt,
          source,
          summary,
          schedules,
          validations,
          assumptions,
          privacy,
          totals,
          currencies,
          stats,
          checklist,
          referenceData,
        },
      },
      null,
      2,
    ),
  );
  showToast("Audit JSON downloaded locally.");
}

function exportCsv() {
  if (!state.review) {
    showToast("Load statements or the synthetic demo before exporting.");
    return;
  }

  const scheduleEntries = [
    ["Capital Gains", state.review.schedules.capitalGains.map(flattenCompany)],
    ["FSI", state.review.schedules.fsi.map(flattenCompany)],
    ["TR", state.review.schedules.tr.map(flattenCompany)],
    ["FA", state.review.schedules.fa.map(flattenCompany)],
  ];
  const columns = [
    "schedule",
    ...new Set(scheduleEntries.flatMap(([, rows]) => rows.flatMap((row) => Object.keys(row)))),
  ];
  const rows = scheduleEntries.flatMap(([schedule, items]) =>
    items.map((item) => ({ schedule, ...item })),
  );
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
  downloadBlob("opentax-ledger-schedules.csv", "text/csv;charset=utf-8", `\uFEFF${csv}`);
  showToast("Combined schedule CSV downloaded locally.");
}

function resetSession() {
  state.files = [];
  state.review = null;
  state.reviewTab = "overview";
  state.sourceKind = null;
  state.rateSourceKind = "bundled-community";
  state.usdTtBuyRates = BUNDLED_USD_TT_BUY_RATES;
  elements.fileInput.value = "";
  elements.rateFileInput.value = "";
  elements.rateLookupDate.value = "";
  document.querySelectorAll("[data-review-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.reviewTab === "overview"));
  });
  updateFileList();
  renderReferenceData();
  renderRateLookup();
  setRateStatus("Using the bundled, pinned community USD reference table.");
  renderReview();
  selectStep("import");
  showToast("Local session cleared.");
}

document.querySelectorAll("[data-step-target], [data-go-step]").forEach((button) => {
  button.addEventListener("click", () => {
    selectStep(button.dataset.stepTarget ?? button.dataset.goStep);
  });
});

elements.fileInput.addEventListener("change", () => {
  addFiles(elements.fileInput.files ?? []);
});
elements.rateFileInput.addEventListener("change", importRateFile);
document
  .querySelector('[data-action="lookup-rate"]')
  .addEventListener("click", renderRateLookup);

const dropZone = document.querySelector("[data-drop-zone]");
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  addFiles(event.dataTransfer?.files ?? []);
});

elements.processButton.addEventListener("click", processFiles);
document.querySelector('[data-action="demo"]').addEventListener("click", loadDemo);

document.querySelectorAll("[data-review-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    state.reviewTab = button.dataset.reviewTab;
    document.querySelectorAll("[data-review-tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab === button));
    });
    renderReviewTab();
  });
});

document.querySelectorAll("[data-action='clear']").forEach((button) => {
  button.addEventListener("click", () => elements.clearDialog.showModal());
});
elements.clearDialog.addEventListener("close", () => {
  if (elements.clearDialog.returnValue === "clear") resetSession();
});

document.querySelector('[data-export="report"]').addEventListener("click", exportReport);
document.querySelector('[data-export="json"]').addEventListener("click", exportJson);
document.querySelector('[data-export="csv"]').addEventListener("click", exportCsv);

updateFileList();
renderReferenceData();
renderRateLookup();
renderReview();
selectStep("import");
