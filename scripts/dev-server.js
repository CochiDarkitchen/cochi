// Servidor SOLO para probar en tu computadora (npm run dev). En Vercel no se usa.
const http = require('http');
const fs = require('fs');
const path = require('path');

// Lee el archivo .env (si existe) para ADMIN_EMAIL, ADMIN_PASSWORD y SESSION_SECRET.
try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* sin .env */ }
const { handle } = require('../lib/api');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; return res.end('Solicitud inválida.'); }
  if (pathname.startsWith('/api/')) return handle(req, res);
  if (pathname === '/admin') { res.statusCode = 301; res.setHeader('Location', '/admin/'); return res.end(); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(PUBLIC, `.${pathname}`);
  if (!file.startsWith(PUBLIC + path.sep)) { res.statusCode = 403; return res.end('Prohibido'); }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('No encontrado'); }
    res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (pathname === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
    if (pathname.startsWith('/admin/')) { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); }
    if (pathname === '/data/settings.json' || pathname === '/data/products.json') res.setHeader('Cache-Control', 'no-store, max-age=0');
    fs.createReadStream(file).pipe(res);
  });
});
server.listen(PORT, () => console.log(`Cochi disponible en http://localhost:${PORT}`));
