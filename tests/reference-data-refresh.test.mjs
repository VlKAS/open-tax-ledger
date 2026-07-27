import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  normalizeSbiCsv,
  normalizeSecJson,
  runReferenceDataPipeline,
  sha256,
  writeGitHubRefreshMetadata,
} from "../scripts/generate-reference-data.mjs";

const oldCommit = "a".repeat(40);
const nextCommit = "b".repeat(40);

function response(body, headers = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

async function makeFixtureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "open-tax-ledger-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "reference-data"), { recursive: true });
  await mkdir(join(root, "lib"), { recursive: true });
  await mkdir(join(root, "public", "data"), { recursive: true });

  const oldSbiSource = [
    "DATE,TT BUY,SOURCE URL",
    "2026-07-26,95.4,https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/pdf_files/2026/7/2026-07-26.pdf",
    "",
  ].join("\n");
  const oldSbi = normalizeSbiCsv(oldSbiSource, oldCommit);
  const oldSecSource = JSON.stringify({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [[320193, "Apple Inc.", "AAPL", "Nasdaq"]],
  });
  const oldSec = normalizeSecJson(oldSecSource);
  const manifest = {
    schemaVersion: 1,
    generatedOn: "2026-07-26",
    datasets: {
      sbiUsdTtBuyCommunity: {
        provider: "Test SBI archive",
        repository: "https://github.com/sahilgupta/sbi-fx-ratekeeper",
        sourceCommit: oldCommit,
        sourcePath: "csv_files/SBI_REFERENCE_RATES_USD.csv",
        upstreamSha256: sha256(oldSbiSource),
        normalizedSha256: sha256(oldSbi),
        records: 1,
        coverage: { first: "2026-07-26", last: "2026-07-26" },
      },
      secCompanyTickersExchange: {
        provider: "SEC EDGAR",
        source: "https://www.sec.gov/files/company_tickers_exchange.json",
        lastModified: "2026-07-26T00:00:00Z",
        upstreamSha256: sha256(oldSecSource),
        sha256: sha256(oldSec),
        records: 1,
        fields: ["cik", "name", "ticker", "exchange"],
      },
    },
  };

  await writeFile(join(root, "reference-data", "sbi-usd-tt-buy-community.csv"), oldSbi);
  await writeFile(join(root, "reference-data", "sec-company-tickers-exchange.json"), oldSec);
  await writeFile(
    join(root, "reference-data", "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await runReferenceDataPipeline({ root, mode: "build" });
  return root;
}

function failingSecFetch(status, statusText, body = "temporarily unavailable") {
  return async (url) => {
    if (url === "https://api.github.com/repos/sahilgupta/sbi-fx-ratekeeper") {
      return response(JSON.stringify({ default_branch: "main" }));
    }
    if (url.endsWith("/commits/main")) {
      return response(JSON.stringify({ sha: nextCommit }));
    }
    if (url.includes("raw.githubusercontent.com")) {
      return response(
        [
          "DATE,TT BUY,SOURCE URL",
          "2026-07-26,95.4,https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/pdf_files/2026/7/2026-07-26.pdf",
          "",
        ].join("\n"),
        { "content-type": "text/csv" },
      );
    }
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") {
      return new Response(body, { status, statusText });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

test("refresh writes each provider to the correct snapshot and is idempotent", async (t) => {
  const root = await makeFixtureRoot(t);
  let seenSecHeaders;
  let secRequestCount = 0;
  const nextSbiSource = [
    "DATE,TT BUY,SOURCE URL",
    "2026-07-26,95.4,https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/pdf_files/2026/7/2026-07-26.pdf",
    "2026-07-27,95.55,https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/pdf_files/2026/7/2026-07-27.pdf",
    "",
  ].join("\n");
  const nextSecSource = JSON.stringify({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [
      [320193, "Apple Inc.", "AAPL", "Nasdaq"],
      [789019, "Microsoft Corp.", "MSFT", "Nasdaq"],
    ],
  });
  const fetchImpl = async (url, init = {}) => {
    if (url === "https://api.github.com/repos/sahilgupta/sbi-fx-ratekeeper") {
      return response(JSON.stringify({ default_branch: "main" }));
    }
    if (url.endsWith("/commits/main")) {
      return response(JSON.stringify({ sha: nextCommit }));
    }
    if (url.includes("raw.githubusercontent.com")) {
      return response(nextSbiSource, { "content-type": "text/csv" });
    }
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") {
      secRequestCount += 1;
      seenSecHeaders = init.headers;
      if (secRequestCount > 1) {
        return new Response(null, { status: 304 });
      }
      return response(nextSecSource, {
        "last-modified": "Mon, 27 Jul 2026 12:00:00 GMT",
      });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };

  const refreshed = await runReferenceDataPipeline({
    root,
    mode: "refresh",
    fetchImpl,
    now: new Date("2026-07-27T13:00:00Z"),
  });
  assert.equal(refreshed.changed, true);

  const sbiSnapshot = await readFile(
    join(root, "reference-data", "sbi-usd-tt-buy-community.csv"),
    "utf8",
  );
  const secSnapshot = await readFile(
    join(root, "reference-data", "sec-company-tickers-exchange.json"),
    "utf8",
  );
  const manifest = JSON.parse(
    await readFile(join(root, "reference-data", "manifest.json"), "utf8"),
  );

  assert.match(sbiSnapshot, new RegExp(`/blob/${nextCommit}/`));
  assert.doesNotMatch(secSnapshot, /^DATE,TT BUY/);
  assert.equal(JSON.parse(secSnapshot).data.length, 2);
  assert.equal(manifest.datasets.sbiUsdTtBuyCommunity.records, 2);
  assert.equal(manifest.datasets.secCompanyTickersExchange.records, 2);
  assert.equal(manifest.datasets.secCompanyTickersExchange.sha256, sha256(secSnapshot));
  assert.equal(manifest.datasets.secCompanyTickersExchange.upstreamSha256, sha256(nextSecSource));
  assert.equal(manifest.datasets.secCompanyTickersExchange.lastModified, "2026-07-27T12:00:00Z");
  assert.match(seenSecHeaders["User-Agent"], /@users\.noreply\.github\.com$/);
  assert.equal(seenSecHeaders["Accept-Encoding"], "gzip, deflate");
  assert.equal(seenSecHeaders["If-Modified-Since"], "Sun, 26 Jul 2026 00:00:00 GMT");

  await runReferenceDataPipeline({ root, mode: "check" });
  const secondRefresh = await runReferenceDataPipeline({
    root,
    mode: "refresh",
    fetchImpl,
    now: new Date("2026-07-28T13:00:00Z"),
  });
  assert.equal(secondRefresh.changed, false);
  assert.equal(secRequestCount, 2);
  assert.equal(
    JSON.parse(await readFile(join(root, "reference-data", "manifest.json"), "utf8"))
      .generatedOn,
    "2026-07-27",
  );
});

test("CI refresh keeps the last verified SEC snapshot after a retryable official fetch failure", async (t) => {
  const root = await makeFixtureRoot(t);
  const previousSecSnapshot = await readFile(
    join(root, "reference-data", "sec-company-tickers-exchange.json"),
    "utf8",
  );
  const previousSbiSnapshot = await readFile(
    join(root, "reference-data", "sbi-usd-tt-buy-community.csv"),
    "utf8",
  );
  const previousManifest = JSON.parse(
    await readFile(join(root, "reference-data", "manifest.json"), "utf8"),
  );
  const nextSbiSource = [
    "DATE,TT BUY,SOURCE URL",
    "2026-07-26,95.4,https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/pdf_files/2026/7/2026-07-26.pdf",
    "2026-07-27,95.55,https://github.com/sahilgupta/sbi-fx-ratekeeper/blob/main/pdf_files/2026/7/2026-07-27.pdf",
    "",
  ].join("\n");
  const fetchImpl = async (url) => {
    if (url === "https://api.github.com/repos/sahilgupta/sbi-fx-ratekeeper") {
      return response(JSON.stringify({ default_branch: "main" }));
    }
    if (url.endsWith("/commits/main")) {
      return response(JSON.stringify({ sha: nextCommit }));
    }
    if (url.includes("raw.githubusercontent.com")) {
      return response(nextSbiSource, { "content-type": "text/csv" });
    }
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") {
      return new Response("temporarily unavailable", {
        status: 403,
        statusText: "Forbidden",
      });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };

  await assert.rejects(
    runReferenceDataPipeline({
      root,
      mode: "refresh",
      fetchImpl,
      secRetryDelaysMs: [],
    }),
    /Failed to fetch .*company_tickers_exchange\.json: 403 Forbidden/,
  );
  assert.equal(
    await readFile(
      join(root, "reference-data", "sec-company-tickers-exchange.json"),
      "utf8",
    ),
    previousSecSnapshot,
  );
  assert.equal(
    await readFile(
      join(root, "reference-data", "sbi-usd-tt-buy-community.csv"),
      "utf8",
    ),
    previousSbiSnapshot,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(root, "reference-data", "manifest.json"), "utf8"),
    ),
    previousManifest,
  );

  const refreshed = await runReferenceDataPipeline({
    root,
    mode: "refresh",
    fetchImpl,
    allowStaleSec: true,
    now: new Date("2026-07-27T13:00:00Z"),
    secRetryDelaysMs: [],
  });
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.secStatus, "stale");
  assert.deepEqual(refreshed.staleSources, ["secCompanyTickersExchange"]);

  const nextSecSnapshot = await readFile(
    join(root, "reference-data", "sec-company-tickers-exchange.json"),
    "utf8",
  );
  const nextManifest = JSON.parse(
    await readFile(join(root, "reference-data", "manifest.json"), "utf8"),
  );
  const nextSbiSnapshot = await readFile(
    join(root, "reference-data", "sbi-usd-tt-buy-community.csv"),
    "utf8",
  );

  assert.equal(nextSecSnapshot, previousSecSnapshot);
  assert.deepEqual(
    nextManifest.datasets.secCompanyTickersExchange,
    previousManifest.datasets.secCompanyTickersExchange,
  );
  assert.match(nextSbiSnapshot, new RegExp(`/blob/${nextCommit}/`));
  assert.equal(nextManifest.datasets.sbiUsdTtBuyCommunity.records, 2);
  await runReferenceDataPipeline({ root, mode: "check" });
});

test("CI stale fallback accepts a Node fetch network failure", async (t) => {
  const root = await makeFixtureRoot(t);
  const successfulSources = failingSecFetch(200, "OK");
  const fetchImpl = async (url, init) => {
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") {
      throw new TypeError("fetch failed");
    }
    return successfulSources(url, init);
  };

  const refreshed = await runReferenceDataPipeline({
    root,
    mode: "refresh",
    fetchImpl,
    allowStaleSec: true,
    now: new Date("2026-07-27T13:00:00Z"),
    secRetryDelaysMs: [],
  });

  assert.equal(refreshed.secStatus, "stale");
  assert.deepEqual(refreshed.staleSources, ["secCompanyTickersExchange"]);
});

