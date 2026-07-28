import {
  buildReviewModel,
  makeDemoReview,
  parseIbkrStatements,
} from "./lib/ibkr.js";
import { buildTaxSummary } from "./lib/tax-summary.js";
import { csvCell } from "./lib/export.js";
import {
  enrichReviewWithReferenceData,
  parseSbiReferenceRatesCsv,
  parseSecCompanyTickersExchange,
} from "./lib/reference-data.js";
import {
  BUNDLED_SBI_USD_CSV,
  BUNDLED_SEC_COMPANY_JSON,
} from "./lib/reference-data.generated.js";

function blockFramedUse() {
  if (window.top === window.self) {
    return false;
  }

  document.body.replaceChildren();
  const warning = document.createElement("main");
  warning.className = "frame-block";
  const heading = document.createElement("h1");
  heading.textContent = "Open this tax workspace directly";
  const message = document.createElement("p");
  message.textContent =
    "OpenTax Ledger will not process financial files while embedded inside another website.";
  warning.append(heading, message);
  document.body.append(warning);
  return true;
}

if (blockFramedUse()) {
  await new Promise(() => {});
}

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
  parsed: null,
  baseReview: null,
  review: null,
  reviewConfirmed: false,
  reviewTab: "overview",
  sourceKind: null,
  rateSourceKind: "bundled-community",
  usdTtBuyRates: BUNDLED_USD_TT_BUY_RATES,
};

const MAX_FILE_COUNT = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 200;
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
  configConversionSummary: document.querySelector("[data-config-conversion-summary]"),
  rateFileInput: document.querySelector("[data-rate-file-input]"),
  rateStatus: document.querySelector("[data-rate-status]"),
  rateSummary: document.querySelector("[data-rate-summary]"),
  rateTableBody: document.querySelector("[data-rate-table-body]"),
  reviewContent: document.querySelector("[data-review-content]"),
  reviewHeadline: document.querySelector("[data-review-headline]"),
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

function currentAssessmentYear() {
  return getConfig().assessmentYear || "2026-27";
}

function rebuildReviewFromBase() {
  if (state.parsed) {
    state.baseReview = buildReviewModel(state.parsed, {
      assessmentYear: currentAssessmentYear(),
    });
  } else if (state.sourceKind === "demo") {
    state.baseReview = makeDemoReview({
      assessmentYear: currentAssessmentYear(),
    });
  }
  state.review = state.baseReview ? withReferenceData(state.baseReview) : null;
  invalidateReviewConfirmation();
  renderReview();
}

