import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {},
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the complete privacy-first product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'none'/);

  const html = await response.text();
  assert.match(html, /<title>OpenTax Ledger/i);
  assert.match(html, /Your statements never leave this browser/i);
  assert.match(html, /Import/);
  assert.match(html, /Configure/);
  assert.match(html, /Review/);
  assert.match(html, /Export/);
  assert.match(html, /Not tax advice/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("worker serves assets and blocks unsupported methods", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-assets`);
  const { default: worker } = await import(workerUrl.href);

  const script = await worker.fetch(new Request("http://localhost/app.mjs"), {});
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);

  const rejected = await worker.fetch(
    new Request("http://localhost/", { method: "POST" }),
    {},
  );
  assert.equal(rejected.status, 405);
});
