import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../lib/ibkr.js";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const updaterUserAgent =
  "OpenTax Ledger VlKAS@users.noreply.github.com";

export const REFERENCE_SOURCES = Object.freeze({
  sbi: Object.freeze({
    repo: "sahilgupta/sbi-fx-ratekeeper",
    path: "csv_files/SBI_REFERENCE_RATES_USD.csv",
    displayUrl: "https://github.com/sahilgupta/sbi-fx-ratekeeper",
  }),
  sec: "https://www.sec.gov/files/company_tickers_exchange.json",
});

function pathsFor(root) {
  const referenceDirectory = join(root, "reference-data");
  return {
    sbiSnapshot: join(referenceDirectory, "sbi-usd-tt-buy-community.csv"),
    secSnapshot: join(referenceDirectory, "sec-company-tickers-exchange.json"),
    manifest: join(referenceDirectory, "manifest.json"),
    generatedModule: join(root, "lib", "reference-data.generated.js"),
    publicSbi: join(root, "public", "data", "sbi-usd-tt-buy-community.csv"),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currentDate(now) {
  return now.toISOString().slice(0, 10);
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function pinSbiSourceUrl(value, commit) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    return "";
  }

  const match = url.pathname.match(
    /^\/sahilgupta\/(?:sbi-fx-ratekeeper|sbi_forex_rates)\/blob\/(?:main|[0-9a-f]{40})\/(pdf_files\/[A-Za-z0-9._/-]+\.pdf)$/i,
  );
  if (!match) {
    return "";
  }

  return `${REFERENCE_SOURCES.sbi.displayUrl}/blob/${commit}/${match[1]}`;
}

export function normalizeSbiCsv(csv, commit) {
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("SBI source commit must be a full 40-character SHA");
  }

  const [header = [], ...rows] = parseCsv(csv, {
    maxCellCharacters: 2_000,
    maxColumns: 32,
    maxRows: 10_000,
  });
  const columns = new Map(
    header.map((name, index) => [name.trim().toUpperCase().replaceAll("_", " "), index]),
  );
  const dateIndex = columns.get("DATE");
  const rateIndex = columns.get("TT BUY");
  const sourceIndex =
    columns.get("SOURCE URL") ??
    columns.get("PDF FILE") ??
    columns.get("EVIDENCE URL");

  if (dateIndex === undefined || rateIndex === undefined) {
    throw new Error("SBI source CSV must contain DATE and TT BUY columns");
  }

  const normalized = rows
    .map((row) => {
      const timestamp = String(row[dateIndex] ?? "").trim();
      const rate = Number.parseFloat(String(row[rateIndex] ?? "").replaceAll(",", ""));
      const sourceUrl = pinSbiSourceUrl(
        sourceIndex === undefined ? "" : String(row[sourceIndex] ?? "").trim(),
        commit,
      );
      if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(timestamp)) return null;
      if (!Number.isFinite(rate) || rate <= 0) return null;
      return { timestamp, ttBuy: rate, sourceUrl };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.ttBuy - right.ttBuy,
    );

  const seen = new Set();
  const unique = normalized.filter((row) => {
    const key = `${row.timestamp}\u0000${row.ttBuy}\u0000${row.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [
    ["DATE", "TT BUY", "SOURCE URL"].map(csvCell).join(","),
    ...unique.map((row) =>
      [row.timestamp, row.ttBuy, row.sourceUrl].map(csvCell).join(","),
    ),
    "",
  ].join("\n");
}

export function parseSecPayload(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(parsed?.fields) || !Array.isArray(parsed?.data)) {
    throw new Error("SEC snapshot must contain fields and data arrays");
  }
  if (parsed.fields.length > 32) {
    throw new Error("SEC snapshot exceeds the field limit");
  }
  if (parsed.data.length > 100_000) {
    throw new Error("SEC snapshot exceeds the row limit");
  }

  const fields = parsed.fields.map((field) => String(field).trim().toLowerCase());
  if (!["cik", "name", "ticker", "exchange"].every((field) => fields.includes(field))) {
    throw new Error("SEC snapshot is missing a required field");
  }

  for (const row of parsed.data) {
    if (!Array.isArray(row) || row.length !== fields.length) {
      throw new Error("SEC snapshot contains a malformed row");
    }
    for (const cell of row) {
      if (
        !["string", "number"].includes(typeof cell) &&
        cell !== null
      ) {
        throw new Error("SEC snapshot contains a non-scalar cell");
      }
      if (typeof cell === "string" && cell.length > 5_000) {
        throw new Error("SEC snapshot contains an oversized cell");
      }
    }
  }

  return { fields, data: parsed.data };
}

export function normalizeSecJson(input) {
  const parsed = parseSecPayload(input);
  return `${JSON.stringify({ fields: parsed.fields, data: parsed.data })}\n`;
}

function generatedModule(sbiCsv, secJson) {
  return `// Generated by scripts/generate-reference-data.mjs. Do not edit by hand.
export const BUNDLED_SBI_USD_CSV = ${JSON.stringify(sbiCsv)};
export const BUNDLED_SEC_COMPANY_JSON = ${JSON.stringify(secJson)};
`;
}

function parseSbiCoverage(sbiCsv) {
  const rows = parseCsv(sbiCsv);
  const records = rows.slice(1);
  return {
    records: records.length,
    first: records[0]?.[0]?.slice(0, 10) ?? "",
    last: records.at(-1)?.[0]?.slice(0, 10) ?? "",
  };
}

function assertManifest(manifest, { sbiCsv, secJson, secSnapshot, sourceCommit }) {
  const sbi = manifest?.datasets?.sbiUsdTtBuyCommunity;
  const sec = manifest?.datasets?.secCompanyTickersExchange;
  if (!sbi || !sec) {
    throw new Error("reference-data/manifest.json is missing dataset metadata");
  }
  if (sbi.sourceCommit !== sourceCommit) {
    throw new Error("SBI source commit does not match reference-data/manifest.json");
  }
  if (sbi.normalizedSha256 !== sha256(sbiCsv)) {
    throw new Error("SBI normalized snapshot hash does not match manifest.json");
  }

  const coverage = parseSbiCoverage(sbiCsv);
  if (sbi.records !== coverage.records) {
    throw new Error("SBI normalized row count does not match manifest.json");
  }
  if (
    sbi.coverage?.first !== coverage.first ||
    sbi.coverage?.last !== coverage.last
  ) {
    throw new Error("SBI coverage does not match manifest.json");
  }

  const secPayload = parseSecPayload(secJson);
  if (sec.sha256 !== sha256(secSnapshot)) {
    throw new Error("SEC snapshot hash does not match manifest.json");
  }
  if (sec.records !== secPayload.data.length) {
    throw new Error("SEC snapshot row count does not match manifest.json");
  }
}

function assertRefreshSafety(currentSbiCsv, nextSbiCsv, currentSecJson, nextSecJson) {
  const currentSbi = parseSbiCoverage(currentSbiCsv);
  const nextSbi = parseSbiCoverage(nextSbiCsv);
  if (nextSbi.records < currentSbi.records) {
    throw new Error("SBI refresh would reduce the checked-in record count");
  }
  if (currentSbi.first && nextSbi.first > currentSbi.first) {
    throw new Error("SBI refresh would truncate the beginning of coverage");
  }
  if (currentSbi.last && nextSbi.last < currentSbi.last) {
    throw new Error("SBI refresh would move the latest coverage date backwards");
  }

  const currentSecCount = parseSecPayload(currentSecJson).data.length;
  const nextSecCount = parseSecPayload(nextSecJson).data.length;
  if (currentSecCount > 0 && nextSecCount < Math.floor(currentSecCount * 0.9)) {
    throw new Error("SEC refresh would remove more than 10% of checked-in rows");
  }
}

function normalizedHttpDate(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? fallback
    : parsed.toISOString().replace(".000Z", "Z");
}

async function fetchText(
  fetchImpl,
  url,
  { allowNotModified = false, headers, maxBytes, retryDelaysMs = [] },
) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(url, { headers });
    if (allowNotModified && response.status === 304) {
      return { headers: response.headers, notModified: true, text: null };
    }
    if (response.ok) {
      const declaredLength = Number.parseInt(
        response.headers.get("content-length") ?? "",
        10,
      );
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new Error(`Refusing oversized response from ${url}`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new Error(`Refusing oversized response from ${url}`);
      }

      return {
        headers: response.headers,
        notModified: false,
        text: new TextDecoder().decode(bytes),
      };
    }

    const body = await response.text().catch(() => "");
    const retryable = [403, 429, 500, 502, 503, 504].includes(response.status);
    const configuredDelay = retryDelaysMs[attempt];
    if (retryable && configuredDelay !== undefined) {
      const retryAfterSeconds = Number.parseInt(
        response.headers.get("retry-after") ?? "",
        10,
      );
      const retryAfterMs = Number.isFinite(retryAfterSeconds)
        ? Math.min(retryAfterSeconds * 1_000, 30_000)
        : configuredDelay;
      await new Promise((resolveWait) => setTimeout(resolveWait, retryAfterMs));
      continue;
    }

    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText} ${body.slice(0, 500)}`,
    );
  }
}

