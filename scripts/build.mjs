import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDirectory = join(root, "public");
const libraryDirectory = join(root, "lib");
const outputDirectory = join(root, "dist");
const clientDirectory = join(outputDirectory, "client");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(clientDirectory, { recursive: true });
await cp(publicDirectory, clientDirectory, { recursive: true });
await cp(libraryDirectory, join(clientDirectory, "lib"), { recursive: true });
await mkdir(join(outputDirectory, ".openai"), { recursive: true });
await cp(
  join(root, ".openai", "hosting.json"),
  join(outputDirectory, ".openai", "hosting.json"),
);

const files = await listFiles(clientDirectory);
const assets = {};

for (const path of files) {
  const key = `/${relative(clientDirectory, path).split("\\").join("/")}`;
  const body = await readFile(path);
  assets[key] = {
    body: body.toString("base64"),
    contentType: contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
  };
}

const workerSource = `const assets = ${JSON.stringify(assets)};

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; connect-src 'none'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function responseFor(asset, method) {
  const headers = new Headers(securityHeaders);
  headers.set("Content-Type", asset.contentType);
  headers.set(
    "Cache-Control",
    asset.contentType.startsWith("text/html")
      ? "no-cache"
      : "public, max-age=3600, must-revalidate",
  );
  return new Response(method === "HEAD" ? null : decodeBase64(asset.body), {
    headers,
    status: 200,
  });
}

const worker = {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        headers: { ...securityHeaders, Allow: "GET, HEAD" },
        status: 405,
      });
    }

    const url = new URL(request.url);
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { headers: securityHeaders, status: 400 });
    }

    if (path.includes("..") || path.includes("\\\\") || path.includes("\\0")) {
      return new Response("Bad request", { headers: securityHeaders, status: 400 });
    }

    const requestedAsset =
      assets[path] ??
      (path.endsWith("/") ? assets[\`\${path}index.html\`] : undefined) ??
      (!path.includes(".") ? assets["/index.html"] : undefined);

    if (!requestedAsset) {
      return new Response("Not found", { headers: securityHeaders, status: 404 });
    }

    return responseFor(requestedAsset, request.method);
  },
};

export default worker;
`;

await mkdir(join(outputDirectory, "server"), { recursive: true });
await writeFile(join(outputDirectory, "server", "index.js"), workerSource);

console.log(`Built ${Object.keys(assets).length} local assets into dist/server/index.js`);
