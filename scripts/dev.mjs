import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDirectory = join(root, "public");
const libraryDirectory = join(root, "lib");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function resolveAsset(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) {
    return null;
  }

  const relativePath = decoded.replace(/^\/+/, "");
  if (relativePath.startsWith("lib/")) {
    return join(libraryDirectory, normalize(relativePath.slice(4)));
  }

  const candidate = join(publicDirectory, normalize(relativePath));
  if (relativePath && existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return join(publicDirectory, "index.html");
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const asset = resolveAsset(url.pathname);
  if (!asset || !existsSync(asset)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'self'; connect-src 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'",
    "Content-Type": contentTypes[extname(asset).toLowerCase()] ?? "application/octet-stream",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(asset).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local URL: http://localhost:${port}`);
});