async function fetchLatestSources(
  fetchImpl,
  githubToken,
  currentSecRaw,
  currentSecLastModified,
) {
  const githubHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": updaterUserAgent,
    ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
  };

  const repoResponse = await fetchText(
    fetchImpl,
    `https://api.github.com/repos/${REFERENCE_SOURCES.sbi.repo}`,
    { headers: githubHeaders, maxBytes: 1_000_000 },
  );
  const defaultBranch = String(JSON.parse(repoResponse.text)?.default_branch ?? "").trim();
  if (!defaultBranch) {
    throw new Error("SBI source repository did not report a default branch");
  }

  const commitResponse = await fetchText(
    fetchImpl,
    `https://api.github.com/repos/${REFERENCE_SOURCES.sbi.repo}/commits/${encodeURIComponent(defaultBranch)}`,
    { headers: githubHeaders, maxBytes: 2_000_000 },
  );
  const sourceCommit = String(JSON.parse(commitResponse.text)?.sha ?? "").trim();
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error("SBI source commit response did not include a valid SHA");
  }

  const sbiResponse = await fetchText(
    fetchImpl,
    `https://raw.githubusercontent.com/${REFERENCE_SOURCES.sbi.repo}/${sourceCommit}/${REFERENCE_SOURCES.sbi.path}`,
    { headers: githubHeaders, maxBytes: 5_000_000 },
  );
  const conditionalDate = new Date(currentSecLastModified);
  const secHeaders = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "User-Agent": updaterUserAgent,
    ...(!Number.isNaN(conditionalDate.getTime())
      ? { "If-Modified-Since": conditionalDate.toUTCString() }
      : {}),
  };
  const secResponse = await fetchText(fetchImpl, REFERENCE_SOURCES.sec, {
    allowNotModified: true,
    headers: secHeaders,
    maxBytes: 20_000_000,
    retryDelaysMs: [2_000, 8_000, 20_000],
  });

  return {
    sbi: {
      sourceCommit,
      rawText: sbiResponse.text,
    },
    sec: {
      rawText: secResponse.notModified ? currentSecRaw : secResponse.text,
      lastModified:
        secResponse.headers.get("last-modified") ?? currentSecLastModified,
    },
  };
}

