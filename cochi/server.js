const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);

// Carga opcional de .env sin dependencias externas; Vercel utiliza sus variables del proyecto.
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !match[1].startsWith('#') && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch { /* .env es opcional */ }

const configHandler = require('./api/config.js');
const bcvHandler = require('./api/bcv.js');
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function apiResponder(handler, req, res) {
  const wrapped = {
    setHeader: (...args) => res.setHeader(...args),
    end: (...args) => res.end(...args)
  };
  Object.defineProperty(wrapped, 'statusCode', { get: () => res.statusCode, set: value => { res.statusCode = value; } });
  Promise.resolve(handler(req, wrapped)).then(() => {
    if (!res.writableEnded) { res.statusCode = wrapped.statusCode; res.end(); }
  }).catch(error => {
    console.error('API local error:', error);
    if (!res.writableEnded) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Error interno.' })); }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/config') return apiResponder(configHandler, req, res);
  if (url.pathname === '/api/bcv') return apiResponder(bcvHandler, req, res);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; return res.end('Solicitud inválida.'); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.resolve(PUBLIC, `.${pathname}`);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) { res.statusCode = 403; return res.end('Prohibido'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('No encontrado'); }
    res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    fs.createReadStream(file).pipe(res);
  });
});
server.listen(PORT, () => console.log(`Cochi disponible en http://localhost:${PORT}`));