test("CI stale fallback rejects non-retryable SEC responses", async (t) => {
  const root = await makeFixtureRoot(t);
  const fetchImpl = failingSecFetch(404, "Not Found");

  await assert.rejects(
    runReferenceDataPipeline({
      root,
      mode: "refresh",
      fetchImpl,
      allowStaleSec: true,
      secRetryDelaysMs: [],
    }),
    /Failed to fetch .*company_tickers_exchange\.json: 404 Not Found/,
  );
});

test("CI stale fallback rejects malformed successful SEC responses", async (t) => {
  const root = await makeFixtureRoot(t);
  const fetchImpl = failingSecFetch(200, "OK", "{\"unexpected\":true}");

  await assert.rejects(
    runReferenceDataPipeline({
      root,
      mode: "refresh",
      fetchImpl,
      allowStaleSec: true,
      secRetryDelaysMs: [],
    }),
    /SEC snapshot must contain fields and data arrays/,
  );
});

test("CI stale fallback rejects SEC snapshots older than 30 days", async (t) => {
  const root = await makeFixtureRoot(t);
  const fetchImpl = failingSecFetch(403, "Forbidden");

  await assert.rejects(
    runReferenceDataPipeline({
      root,
      mode: "refresh",
      fetchImpl,
      allowStaleSec: true,
      now: new Date("2026-08-26T00:00:01Z"),
      secRetryDelaysMs: [],
    }),
    /SEC snapshot is older than 30 days/,
  );
});