function selectStep(step) {
  if (!stepOrder.includes(step)) return;
  if (step === "export" && !state.review) {
    showToast("Load statements or the synthetic demo before exporting.");
    step = "import";
  } else if (step === "export" && !state.reviewConfirmed) {
    setReviewTab("overview");
    state.currentStep = "review";
    showToast("Review the converted schedules before downloading.");
    step = "review";
  }
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

function focusWorkspaceStep(step) {
  const workspace = document.querySelector("#workspace");
  if (!workspace) return;

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#workspace`,
  );
  workspace.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
  document.querySelector(`[data-step-target="${step}"]`)?.focus({ preventScroll: true });
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

function invalidateReviewConfirmation() {
  state.reviewConfirmed = false;
}

function setReviewTab(tabName) {
  const tabs = [...document.querySelectorAll("[data-review-tab]")];
  const requestedTab = tabs.find((tab) => tab.dataset.reviewTab === tabName);
  const selectedTab = requestedTab ?? tabs.find((tab) => tab.dataset.reviewTab === "overview");
  if (!selectedTab) return;

  state.reviewTab = selectedTab.dataset.reviewTab;
  tabs.forEach((tab) => {
    const selected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  elements.reviewContent?.setAttribute("aria-labelledby", selectedTab.id);
}

function discardParsedReviewForFileChange() {
  state.parsed = null;
  state.baseReview = null;
  state.review = null;
  state.sourceKind = null;
  invalidateReviewConfirmation();
  setReviewTab("overview");
  renderReview();
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
    invalidateReviewConfirmation();
    if (state.baseReview || state.parsed) {
      rebuildReviewFromBase();
    }
    renderReferenceData();
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
      discardParsedReviewForFileChange();
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
  const initialFileCount = state.files.length;
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

  if (state.files.length !== initialFileCount) {
    discardParsedReviewForFileChange();
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
    state.parsed = parsed;
    state.sourceKind = "user";
    rebuildReviewFromBase();
    setReviewTab("overview");
    renderReview();
    setImportStatus(
      `Parsed ${state.review.summary.trades} trades, ${state.review.summary.dividends} dividends, and ${state.review.summary.positions} positions.`,
      "success",
    );
    selectStep("configure");
  } catch (error) {
    state.parsed = null;
    state.baseReview = null;
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
  state.parsed = null;
  state.baseReview = makeDemoReview({
    assessmentYear: currentAssessmentYear(),
  });
  state.review = withReferenceData(state.baseReview);
  state.sourceKind = "demo";
  state.files = [];
  invalidateReviewConfirmation();
  setReviewTab("overview");
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

function parseTaxRate(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw > 1 ? raw / 100 : raw;
}

function getTaxSummary() {
  if (!state.review) return null;
  const config = getConfig();
  return buildTaxSummary(state.review, {
    marginalTaxRate: parseTaxRate(config.marginalTaxRate),
    dtaaSection: config.dtaaSection || "90",
  });
}

function humanizeKey(key) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function renderTable(rows, columns, options = {}) {
  if (!rows?.length) {
    return '<div class="empty-review">No source rows were mapped to this working table.</div>';
  }

  const visibleRows = options.limit === false ? rows : rows.slice(0, options.limit ?? 50);
  const header = columns
    .map(({ label }) => `<th scope="col">${escapeHtml(label)}</th>`)
    .join("");
  const body = visibleRows
    .map((row) => {
      const cells = columns
        .map(({ key, format, value: getValue, linkLabel, links: getLinks }) => {
          const rawValue = getValue ? getValue(row) : row[key];
          if (getLinks) {
            const links = (getLinks(row) ?? [])
              .map(({ url, label }) => ({
                href: safeExternalUrl(url),
                label: String(label ?? "View source"),
              }))
              .filter(({ href }) => href);
            return links.length
              ? `<td>${links
                  .map(
                    ({ href, label }) =>
                      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
                  )
                  .join("<br>")}</td>`
              : "<td>Unavailable</td>";
          }
          if (linkLabel) {
            const href = safeExternalUrl(rawValue);
            return href
              ? `<td><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a></td>`
              : "<td>Unavailable</td>";
          }
          const value = format === "number" ? formatNumber(rawValue) : rawValue;
          return `<td>${escapeHtml(value === true ? "Rate needed" : value === false ? "Ready" : value)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table class="data-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderPreviewTable(rows, columns) {
  const hiddenRows = Math.max((rows?.length ?? 0) - MAX_PREVIEW_ROWS, 0);
  return `${renderTable(rows, columns, { limit: MAX_PREVIEW_ROWS })}${
    hiddenRows > 0
      ? `<p class="muted preview-limit-note">Showing the first ${MAX_PREVIEW_ROWS} rows; ${escapeHtml(hiddenRows)} more remain in the downloadable exports.</p>`
      : ""
  }`;
}

function formatConversionObservations(observations = []) {
  return (Array.isArray(observations) ? observations : [])
    .map((observation) => {
      const timestamp = String(observation.timestamp ?? "Unknown time");
      const rate = Number.isFinite(Number(observation.rate))
        ? formatNumber(observation.rate)
        : "Unknown rate";
      return `${timestamp}: ${rate}`;
    })
    .join("; ");
}

function conversionSelectionLabel(conversion = {}) {
  if (conversion.status === "not-required") return "Not required";
  if (conversion.selection === "prior-observation") {
    return `${conversion.observationDate || "Prior observation"}${
      Number.isFinite(Number(conversion.daysPrior))
        ? ` · ${conversion.daysPrior} day(s) before`
        : ""
    }`;
  }
  if (conversion.selection === "exact") return "Exact date";
  return "No usable observation";
}

function conversionEvidenceUrls(conversion = {}) {
  return [
    conversion.sourceUrl,
    ...(Array.isArray(conversion.observations) ? conversion.observations : []).map(
      (observation) => observation.sourceUrl,
    ),
  ]
    .map((value) => String(value ?? "").trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function conversionFor(row) {
  return row?.conversion ?? {};
}

function conversionStatus(row) {
  const conversion = conversionFor(row);
  return conversion.status || (row?.needsFx ? "missing" : "not-required");
}

function conversionStatusLabel(row) {
  return humanizeKey(conversionStatus(row));
}

function conversionSpecifiedDate(row) {
  return conversionFor(row).specifiedDate || conversionFor(row).eventDate || row?.date || "—";
}

function conversionFcy(row, fallbackKey) {
  const amount = conversionFor(row).amountForeign;
  return Number.isFinite(Number(amount)) ? amount : row?.[fallbackKey];
}

function conversionInr(row) {
  const amount = conversionFor(row).amountInr;
  return Number.isFinite(Number(amount)) ? amount : "";
}

function allConversionRows() {
  const schedules = state.review?.schedules ?? {};
  return [
    ...(schedules.capitalGains ?? []).map((row) => ({ ...row, schedule: "Capital gains" })),
    ...(schedules.fsi ?? []).map((row) => ({ ...row, schedule: "FSI" })),
    ...(schedules.tr ?? []).map((row) => ({ ...row, schedule: "TR" })),
  ];
}

function conversionLedgerRows() {
  const ledger = new Map();
  for (const row of allConversionRows()) {
    const conversion = conversionFor(row);
    const specifiedDate = conversion.specifiedDate || conversion.eventDate || row.date || "";
    const status = conversion.status || (row.needsFx ? "missing" : "not-required");
    const sourceUrl = conversion.sourceUrl || "";
    const evidenceUrls = conversionEvidenceUrls(conversion);
    const key = [
      row.schedule,
      conversion.category || "",
      specifiedDate,
      status,
      conversion.rate ?? "",
      sourceUrl,
    ].join("\u0000");
    const current = ledger.get(key) ?? {
      schedule: row.schedule,
      category: conversion.category || row.incomeType || row.assetCategory || "—",
      eventDate: conversion.eventDate || row.date || "—",
      specifiedDate: specifiedDate || "—",
      dateRule: conversion.dateRule || "Statutory date retained; source observation documented",
      status,
      rate: conversion.rate ?? "",
      sourceUrl,
      fcyRows: 0,
      amountForeign: 0,
      amountInr: 0,
      observationCount: conversion.observations?.length ?? 0,
      observation: conversionSelectionLabel(conversion),
      candidateObservations: formatConversionObservations(conversion.observations),
      evidenceUrls: evidenceUrls.join("\n"),
      classificationReview: conversion.classificationReview || "",
    };
    current.fcyRows += 1;
    current.amountForeign += Number(conversion.amountForeign ?? 0);
    current.amountInr += Number(conversion.amountInr ?? 0);
    ledger.set(key, current);
  }
  return [...ledger.values()].sort(
    (left, right) =>
      String(left.specifiedDate).localeCompare(String(right.specifiedDate)) ||
      String(left.schedule).localeCompare(String(right.schedule)) ||
      String(left.category).localeCompare(String(right.category)),
  );
}

function fallbackConversionSummary() {
  const rows = allConversionRows();
  const totalsInr = {
    capitalGains: 0,
    dividends: 0,
    interest: 0,
    foreignTax: 0,
  };
  const completeness = {
    capitalGains: { total: 0, converted: 0, verified: 0, priorObservation: 0 },
    dividends: { total: 0, converted: 0, verified: 0, priorObservation: 0 },
    interest: { total: 0, converted: 0, verified: 0, priorObservation: 0 },
    foreignTax: { total: 0, converted: 0, verified: 0, priorObservation: 0 },
  };
  const summary = {
    total: rows.length,
    matched: 0,
    missing: 0,
    ambiguous: 0,
    unsupported: 0,
    notRequired: 0,
    dates: conversionLedgerRows().length,
    totalsInr,
    completeness,
  };

  for (const row of rows) {
    const status = conversionStatus(row);
    const statusKey =
      status === "not-required"
        ? "notRequired"
        : ["invalid-date", "unsupported-currency"].includes(status)
          ? "unsupported"
          : status;
    summary[statusKey] = Number(summary[statusKey] ?? 0) + 1;
    const conversion = conversionFor(row);
    const amountInr = Number(conversion.amountInr ?? 0);
    let bucket = "capitalGains";
    if (row.schedule === "TR") {
      bucket = "foreignTax";
    } else if (row.incomeType === "interest") {
      bucket = "interest";
    } else if (row.incomeType === "dividend") {
      bucket = "dividends";
    }
    totalsInr[bucket] += amountInr;
    completeness[bucket].total += 1;
    if (status === "matched" || status === "not-required") {
      completeness[bucket].converted += 1;
      if (status === "not-required" || conversion.selection === "exact") {
        completeness[bucket].verified += 1;
      } else if (conversion.selection === "prior-observation") {
        completeness[bucket].priorObservation += 1;
      }
    }
  }
  return summary;
}

function getConversionSummary() {
  return state.review?.conversionSummary ?? fallbackConversionSummary();
}

function convertedInrMetric(conversionSummary, key) {
  const completeness = conversionSummary.completeness?.[key] ?? {
    total: 0,
    converted: 0,
    verified: 0,
    priorObservation: 0,
  };
  if (!completeness.total) {
    return {
      value: "₹0",
      note: "No mapped rows",
      complete: true,
      computed: true,
      empty: true,
    };
  }
  if (completeness.converted !== completeness.total) {
    return {
      value: "Rate needed",
      note: `${completeness.converted}/${completeness.total} rows converted`,
      complete: false,
      computed: false,
      empty: false,
    };
  }
  const verified = completeness.verified ?? completeness.converted;
  const priorObservation = completeness.priorObservation ?? 0;
  return {
    value: `₹${formatNumber(conversionSummary.totalsInr?.[key] ?? 0)}`,
    note: priorObservation
      ? `${completeness.converted}/${completeness.total} computed · ${priorObservation} prior-observation row${priorObservation === 1 ? "" : "s"} to verify`
      : `${verified}/${completeness.total} source-date rows verified`,
    complete: verified === completeness.total,
    computed: true,
    empty: false,
  };
}

function sourceHoldingsMetric(schedules) {
  const holdings = schedules?.holdings ?? [];
  const summary = state.review?.faConversionSummary?.holdings;
  if (holdings.length === 0) {
    return {
      value: "₹0",
      note: "No mapped positions",
      complete: true,
      computed: true,
    };
  }

  const currencies = [
    ...new Set(
      holdings
        .map((holding) => String(holding.currency ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (summary?.total && summary.converted === summary.total) {
    const verified = summary.verified ?? summary.converted;
    const priorObservation = summary.priorObservation ?? 0;
    return {
      value: `₹${formatNumber(summary.amountInr ?? 0)}`,
      note: priorObservation
        ? `${summary.converted}/${summary.total} computed · ${priorObservation} prior-observation row${priorObservation === 1 ? "" : "s"} to verify`
        : `${verified}/${summary.total} latest holding rows verified`,
      complete: verified === summary.total,
      computed: true,
    };
  }
  if (currencies.length !== 1) {
    return {
      value: `${holdings.length} positions`,
      note: "Mixed currencies · latest holding snapshot review",
      complete: false,
      computed: false,
    };
  }

  const total = holdings.reduce(
    (sum, holding) => {
      const value = Number(holding.value);
      return sum + (Number.isFinite(value) ? value : 0);
    },
    0,
  );
  const [currency] = currencies;
  return {
    value: currency === "INR" ? `₹${formatNumber(total)}` : `${currency} ${formatNumber(total)}`,
    note:
      currency === "INR"
        ? "Latest source holding snapshot"
        : `${summary?.converted ?? 0}/${summary?.total ?? holdings.length} latest holding rows converted`,
    complete: currency === "INR",
    computed: currency === "INR",
  };
}

function renderHeadlineCard({ label, value, note, warning = false, status = "" }) {
  const stateLabel = status || (warning ? "Review" : "Ready");
  return `
    <div class="headline-metric${warning ? " is-review" : ""}">
      <div class="headline-metric-top">
        <small>${escapeHtml(label)}</small>
        <span class="headline-state">${escapeHtml(stateLabel)}</span>
      </div>
      <strong>${escapeHtml(value)}</strong>
      <span class="headline-note">${escapeHtml(note)}</span>
    </div>`;
}

function renderReviewHeadline() {
  if (!elements.reviewHeadline) return;
  if (!state.review) {
    elements.reviewHeadline.innerHTML = [
      ["STCG", "—", "Load a statement to review"],
      ["LTCG", "—", "Load a statement to review"],
      ["Dividends", "—", "Exact-date INR preview"],
      ["Interest", "—", "Exact-date INR preview"],
      ["Foreign tax paid", "—", "Rule 128 conversion preview"],
      ["FTC candidate", "—", "Tax summary relief placeholder"],
      ["Holdings", "—", "Source closing value"],
    ]
      .map(([label, value, note]) =>
        renderHeadlineCard({ label, value, note, status: "Waiting" }),
      )
      .join("");
    return;
  }

  const schedules = state.review.schedules ?? {};
  const conversionSummary = getConversionSummary();
  const taxSummary = getTaxSummary();
  const capitalGains = convertedInrMetric(conversionSummary, "capitalGains");
  const dividends = convertedInrMetric(conversionSummary, "dividends");
  const interest = convertedInrMetric(conversionSummary, "interest");
  const foreignTax = convertedInrMetric(conversionSummary, "foreignTax");
  const holdings = sourceHoldingsMetric(schedules);
  const hasCapitalGainRows = (schedules.capitalGains?.length ?? 0) > 0;
  const capitalGainNote = hasCapitalGainRows
    ? capitalGains.computed
      ? capitalGains.complete
        ? "Computed FIFO gain converted at the transfer Rule 115 date"
        : `Computed FIFO gain shown · ${capitalGains.note}`
      : "Computed FIFO gain needs a usable prescribed-date observation"
    : "No disposal rows";
  const taxSummaryComplete = taxSummary?.coverage?.complete ?? false;
  const taxSummaryEvidenceReady = taxSummary?.coverage?.evidenceReady ?? false;
  const stcgTotal = taxSummary?.totals?.stcg ?? 0;
  const ltcgTotal = taxSummary?.totals?.ltcg ?? 0;

  elements.reviewHeadline.innerHTML = [
    {
      label: "STCG",
      value: hasCapitalGainRows
        ? capitalGains.computed
          ? `₹${formatNumber(stcgTotal)}`
          : "Rate needed"
        : "₹0",
      note: capitalGainNote,
      warning: hasCapitalGainRows && !capitalGains.complete,
    },
    {
      label: "LTCG",
      value: hasCapitalGainRows
        ? capitalGains.computed
          ? `₹${formatNumber(ltcgTotal)}`
          : "Rate needed"
        : "₹0",
      note: hasCapitalGainRows
        ? capitalGains.computed
          ? capitalGains.complete
            ? "Holding-period buckets are inferred by FIFO."
            : `Holding-period bucket shown · ${capitalGains.note}`
          : "Bucketed gains require a usable prescribed-date observation"
        : "No disposal rows",
      warning: hasCapitalGainRows && !capitalGains.complete,
    },
    {
      label: "Dividends",
      ...dividends,
      warning: !dividends.complete,
    },
    {
      label: "Interest",
      ...interest,
      warning: !interest.complete,
    },
    {
      label: "Foreign tax paid",
      ...foreignTax,
      warning: !foreignTax.complete,
    },
    {
      label: "FTC candidate",
      value: foreignTax.empty
        ? "₹0"
        : taxSummaryComplete
          ? `₹${formatNumber(taxSummary?.totals?.relief ?? 0)}`
          : "Review",
      note: taxSummaryComplete
        ? taxSummaryEvidenceReady
          ? `Tax summary by country · ${taxSummary?.unclassifiedRows ? `${taxSummary.unclassifiedRows} unclassified row(s)` : "ready for review"}`
          : `${taxSummary?.coverage?.priorObservationRows ?? 0} prior-observation row(s) require primary SBI evidence`
        : `${taxSummary?.coverage?.convertedRows ?? 0}/${taxSummary?.coverage?.totalRows ?? 0} tax-summary rows converted`,
      warning:
        !taxSummaryComplete ||
        !taxSummaryEvidenceReady ||
        (taxSummary?.totals?.relief ?? 0) > 0,
    },
    {
      label: "Holdings",
      ...holdings,
      warning: !holdings.complete,
    },
  ]
    .map(renderHeadlineCard)
    .join("");
}

function renderAuditCountGrid(items, label) {
  return `
    <div class="audit-count-grid" aria-label="${escapeHtml(label)}">
      ${items
        .map(
          ({ label: itemLabel, value, note = "" }) => `
            <div class="audit-count-item">
              <span>${escapeHtml(itemLabel)}</span>
              <strong>${escapeHtml(formatNumber(value))}</strong>
              ${note ? `<small>${escapeHtml(note)}</small>` : ""}
            </div>`,
        )
        .join("")}
    </div>`;
}

function auditSeverityCounts(validations = []) {
  const counts = { error: 0, warning: 0, info: 0 };
  validations.forEach((validation) => {
    const severity = ["error", "warning", "info"].includes(validation.severity)
      ? validation.severity
      : "info";
    counts[severity] += 1;
  });
  return counts;
}

function renderAuditTab() {
  const review = state.review;
  if (!review) {
    return '<div class="empty-review">Load a statement or the synthetic demo to inspect its audit trail.</div>';
  }

  const summary = review.summary ?? {};
  const schedules = review.schedules ?? {};
  const validations = review.validations ?? [];
  const conversionSummary = getConversionSummary();
  const severity = auditSeverityCounts(validations);
  const config = getConfig();
  const rateReference = review.referenceData?.usdTtBuyRates ?? {};
  const companyReference = review.referenceData?.companyLookup ?? {};
  const fifoAudit = review.stats?.fifo ?? {};
  const sourceItems = [
    { label: "Files", value: summary.files ?? 0, note: "Names hidden here" },
    { label: "Data rows received", value: summary.dataRowsReceived ?? 0 },
    {
      label: "Accepted data rows",
      value: summary.dataRowsAccepted ?? 0,
      note: "After exact duplicate suppression",
    },
    { label: "Statement sections", value: summary.sections ?? 0 },
    { label: "Trades", value: summary.trades ?? 0 },
    { label: "Buy trades", value: summary.buyTrades ?? 0 },
    { label: "Disposal trades", value: summary.saleTrades ?? 0 },
    { label: "Instruments", value: summary.instruments ?? 0 },
    {
      label: "Dividends",
      value: summary.dividends ?? 0,
      note:
        Number(summary.rawDividends ?? 0) > Number(summary.dividends ?? 0)
          ? `${formatNumber((summary.rawDividends ?? 0) - (summary.dividends ?? 0))} summary/invalid rows excluded`
          : `${formatNumber(summary.rawDividends ?? summary.dividends ?? 0)} raw rows`,
    },
    {
      label: "WHT rows",
      value: summary.withholding ?? 0,
      note:
        Number(summary.rawWithholding ?? 0) > Number(summary.withholding ?? 0)
          ? `${formatNumber((summary.rawWithholding ?? 0) - (summary.withholding ?? 0))} summary/reversal rows excluded`
          : `${formatNumber(summary.rawWithholding ?? summary.withholding ?? 0)} raw rows`,
    },
    { label: "Interest", value: summary.interest ?? 0 },
    {
      label: "Positions",
      value: summary.positions ?? 0,
      note:
        Number(summary.rawPositions ?? 0) > Number(summary.positions ?? 0)
          ? `${formatNumber(summary.rawPositions)} raw snapshots · latest statement selected`
          : "Latest holding snapshot",
    },
    { label: "Security transfers", value: summary.transfers ?? 0 },
    { label: "Cash movements", value: summary.cashMovements ?? 0 },
    {
      label: "Duplicates suppressed",
      value: summary.duplicateRowsSuppressed ?? 0,
    },
  ];
  const outputItems = [
    { label: "Capital gains rows", value: schedules.capitalGains?.length ?? 0 },
    { label: "FSI rows", value: schedules.fsi?.length ?? 0 },
    { label: "TR rows", value: schedules.tr?.length ?? 0 },
    { label: "FA entities", value: summary.faEntities ?? schedules.fa?.length ?? 0 },
    { label: "Latest holdings", value: schedules.holdings?.length ?? summary.positions ?? 0 },
    { label: "Conversion rows", value: conversionSummary.total ?? 0 },
    { label: "Date buckets", value: conversionSummary.dateBucketCount ?? conversionSummary.dates ?? 0 },
    {
      label: "Distinct statutory dates",
      value: conversionSummary.distinctSpecifiedDateCount ?? conversionSummary.dates ?? 0,
    },
    { label: "Matched conversion rows", value: conversionSummary.matched ?? 0 },
    { label: "Automated checks", value: validations.length },
  ];
  const reconciliationRows = [
    {
      paper: "Capital gains",
      source: summary.saleTrades ?? 0,
      output: schedules.capitalGains?.length ?? 0,
      note: "One draft row per FIFO lot segment from disposal matching.",
      status:
        Number(fifoAudit.unmatchedQuantity ?? 0) > 0
          ? "Review"
          : Number(schedules.capitalGains?.length ?? 0) >
              Number(summary.saleTrades ?? 0)
            ? "Expected FIFO split"
            : Number(schedules.capitalGains?.length ?? 0) ===
                Number(summary.saleTrades ?? 0)
              ? "Reconciled"
              : "Review",
    },
    {
      paper: "FSI",
      source: (summary.dividends ?? 0) + (summary.interest ?? 0),
      output: schedules.fsi?.length ?? 0,
      note: "Dividend and interest source rows.",
    },
    {
      paper: "TR",
      source: summary.withholding ?? 0,
      output: schedules.tr?.length ?? 0,
      note: "Negative foreign withholding rows only; positive reversals are excluded from tax paid.",
    },
    {
      paper: "Schedule FA",
      source: summary.faEntities ?? 0,
      output: schedules.fa?.length ?? 0,
      note: "One row per calendar-year security entity; latest holdings remain separate.",
    },
  ];
  const validationList = validations.length
    ? `<ul class="audit-validation-list">
        ${validations
          .slice(0, 8)
          .map((validation) => {
            const severityName = ["error", "warning", "info"].includes(validation.severity)
              ? validation.severity
              : "info";
            return `
              <li>
                <span class="audit-severity is-${severityName}">${severityName}</span>
                <strong>${escapeHtml(validation.code)}</strong>
                <span>${escapeHtml(validation.message)}</span>
              </li>`;
          })
          .join("")}
      </ul>`
    : '<p class="audit-empty-note">No automated findings. Professional review is still required.</p>';
  const sourceLabel =
    state.sourceKind === "demo" ? "Synthetic fixture" : "User-selected local statements";
  const methodology = [
    {
      label: "Rule 115",
      text: "Supported categories use their prescribed Rule 115 / Rule 128 dates. The statutory date is retained; if that calendar date is missing, latest on-or-before observations are flagged in the evidence ledger.",
    },
    {
      label: "Rule 128",
      text: "Foreign tax conversion uses the last calendar day of the month preceding the mapped tax paid/deducted date. FTC eligibility is not decided.",
    },
    {
      label: "Capital gains",
      text: "FIFO lot matching is applied. The gain amount is converted at the transfer-date Rule 115 rate; it is not recomputed by converting buy and sell legs separately.",
    },
    {
      label: "FSI",
      text: "Dividend and interest rows become draft FSI rows. IBKR cash interest defaults to other-source interest and remains flagged for classification review.",
    },
    {
      label: "Schedule FA",
      text: "Calendar-year position/trade/dividend evidence becomes one FA row per entity. Latest holding snapshots are selected separately for the holdings headline.",
    },
    {
      label: "Company matching",
      text: "Offline SEC ticker associations add names and exchanges only; they do not establish issuer residence or treaty treatment.",
    },
    {
      label: "TTBR evidence",
      text: "The bundled community SBI archive or a local override supplies draft USD matches. Retain primary SBI evidence for material dates.",
    },
    {
      label: "Privacy",
      text: "Imported statements stay in this browser session. The audit view omits taxpayer identifiers and file names.",
    },
  ];

  return `
    <section class="audit-tab-panel" aria-labelledby="audit-tab-title">
      <div class="audit-note">
        <span class="audit-note-mark" aria-hidden="true">i</span>
        <div>
          <h4 id="audit-tab-title">Audit trail</h4>
          <p>Source counts, generated working-paper counts, and method assumptions for this browser session. Reconcile parser coverage before relying on downloads.</p>
        </div>
      </div>

      <section class="audit-section-card" aria-labelledby="audit-source-title">
        <div class="audit-section-heading">
          <div>
            <span>Source data</span>
            <h5 id="audit-source-title">What the parser accepted</h5>
          </div>
          <small>Counts include all recognized statement sections.</small>
        </div>
        ${renderAuditCountGrid(sourceItems, "Source data counts")}
      </section>

      <section class="audit-section-card" aria-labelledby="audit-output-title">
        <div class="audit-section-heading">
          <div>
            <span>Generated working papers</span>
            <h5 id="audit-output-title">What the app produced</h5>
          </div>
          <small>Draft rows only; not an ITR submission.</small>
        </div>
        ${renderAuditCountGrid(outputItems, "Generated working-paper counts")}
      </section>

      <section class="audit-section-card" aria-labelledby="audit-reconciliation-title">
        <div class="audit-section-heading">
          <div>
            <span>Reconciliation</span>
            <h5 id="audit-reconciliation-title">Source-to-output row checks</h5>
          </div>
        </div>
        <div class="audit-table-wrap">
          <table class="audit-reconciliation-table">
            <thead>
              <tr>
                <th scope="col">Working paper</th>
                <th scope="col">Source rows</th>
                <th scope="col">Output rows</th>
                <th scope="col">Status</th>
                <th scope="col">Method note</th>
              </tr>
            </thead>
            <tbody>
              ${reconciliationRows
                .map((row) => {
                  const status =
                    row.status ??
                    (Number(row.source) === Number(row.output)
                      ? "Reconciled"
                      : "Review");
                  const reconciled = status !== "Review";
                  return `
                    <tr>
                      <th scope="row">${escapeHtml(row.paper)}</th>
                      <td>${escapeHtml(formatNumber(row.source))}</td>
                      <td>${escapeHtml(formatNumber(row.output))}</td>
                      <td><span class="audit-status${reconciled ? " is-ready" : " is-review"}">${escapeHtml(status)}</span></td>
                      <td>${escapeHtml(row.note)}</td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="audit-section-card" aria-labelledby="audit-validation-title">
        <div class="audit-section-heading">
          <div>
            <span>Validation snapshot</span>
            <h5 id="audit-validation-title">Automated findings</h5>
          </div>
        </div>
        ${renderAuditCountGrid(
          [
            { label: "Errors", value: severity.error },
            { label: "Warnings", value: severity.warning },
            { label: "Information", value: severity.info },
          ],
          "Validation severity counts",
        )}
        ${validationList}
      </section>

      <details class="audit-section-card audit-disclosure">
        <summary>
          <span>
            <small>Methodology summary</small>
            <strong id="audit-method-title">Rules and deliberate boundaries</strong>
          </span>
          <span class="audit-disclosure-action">
            <span class="when-closed">Show 8 rules</span>
            <span class="when-open">Hide rules</span>
          </span>
        </summary>
        <dl class="audit-method-list" aria-labelledby="audit-method-title">
          ${methodology
            .map(
              (item) => `
                <div>
                  <dt>${escapeHtml(item.label)}</dt>
                  <dd>${escapeHtml(item.text)}</dd>
                </div>`,
            )
            .join("")}
        </dl>
      </details>

      <details class="audit-section-card audit-disclosure">
        <summary>
          <span>
            <small>Session assumptions</small>
            <strong id="audit-assumption-title">Configuration and provenance</strong>
          </span>
          <span class="audit-disclosure-action">
            <span class="when-closed">Show session details</span>
            <span class="when-open">Hide session details</span>
          </span>
        </summary>
        <dl class="audit-assumption-grid" aria-labelledby="audit-assumption-title">
          <div><dt>Source session</dt><dd>${escapeHtml(sourceLabel)}</dd></div>
          <div><dt>Assessment year</dt><dd>AY ${escapeHtml(config.assessmentYear)}</dd></div>
          <div><dt>Residential status</dt><dd>${escapeHtml(config.residentialStatus)}</dd></div>
          <div><dt>Return assumption</dt><dd>${escapeHtml(config.returnForm)}</dd></div>
          <div><dt>Broker base currency</dt><dd>${escapeHtml(config.baseCurrency)}</dd></div>
          <div><dt>TTBR source</dt><dd>${escapeHtml(rateReference.provider ?? "—")} · ${escapeHtml(formatNumber(rateReference.records ?? 0))} rows</dd></div>
          <div><dt>Company source</dt><dd>${escapeHtml(companyReference.provider ?? "—")} · ${escapeHtml(formatNumber(companyReference.records ?? 0))} records</dd></div>
          <div><dt>Conversion coverage</dt><dd>${escapeHtml(formatNumber(conversionSummary.matched ?? 0))}/${escapeHtml(formatNumber(conversionSummary.total ?? 0))} matched rows · ${escapeHtml(formatNumber(conversionSummary.dateBucketCount ?? conversionSummary.dates ?? 0))} date buckets · ${escapeHtml(formatNumber(conversionSummary.distinctSpecifiedDateCount ?? 0))} distinct statutory dates</dd></div>
        </dl>
      </details>
    </section>`;
}

function renderConfigureConversionSummary() {
  if (!elements.configConversionSummary) return;
  const result = elements.configConversionSummary.querySelector(".rate-result");
  if (!result) return;
  if (!state.review) {
    result.innerHTML = "Load a statement or the synthetic demo to see required conversion dates.";
    return;
  }

  const summary = getConversionSummary();
  const ledger = conversionLedgerRows();
  result.innerHTML = `
    <div class="conversion-mini-grid" aria-label="Conversion coverage">
      <span><strong>${escapeHtml(String(summary.dates ?? ledger.length))}</strong> prescribed dates</span>
      <span><strong>${escapeHtml(String(summary.distinctSpecifiedDateCount ?? 0))}</strong> distinct statutory dates</span>
      <span><strong>${escapeHtml(String(summary.matched ?? 0))}</strong> matched rows</span>
      <span><strong>${escapeHtml(String(summary.missing ?? 0))}</strong> missing</span>
      <span><strong>${escapeHtml(String(summary.ambiguous ?? 0))}</strong> ambiguous</span>
    </div>
    ${renderPreviewTable(ledger, [
      { key: "schedule", label: "Schedule" },
      { key: "category", label: "Category" },
      { key: "specifiedDate", label: "Specified date" },
      { key: "dateRule", label: "Date rule" },
      { key: "status", label: "TTBR status" },
      { key: "observation", label: "Observation used" },
      { key: "rate", label: "TTBR", format: "number" },
      { key: "amountInr", label: "INR total", format: "number" },
      { key: "candidateObservations", label: "Conflicting candidates" },
    ])}`;
}

function renderReviewTab() {
  if (!state.review) {
    elements.reviewContent.innerHTML =
      '<div class="empty-review">Load a statement or the synthetic demo to preview review tables.</div>';
    return;
  }

  const { schedules } = state.review;
  const conversionSummary = getConversionSummary();
  if (state.reviewTab === "overview") {
    const capitalGains = convertedInrMetric(conversionSummary, "capitalGains");
    const dividends = convertedInrMetric(conversionSummary, "dividends");
    const interest = convertedInrMetric(conversionSummary, "interest");
    const foreignTax = convertedInrMetric(conversionSummary, "foreignTax");
    elements.reviewContent.innerHTML = `
      <div class="review-summary">
        <div class="summary-block">
          <small>Capital gains · INR review</small>
          <strong>${escapeHtml(capitalGains.value)}</strong>
          <span>${escapeHtml(capitalGains.note)} · gain is FIFO-computed, not separate buy/sell leg FX</span>
        </div>
        <div class="summary-block">
          <small>Dividends · INR review</small>
          <strong>${escapeHtml(dividends.value)}</strong>
          <span>${escapeHtml(dividends.note)}</span>
        </div>
        <div class="summary-block">
          <small>Interest · INR review</small>
          <strong>${escapeHtml(interest.value)}</strong>
          <span>${escapeHtml(interest.note)} · classification review</span>
        </div>
        <div class="summary-block">
          <small>Foreign tax · INR review</small>
          <strong>${escapeHtml(foreignTax.value)}</strong>
          <span>${escapeHtml(foreignTax.note)} · FTC summary shown below</span>
        </div>
        <div class="summary-block">
          <small>TTBR coverage</small>
          <strong>${escapeHtml(formatNumber(conversionSummary.matched ?? 0))}/${escapeHtml(formatNumber(conversionSummary.total ?? 0))}</strong>
          <span>matched rows · ${escapeHtml(formatNumber(conversionSummary.missing ?? 0))} missing · ${escapeHtml(formatNumber(conversionSummary.ambiguous ?? 0))} ambiguous</span>
        </div>
        <div class="summary-block">
          <small>Statutory dates</small>
          <strong>${escapeHtml(formatNumber(conversionSummary.distinctSpecifiedDateCount ?? 0))}</strong>
          <span>${escapeHtml(formatNumber(conversionSummary.dateBucketCount ?? conversionLedgerRows().length))} date buckets · prior observations shown explicitly</span>
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
      { key: "acquisitionDate", label: "Acq date" },
      { key: "holdingDays", label: "Holding days", format: "number" },
      { key: "gainBucket", label: "Bucket" },
      { key: "quantitySold", label: "Qty", format: "number" },
      { key: "proceeds", label: "Proceeds", format: "number" },
      { key: "costBasis", label: "IBKR basis", format: "number" },
      { key: "realizedProfitLoss", label: "IBKR P/L", format: "number" },
      { key: "gain", label: "Computed FIFO gain", format: "number" },
      { label: "Specified date", value: conversionSpecifiedDate },
      { label: "TTBR status", value: conversionStatusLabel },
      { label: "Rate", value: (row) => conversionFor(row).rate, format: "number" },
      { label: "FCY amount", value: (row) => conversionFcy(row, "proceeds"), format: "number" },
      { label: "INR amount", value: conversionInr, format: "number" },
    ]);
    return;
  }

  if (state.reviewTab === "fsi") {
    const taxSummary = getTaxSummary();
    const countrySummary = taxSummary?.rows?.length
      ? `
        <div class="reference-table-note">
          <strong>${taxSummary.coverage.complete ? "Country-wise FTC preview" : "Incomplete country-wise FTC preview"}</strong>
          <span>${taxSummary.coverage.complete
            ? taxSummary.coverage.evidenceReady
              ? "Relief is capped at the lower of foreign tax paid and preview Indian tax for each country."
              : `Arithmetic includes ${taxSummary.coverage.priorObservationRows} prior-observation row(s); verify primary SBI evidence before relying on the FTC preview.`
            : `${taxSummary.coverage.convertedRows}/${taxSummary.coverage.totalRows} rows converted; missing rows are excluded from the visible subtotals and the FTC figure remains Review.`}</span>
        </div>
        ${renderTable(taxSummary.rows, [
          { key: "country", label: "Country" },
          { key: "stcg", label: "STCG INR", format: "number" },
          { key: "ltcg", label: "LTCG INR", format: "number" },
          { key: "dividends", label: "Dividends INR", format: "number" },
          { key: "interest", label: "Interest INR", format: "number" },
          { key: "foreignTax", label: "Tax paid INR", format: "number" },
          { key: "indianTax", label: "Indian tax cap", format: "number" },
          { key: "relief", label: "FTC candidate", format: "number" },
          { key: "conversionComplete", label: "Conversion complete" },
          { key: "evidenceReady", label: "Evidence ready" },
          { key: "dtaaSection", label: "Section" },
          { key: "form67Required", label: "Form 67" },
        ], { limit: false })}`
      : '<div class="empty-review">No converted country-wise FTC summary is available yet.</div>';
    const income = schedules.fsi.map((row) => ({ ...row, workingPaper: "FSI" }));
    const relief = schedules.tr.map((row) => ({
      ...row,
      incomeType: "foreign tax",
      amount: row.taxPaid,
      workingPaper: "TR",
    }));
    elements.reviewContent.innerHTML = `${countrySummary}${renderTable([...income, ...relief], [
      { key: "workingPaper", label: "Paper" },
      { key: "incomeType", label: "Type" },
      { label: "Company", value: (row) => row.company?.name || "Unmatched" },
      { key: "date", label: "Date" },
      { key: "currency", label: "CCY" },
      { key: "description", label: "Source description" },
      { key: "amount", label: "Amount", format: "number" },
      { label: "Specified date", value: conversionSpecifiedDate },
      { label: "TTBR status", value: conversionStatusLabel },
      { label: "Rate", value: (row) => conversionFor(row).rate, format: "number" },
      { label: "FCY amount", value: (row) => conversionFcy(row, "amount"), format: "number" },
      { label: "INR amount", value: conversionInr, format: "number" },
    ])}`;
    return;
  }

  if (state.reviewTab === "ttbr") {
    const rows = conversionLedgerRows();
    elements.reviewContent.innerHTML = `
      <div class="reference-table-note">
        <strong>Rule 115 / TTBR prescribed-date ledger</strong>
        <span>Derived from schedule rows. Exact-date derivation is primary; prior-observation selections are explicitly shown.</span>
        <a href="./data/sbi-usd-tt-buy-community.csv" download>Download the complete CSV</a>
      </div>
      ${renderPreviewTable(rows, [
        { key: "schedule", label: "Schedule" },
        { key: "category", label: "Category" },
        { key: "eventDate", label: "Event date" },
        { key: "specifiedDate", label: "Specified date" },
        { key: "dateRule", label: "Date rule" },
        { key: "status", label: "TTBR status" },
        { key: "observation", label: "Observation used" },
        { key: "rate", label: "TTBR", format: "number" },
        { key: "fcyRows", label: "Rows", format: "number" },
        { key: "amountForeign", label: "FCY total", format: "number" },
        { key: "amountInr", label: "INR total", format: "number" },
        { key: "candidateObservations", label: "Conflicting candidates" },
        {
          label: "Evidence",
          links: (row) => {
            const urls = String(row.evidenceUrls ?? "").split("\n").filter(Boolean);
            return urls.map((url, index) => ({
              url,
              label: urls.length === 1 ? "View source" : `View candidate ${index + 1}`,
            }));
          },
        },
      ])}`;
    return;
  }

  if (state.reviewTab === "fa") {
    elements.reviewContent.innerHTML = renderTable(schedules.fa, [
      { key: "assetCategory", label: "Asset class" },
      { key: "symbol", label: "Symbol" },
      { label: "Company", value: (row) => row.company?.name || "Unmatched" },
      { label: "Exchange", value: (row) => row.company?.exchange || "—" },
      { key: "currency", label: "CCY" },
      { key: "closingQuantity", label: "Closing qty", format: "number" },
      { key: "acquisitionDate", label: "Acq date" },
      { key: "acquisitionStatus", label: "Acq status" },
      { key: "initialValue", label: "Initial value", format: "number" },
      { key: "initialValueInr", label: "Initial INR", format: "number" },
      { key: "peakDate", label: "Peak date" },
      { key: "peakValue", label: "Peak value", format: "number" },
      { key: "peakValueInr", label: "Peak INR", format: "number" },
      { key: "closingDate", label: "Closing date" },
      { key: "closingValue", label: "Closing value", format: "number" },
      { key: "closingValueInr", label: "Closing INR", format: "number" },
      { key: "closingStatus", label: "Closing status" },
      { key: "grossProceeds", label: "Gross proceeds", format: "number" },
      { key: "grossDividends", label: "Gross dividends", format: "number" },
      { key: "needsFx", label: "FX status" },
    ]);
    return;
  }

  if (state.reviewTab === "audit") {
    elements.reviewContent.innerHTML = renderAuditTab();
    return;
  }

  setReviewTab("overview");
  renderReviewTab();
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

  elements.auditFiles.textContent = String(summary.files);
  elements.auditRows.textContent = String(
    summary.dataRowsAccepted ??
      summary.trades +
        summary.positions +
        summary.dividends +
        (summary.withholding ?? 0) +
        (summary.interest ?? 0) +
        (summary.transfers ?? 0),
  );
  elements.reviewStamp.textContent = state.reviewConfirmed
    ? "Review checked"
    : validations.some((finding) => finding.severity === "error")
      ? "Blocked"
      : validations.length
        ? "Needs review"
        : "Draft ready";
  elements.reviewStamp.className = state.reviewConfirmed || !validations.length
    ? "stamp stamp-ready"
    : "stamp stamp-review";

  renderConfigureConversionSummary();
  renderReviewHeadline();
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
  if (!Array.isArray(rows)) {
    rows = rows && typeof rows === "object" ? [rows] : [];
  }
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
  const { company, conversion, ...rest } = row;
  const flattened = { ...rest };
  if (conversion) {
    for (const [key, value] of Object.entries(conversion)) {
      if (key === "observations") {
        flattened.conversionObservationCount = value?.length ?? 0;
        flattened.conversionCandidateObservations = formatConversionObservations(value);
        flattened.conversionEvidenceUrls = conversionEvidenceUrls(conversion).join("; ");
      } else {
        flattened[`conversion${key.replace(/^\w/, (letter) => letter.toUpperCase())}`] = value;
      }
    }
  }
  if (!company) return flattened;
  return {
    ...flattened,
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
  const conversionSummary = getConversionSummary();
  const taxSummary = getTaxSummary();

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
${reportTable("Computed tax summary (rows)", taxSummary?.rows ?? [])}
${reportTable("Computed tax summary totals", [{
  stcg: taxSummary?.totals?.stcg,
  ltcg: taxSummary?.totals?.ltcg,
  dividends: taxSummary?.totals?.dividends,
  interest: taxSummary?.totals?.interest,
  foreignTax: taxSummary?.totals?.foreignTax,
  foreignIncome: taxSummary?.totals?.foreignIncome,
  indianTax: taxSummary?.totals?.indianTax,
  relief: taxSummary?.totals?.relief,
  form67Required: taxSummary?.form67Required,
  dtaaSection: taxSummary?.rows?.[0]?.dtaaSection,
  unclassifiedRows: taxSummary?.unclassifiedRows,
  conversionRows: taxSummary?.coverage?.totalRows,
  convertedRows: taxSummary?.coverage?.convertedRows,
  missingConversionRows: taxSummary?.coverage?.missingRows,
  verifiedRows: taxSummary?.coverage?.verifiedRows,
  priorObservationRows: taxSummary?.coverage?.priorObservationRows,
  conversionComplete: taxSummary?.coverage?.complete,
  evidenceReady: taxSummary?.coverage?.evidenceReady,
}])}
${reportTable("Capital Gains working table", review.schedules.capitalGains.map(flattenCompany))}
${reportTable("Schedule FSI working table", review.schedules.fsi.map(flattenCompany))}
${reportTable("Schedule TR working table", review.schedules.tr.map(flattenCompany))}
${reportTable("Schedule FA working table", review.schedules.fa.map(flattenCompany))}
${reportTable("Latest holdings snapshot", (review.schedules.holdings ?? []).map(flattenCompany))}
${reportTable("Rule 115 / TTBR conversion summary", [
  {
    total: conversionSummary.total,
    matched: conversionSummary.matched,
    missing: conversionSummary.missing,
    ambiguous: conversionSummary.ambiguous,
    unsupported: conversionSummary.unsupported,
    notRequired: conversionSummary.notRequired,
    dateBuckets: conversionSummary.dateBucketCount ?? conversionSummary.dates,
    distinctStatutoryDates: conversionSummary.distinctSpecifiedDateCount,
    capitalGainsInr: conversionSummary.totalsInr?.capitalGains,
    dividendsInr: conversionSummary.totalsInr?.dividends,
    interestInr: conversionSummary.totalsInr?.interest,
    foreignTaxInr: conversionSummary.totalsInr?.foreignTax,
  },
])}
${reportTable("Schedule FA conversion summary", [review.faConversionSummary ?? {}])}
${reportTable("Rule 115 / TTBR prescribed-date ledger", conversionLedgerRows())}
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
  if (!ensureExportReady()) return;
  downloadBlob(
    "opentax-ledger-ca-review.html",
    "text/html;charset=utf-8",
    makeReport(),
  );
  showToast("CA review report downloaded locally.");
}

function exportJson() {
  if (!ensureExportReady()) return;
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
  const conversionSummary = getConversionSummary();
  const taxSummary = getTaxSummary();
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
          conversionSummary,
          faConversionSummary: state.review.faConversionSummary,
          taxSummary,
          conversionLedger: conversionLedgerRows(),
        },
      },
      null,
      2,
    ),
  );
  showToast("Audit JSON downloaded locally.");
}

function exportCsv() {
  if (!ensureExportReady()) return;

  const scheduleEntries = [
    ["Capital Gains", state.review.schedules.capitalGains.map(flattenCompany)],
    ["FSI", state.review.schedules.fsi.map(flattenCompany)],
    ["TR", state.review.schedules.tr.map(flattenCompany)],
    ["FA", state.review.schedules.fa.map(flattenCompany)],
    ["Latest Holdings", (state.review.schedules.holdings ?? []).map(flattenCompany)],
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
  state.parsed = null;
  state.baseReview = null;
  state.review = null;
  invalidateReviewConfirmation();
  state.sourceKind = null;
  state.rateSourceKind = "bundled-community";
  state.usdTtBuyRates = BUNDLED_USD_TT_BUY_RATES;
  elements.fileInput.value = "";
  elements.rateFileInput.value = "";
  setReviewTab("overview");
  updateFileList();
  renderReferenceData();
  setRateStatus("Using the bundled, pinned community USD reference table.");
  renderReview();
  selectStep("import");
  showToast("Local session cleared.");
}

function ensureExportReady() {
  if (!state.review) {
    showToast("Load statements or the synthetic demo before exporting.");
    selectStep("import");
    return false;
  }
  if (!state.reviewConfirmed) {
    selectStep("review");
    showToast("Review the converted schedules before downloading.");
    return false;
  }
  return true;
}

document.querySelectorAll("[data-step-target], [data-go-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const requestedStep = button.dataset.stepTarget ?? button.dataset.goStep;
    selectStep(requestedStep);
    focusWorkspaceStep(state.currentStep);
  });
});

elements.fileInput.addEventListener("change", () => {
  addFiles(elements.fileInput.files ?? []);
});
elements.rateFileInput.addEventListener("change", importRateFile);
document.querySelectorAll("[data-config]").forEach((input) => {
  input.addEventListener("change", () => {
    rebuildReviewFromBase();
  });
});

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
document.querySelectorAll('[data-action="demo"]').forEach((button) => {
  button.addEventListener("click", () => {
    loadDemo();
    if (!button.closest(".workspace-shell")) {
      focusWorkspaceStep("configure");
    }
  });
});

document.querySelector('[data-action="open-audit"]').addEventListener("click", () => {
  if (!state.review) {
    showToast("Load statements or the synthetic demo to inspect the audit trail.");
    selectStep("import");
    focusWorkspaceStep("import");
    return;
  }

  setReviewTab("audit");
  renderReviewTab();
  selectStep("review");
  focusWorkspaceStep("review");
  document
    .querySelector('[data-review-tab="audit"]')
    ?.focus({ preventScroll: true });
});

document.querySelectorAll("[data-review-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    setReviewTab(button.dataset.reviewTab);
    renderReviewTab();
  });
  button.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll("[data-review-tab]")];
    const currentIndex = tabs.indexOf(button);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setReviewTab(nextTab.dataset.reviewTab);
    nextTab.focus();
    renderReviewTab();
  });
});

document.querySelector('[data-action="confirm-review"]').addEventListener("click", () => {
  if (!state.review) {
    showToast("Load statements or the synthetic demo before reviewing.");
    selectStep("import");
    return;
  }
  state.reviewConfirmed = true;
  renderReview();
  selectStep("export");
  focusWorkspaceStep("export");
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
renderReview();
selectStep("import");