function buildManifest({
  current,
  now,
  sbiCsv,
  sbiRaw,
  sourceCommit,
  secJson,
  secSnapshot,
  secLastModified,
}) {
  const coverage = parseSbiCoverage(sbiCsv);
  const secPayload = parseSecPayload(secJson);
  return {
    ...current,
    generatedOn: currentDate(now),
    datasets: {
      ...current.datasets,
      sbiUsdTtBuyCommunity: {
        ...current.datasets.sbiUsdTtBuyCommunity,
        sourceCommit,
        upstreamSha256: sha256(sbiRaw),
        normalizedSha256: sha256(sbiCsv),
        records: coverage.records,
        coverage: {
          ...current.datasets.sbiUsdTtBuyCommunity.coverage,
          first: coverage.first,
          last: coverage.last,
        },
      },
      secCompanyTickersExchange: {
        ...current.datasets.secCompanyTickersExchange,
        lastModified: normalizedHttpDate(
          secLastModified,
          current.datasets.secCompanyTickersExchange.lastModified,
        ),
        upstreamSha256: sha256(secSnapshot),
        sha256: sha256(secSnapshot),
        records: secPayload.data.length,
        fields: secPayload.fields,
      },
    },
  };
}

async function assertCurrent(path, expected) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== expected) {
    throw new Error(`${path} is stale; run npm run data:build`);
  }
}

