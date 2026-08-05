/**
 * Minimal static server for the e2e web application.
 *
 * Serves the built Angular bundle (dist/apps/web/browser) with an SPA
 * fallback and proxies /api to the API on :3000.
 *
 * Why this exists instead of `nx run web:serve`: the Playwright webServer is
 * spawned as a *child of an Nx task*, so an `nx run` command inside it makes
 * the child's task graph overlap the parent's. Nx refuses the overlap with
 * "task was already invoked by a parent Nx process" (its recursion guard),
 * which is exactly what happens in CI when the parent run-many has already
 * built shared-types for api-e2e. A plain `node` process has no Nx graph and
 * cannot trip the guard. This file is deliberately dependency-free: it is
 * test plumbing, and test plumbing should be boring.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../dist/apps/web/browser',
);

const API_ORIGIN = new URL(
  process.env['API_ORIGIN'] ?? 'http://localhost:3000',
);

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(
    `[static-server] Web bundle not found at ${ROOT}. Run 'npx nx run web:build' first.`,
  );
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  if (req.url?.startsWith('/api')) {
    proxyToApi(req, res);
    return;
  }

  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const relPath = normalize(urlPath).replace(/^([/\\])+/, '');
  let filePath = resolve(ROOT, relPath);
  if (!filePath.startsWith(ROOT)) {
    filePath = join(ROOT, 'index.html');
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback: deep links render through client-side routing.
    filePath = join(ROOT, 'index.html');
  }

  res.writeHead(200, {
    'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(res);
}).listen(4200, () => {
  console.log(`[static-server] serving ${ROOT} on http://localhost:4200`);
});

function proxyToApi(req, res) {
  const upstream = (
    API_ORIGIN.protocol === 'https:' ? httpsRequest : httpRequest
  )(
    {
      protocol: API_ORIGIN.protocol,
      hostname: API_ORIGIN.hostname,
      port: API_ORIGIN.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: API_ORIGIN.host },
    },
    (upstreamResponse) => {
      res.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Bad Gateway: API not reachable on ' + API_ORIGIN.host);
  });
  req.pipe(upstream);
}