test("GitHub refresh metadata writes validated outputs and a visible summary", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "open-tax-ledger-metadata-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = join(root, "github-output.txt");
  const summaryPath = join(root, "github-summary.md");
  const secSha256 = "c".repeat(64);

  await writeGitHubRefreshMetadata(
    {
      secStatus: "stale",
      secLastModified: "2026-07-24T13:32:36Z",
      secSha256,
    },
    { outputPath, summaryPath },
  );

  assert.equal(
    await readFile(outputPath, "utf8"),
    [
      "sec-status=stale",
      "sec-last-modified=2026-07-24T13:32:36Z",
      `sec-sha256=${secSha256}`,
      "",
    ].join("\n"),
  );
  assert.equal(
    await readFile(summaryPath, "utf8"),
    [
      "### Reference source status",
      "",
      "- SEC status: **stale**",
      "- SEC last verified: `2026-07-24T13:32:36Z`",
      `- SEC snapshot SHA-256: \`${secSha256}\``,
      "",
    ].join("\n"),
  );

  await assert.rejects(
    writeGitHubRefreshMetadata(
      {
        secStatus: "unexpected",
        secLastModified: "not-a-date",
        secSha256: "not-a-hash",
      },
      { outputPath, summaryPath },
    ),
    /SEC refresh status is invalid/,
  );
});

test("normalization drops SBI evidence links outside the pinned PDF archive", () => {
  const normalized = normalizeSbiCsv(
    [
      "DATE,TT BUY,SOURCE URL",
      "2026-07-27,95.55,https://phishing.example/sbi-rate.pdf",
      "2026-07-28,95.65,https://github.com/sahilgupta/sbi-fx-ratekeeper/issues/1",
      "",
    ].join("\n"),
    nextCommit,
  );

  assert.doesNotMatch(normalized, /phishing\.example|\/issues\/1/);
  assert.match(normalized, /2026-07-27,95\.55,$/m);
  assert.match(normalized, /2026-07-28,95\.65,$/m);
});