async function writeArtifacts(
  paths,
  { sbiCsv, secSnapshot, moduleSource, manifest },
) {
  await mkdir(dirname(paths.generatedModule), { recursive: true });
  await mkdir(dirname(paths.publicSbi), { recursive: true });
  await writeFile(paths.sbiSnapshot, sbiCsv);
  if (secSnapshot !== undefined) {
    await writeFile(paths.secSnapshot, secSnapshot);
  }
  await writeFile(paths.generatedModule, moduleSource);
  await writeFile(paths.publicSbi, sbiCsv);
  if (manifest) {
    await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

export async function runReferenceDataPipeline({
  root = defaultRoot,
  mode = "build",
  fetchImpl = globalThis.fetch,
  githubToken = "",
  now = new Date(),
} = {}) {
  if (!["build", "check", "refresh"].includes(mode)) {
    throw new Error(`Unsupported reference-data mode: ${mode}`);
  }

  const paths = pathsFor(root);
  const currentSbiRaw = await readFile(paths.sbiSnapshot, "utf8");
  const currentSecRaw = await readFile(paths.secSnapshot, "utf8");
  const currentManifest = JSON.parse(await readFile(paths.manifest, "utf8"));
  const currentCommit = String(
    currentManifest?.datasets?.sbiUsdTtBuyCommunity?.sourceCommit ?? "",
  );
  const currentSbiCsv = normalizeSbiCsv(currentSbiRaw, currentCommit);
  const currentSecJson = normalizeSecJson(currentSecRaw);

  if (mode !== "refresh") {
    const moduleSource = generatedModule(currentSbiCsv, currentSecJson);
    assertManifest(currentManifest, {
      sbiCsv: currentSbiCsv,
      secJson: currentSecJson,
      secSnapshot: currentSecRaw,
      sourceCommit: currentCommit,
    });

    if (mode === "check") {
      await assertCurrent(paths.sbiSnapshot, currentSbiCsv);
      await assertCurrent(paths.generatedModule, moduleSource);
      await assertCurrent(paths.publicSbi, currentSbiCsv);
      console.log("Reference snapshots and generated assets are current");
      return { changed: false, mode };
    }

    await writeArtifacts(paths, {
      sbiCsv: currentSbiCsv,
      moduleSource,
    });
    console.log("Generated local reference-data assets");
    return { changed: true, mode };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Reference refresh requires a fetch implementation");
  }

  const remote = await fetchLatestSources(
    fetchImpl,
    githubToken,
    currentSecRaw,
    currentManifest.datasets.secCompanyTickersExchange.lastModified,
  );
  const nextSbiCsv = normalizeSbiCsv(remote.sbi.rawText, remote.sbi.sourceCommit);
  const nextSecJson = normalizeSecJson(remote.sec.rawText);
  assertRefreshSafety(currentSbiCsv, nextSbiCsv, currentSecJson, nextSecJson);

  const remoteMetadataChanged =
    remote.sbi.sourceCommit !== currentCommit ||
    sha256(remote.sbi.rawText) !==
      currentManifest.datasets.sbiUsdTtBuyCommunity.upstreamSha256 ||
    sha256(remote.sec.rawText) !==
      currentManifest.datasets.secCompanyTickersExchange.upstreamSha256;
  const snapshotsChanged =
    nextSbiCsv !== currentSbiCsv || remote.sec.rawText !== currentSecRaw;
  const nextModuleSource = generatedModule(nextSbiCsv, nextSecJson);
  const currentModuleSource = await readFile(paths.generatedModule, "utf8").catch(() => "");
  const currentPublicSbi = await readFile(paths.publicSbi, "utf8").catch(() => "");
  const generatedAssetsChanged =
    currentModuleSource !== nextModuleSource || currentPublicSbi !== nextSbiCsv;

  if (!remoteMetadataChanged && !snapshotsChanged && !generatedAssetsChanged) {
    console.log("No reference-data changes detected");
    return { changed: false, mode };
  }

  const nextManifest = buildManifest({
    current: currentManifest,
    now,
    sbiCsv: nextSbiCsv,
    sbiRaw: remote.sbi.rawText,
    sourceCommit: remote.sbi.sourceCommit,
    secJson: nextSecJson,
    secSnapshot: remote.sec.rawText,
    secLastModified: remote.sec.lastModified,
  });
  assertManifest(nextManifest, {
    sbiCsv: nextSbiCsv,
    secJson: nextSecJson,
    secSnapshot: remote.sec.rawText,
    sourceCommit: remote.sbi.sourceCommit,
  });
  await writeArtifacts(paths, {
    sbiCsv: nextSbiCsv,
    secSnapshot: remote.sec.rawText,
    moduleSource: nextModuleSource,
    manifest: nextManifest,
  });

  console.log("Refreshed reference data snapshots");
  return {
    changed: true,
    mode,
    sbiRecords: nextManifest.datasets.sbiUsdTtBuyCommunity.records,
    secRecords: nextManifest.datasets.secCompanyTickersExchange.records,
  };
}

function modeFromArgs(argv) {
  const check = argv.includes("--check");
  const refresh = argv.includes("--refresh");
  if (check && refresh) {
    throw new Error("--check and --refresh cannot be used together");
  }
  return check ? "check" : refresh ? "refresh" : "build";
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runReferenceDataPipeline({
    mode: modeFromArgs(process.argv.slice(2)),
    githubToken: process.env.GITHUB_TOKEN ?? "",
  });
}
