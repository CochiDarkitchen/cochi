'use strict';
// API de Cochi: contenido público, imágenes y panel admin. Sin dependencias externas.
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'cochi_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

/* ---------- Sesión ---------- */
const creds = () => ({ email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pass: process.env.ADMIN_PASSWORD || '', secret: process.env.SESSION_SECRET || '' });
const configured = () => { const c = creds(); return Boolean(c.email && c.pass.length >= 8 && c.secret.length >= 16); };
const digest = value => crypto.createHash('sha256').update(String(value)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));
const sign = payload => crypto.createHmac('sha256', creds().secret).update(payload).digest('base64url');
function makeToken(email) {
  const payload = Buffer.from(JSON.stringify({ e: email, x: Date.now() + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readSession(req) {
  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match || !configured()) return null;
  const [payload, signature] = match[1].split('.');
  if (!payload || !signature || !same(sign(payload), signature)) return null;
  try { const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); return data.x > Date.now() ? data : null; } catch { return null; }
}
const isHttps = req => (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || Boolean(req.socket?.encrypted);
const cookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
const attempts = new Map();
function throttle(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const entry = (attempts.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (entry.length >= 6) throw bad('Demasiados intentos. Espera unos minutos e inténtalo otra vez.', 429);
  entry.push(now); attempts.set(ip, entry);
}

/* ---------- Utilidades HTTP ---------- */
function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries({ 'Cache-Control': 'no-store', ...headers }).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(data));
}
async function readBody(req, limit = 1_500_000) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw bad('El archivo es demasiado grande.', 413); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { throw bad('Datos inválidos.'); }
}
const sameOrigin = req => { const origin = req.headers.origin; if (!origin) return true; try { return new URL(origin).host === req.headers.host; } catch { return false; } };

/* ---------- Validación: lo que llega del admin se limpia antes de guardarse ---------- */
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const num = (v, min, max, dec = 2) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(`Número fuera de rango: ${v}`); const f = 10 ** dec; return Math.round(n * f) / f; };
const slug = v => { const s = String(v ?? ''); if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(s)) throw bad(`Identificador inválido: ${s}`); return s; };
const image = v => { const s = str(v, 200); if (!s) return ''; if ((/^\/assets\/[\w\-./]+$/.test(s) && !s.includes('..')) || /^\/api\/img\/[\w-]{6,40}$/.test(s)) return s; throw bad('Imagen inválida.'); };
const link = v => { const s = str(v, 300); if (!s) return ''; if (/^#(menu|favoritos|cochi-dulce|historia|flyers)$/.test(s) || /^product:[a-z0-9-]{1,60}$/.test(s) || /^https:\/\/[^\s<>"']+$/.test(s)) return s; throw bad('Enlace inválido.'); };
const day = v => { const s = str(v, 10); if (!s) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad('Fecha inválida.'); return s; };
const span = o => { const start = day(o.start), end = day(o.end); if (start && end && end < start) throw bad('La fecha final no puede ser anterior a la inicial.'); return { start, end }; };
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const rid = () => crypto.randomBytes(5).toString('hex');

function cleanContent(input) {
  const c = input && typeof input === 'object' ? input : {};
  const s = c.settings || {};
  if (!/^\d{8,15}$/.test(String(s.whatsappNumber))) throw bad('El número de WhatsApp debe tener solo números (con código de país).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.exchangeRateDate))) throw bad('La fecha de la tasa no es válida.');
  const modes = ['delivery', 'pickup'].filter(m => list(s.orderModes, 4).includes(m));
  const r = s.receipt && typeof s.receipt === 'object' ? s.receipt : {};
  const receiptColor = str(r.accentColor, 7);
  const receipt = {
    businessName: str(r.businessName, 60) || 'COCHI',
    title: str(r.title, 70) || 'COMPROBANTE DE PEDIDO',
    subtitle: str(r.subtitle, 140) || 'Tu pedido está listo para confirmar',
    customerHeading: str(r.customerHeading, 60) || 'DATOS DEL CLIENTE',
    orderHeading: str(r.orderHeading, 60) || 'DETALLE DEL PEDIDO',
    summaryHeading: str(r.summaryHeading, 60) || 'RESUMEN',
    subtotalLabel: str(r.subtotalLabel, 45) || 'Subtotal',
    deliveryLabel: str(r.deliveryLabel, 45) || 'Delivery',
    totalLabel: str(r.totalLabel, 45) || 'Total estimado',
    vesLabel: str(r.vesLabel, 70) || 'Total referencial en bolívares',
    footerText: str(r.footerText, 240) || 'El monto final y el costo de entrega se confirman directamente por WhatsApp.',
    thankYouText: str(r.thankYouText, 140) || '¡Gracias por elegir Cochi!',
    accentColor: /^#[0-9a-fA-F]{6}$/.test(receiptColor) ? receiptColor : '#eb140c',
    showLogo: r.showLogo !== false,
    showDate: r.showDate !== false,
    showOrderCode: r.showOrderCode !== false,
    showPhone: r.showPhone !== false,
    showMode: r.showMode !== false,
    showAddress: r.showAddress !== false,
    showSector: r.showSector !== false,
    showReference: r.showReference !== false,
    showOrderNotes: r.showOrderNotes !== false,
    showItemOptions: r.showItemOptions !== false,
    showBs: r.showBs !== false
  };
  const settings = {
    whatsappNumber: String(s.whatsappNumber), orderModes: modes.length ? modes : ['delivery', 'pickup'],
    deliveryFeeUSD: s.deliveryFeeUSD === null || s.deliveryFeeUSD === '' || s.deliveryFeeUSD === undefined ? null : num(s.deliveryFeeUSD, 0, 999),
    usdToVes: num(s.usdToVes, 0.0001, 100_000_000, 4), exchangeRateDate: String(s.exchangeRateDate),
    exchangeRateName: str(s.exchangeRateName, 80) || 'Tasa BCV actualizada por Cochi',
    paymentInfo: str(s.paymentInfo, 500), receipt
  };
  const seen = new Set();
  const products = list(c.products, 200).map(p => {
    const id = slug(p.slug);
    if (seen.has(id)) throw bad(`Producto repetido: ${id}`); seen.add(id);
    const name = str(p.name, 80); if (!name) throw bad('Todos los productos necesitan nombre.');
    return {
      id, slug: id, name, tag: str(p.tag, 16), category: str(p.category, 40) || 'Otros', description: str(p.description, 420), price_usd: num(p.price_usd, 0, 9999),
      image: image(p.image), available: p.available !== false, availability_days: list(p.availability_days, 7).map(d => num(d, 0, 6, 0)),
      is_visible: p.is_visible !== false, is_coming_soon: Boolean(p.is_coming_soon), featured: Boolean(p.featured), brand: p.brand === 'dulce' ? 'dulce' : 'cochi',
      sort_order: num(p.sort_order ?? 999, 0, 99999, 0),
      options: list(p.options, 12).map(g => ({
        id: str(g.id, 40), name: str(g.name, 60), type: g.type === 'multiple' ? 'multiple' : 'single', required: Boolean(g.required),
        ...(g.min == null ? {} : { min: num(g.min, 0, 99, 0) }), ...(g.max == null ? {} : { max: num(g.max, 0, 99, 0) }),
        choices: list(g.choices, 40).map(o => ({ id: str(o.id, 40), label: str(o.label, 80), price_usd: num(o.price_usd ?? 0, 0, 999) }))
      }))
    };
  });
  const flyers = list(c.flyers, 20).map(f => ({ id: str(f.id, 20) || rid(), title: str(f.title, 70), text: str(f.text, 220), image: image(f.image), badge: str(f.badge, 16), link: link(f.link), linkLabel: str(f.linkLabel, 26), active: f.active !== false, ...span(f) })).filter(f => f.image || f.title);
  const testimonials = list(c.testimonials, 30).map(t => ({ id: str(t.id, 20) || rid(), name: str(t.name, 40), text: str(t.text, 300), active: t.active !== false })).filter(t => t.text);
  const upsells = list(c.upsells, 10).map(u => ({
    id: slug(u.id), title: str(u.title, 60) || 'Sugerencia', text: str(u.text, 140), when_categories: list(u.when_categories, 10).map(x => str(x, 40)).filter(Boolean),
    add_slug: slug(u.add_slug), price_usd: num(u.price_usd, 0, 999), max_per_item: num(u.max_per_item ?? 1, 1, 5, 0), active: u.active !== false, ...span(u)
  }));
  const announcements = list(c.announcements, 8).map(a => str(a, 60)).filter(Boolean);
  return { settings, products, flyers, testimonials, upsells, announcements, updatedAt: new Date().toISOString() };
}

/* ---------- Imágenes ---------- */
const MAGIC = { 'image/webp': b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP', 'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'image/png': b => b.slice(1, 4).toString() === 'PNG' };
async function saveImage(dataUrl) {
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Formato de imagen no permitido. Usa JPG, PNG o WebP.');
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > 450 * 1024) throw bad('La imagen pesa demasiado (máximo 450 KB después de optimizarla).', 413);
  if (!MAGIC[m[1]](buffer)) throw bad('El archivo no es una imagen válida.');
  const id = crypto.randomBytes(9).toString('base64url');
  await store.set(`cochi:img:${id}`, `${m[1]}|${m[2]}`);
  return `/api/img/${id}`;
}

/* ---------- Rutas ---------- */
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '');
    const method = req.method;

    if (route === '/api/health' && method === 'GET') return send(res, 200, { ok: true, storage: store.mode, adminConfigured: configured(), node: process.version });
    if (route === '/api/content' && method === 'GET') {
      try {
        const raw = await store.get('cochi:content');
        return send(res, 200, raw ? JSON.parse(raw) : {}, { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' });
      } catch (error) {
        // Si la base de datos falla, el sitio sigue funcionando con los archivos de /data.
        console.error('API contenido:', error);
        return send(res, 200, {});
      }
    }
    if (route.startsWith('/api/img/') && method === 'GET') {
      const id = route.slice(9);
      const raw = /^[\w-]{6,40}$/.test(id) ? await store.get(`cochi:img:${id}`) : null;
      if (!raw) return send(res, 404, { error: 'Imagen no encontrada.' });
      const [type, data] = raw.split('|');
      res.statusCode = 200; res.setHeader('Content-Type', type); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.end(Buffer.from(data, 'base64'));
    }
    if (!route.startsWith('/api/admin/')) return send(res, 404, { error: 'No encontrado.' });
    if (method !== 'GET' && (!sameOrigin(req) || !/application\/json/.test(req.headers['content-type'] || ''))) throw bad('Solicitud no permitida.', 403);

    if (route === '/api/admin/login' && method === 'POST') {
      if (!configured()) throw bad('El panel aún no está configurado. Define ADMIN_EMAIL, ADMIN_PASSWORD y SESSION_SECRET (ver README).', 503);
      throttle(req);
      const body = await readBody(req);
      const ok = same(String(body.email || '').trim().toLowerCase(), creds().email) & same(String(body.password || ''), creds().pass);
      if (!ok) { await new Promise(r => setTimeout(r, 450)); throw bad('Correo o contraseña incorrectos.', 401); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, makeToken(creds().email), SESSION_MS / 1000) });
    }
    if (route === '/api/admin/logout' && method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });

    const session = readSession(req);
    if (route === '/api/admin/session' && method === 'GET') return send(res, 200, { authenticated: Boolean(session), email: session?.e || null, configured: configured(), storage: store.mode });
    if (!session) throw bad('Inicia sesión para continuar.', 401);

    if (route === '/api/admin/content' && method === 'GET') { const raw = await store.get('cochi:content'); return send(res, 200, { content: raw ? JSON.parse(raw) : null, storage: store.mode }); }
    if (route === '/api/admin/content' && method === 'PUT') {
      const body = await readBody(req, 1_900_000);
      const content = cleanContent(body.content);
      await store.set('cochi:content', JSON.stringify(content));
      return send(res, 200, { ok: true, updatedAt: content.updatedAt });
    }
    if (route === '/api/admin/upload' && method === 'POST') { const body = await readBody(req, 900_000); return send(res, 200, { url: await saveImage(body.dataUrl) }); }
    return send(res, 404, { error: 'No encontrado.' });
  } catch (error) {
    const status = error.status || 500;
    if (!error.status) console.error('API:', error);
    if (res.headersSent) return res.end();
    send(res, status, { error: error.status ? error.message : 'Ocurrió un error interno. Inténtalo de nuevo.' });
  }
}
module.exports = { handle, cleanContent };
