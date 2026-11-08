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
const hhmm = v => { const t = String(v ?? ''); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw bad('Hora inválida. Usa el formato HH:MM.'); return t; };
const rid = () => crypto.randomBytes(5).toString('hex');

function cleanContent(input) {
  const c = input && typeof input === 'object' ? input : {};
  const s = c.settings || {};
  if (!/^\d{8,15}$/.test(String(s.whatsappNumber))) throw bad('El número de WhatsApp debe tener solo números (con código de país).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.exchangeRateDate))) throw bad('La fecha de la tasa no es válida.');
  const modes = ['delivery', 'pickup'].filter(m => list(s.orderModes, 4).includes(m));
  const settings = {
    whatsappNumber: String(s.whatsappNumber), orderModes: modes.length ? modes : ['delivery', 'pickup'],
    deliveryFeeUSD: s.deliveryFeeUSD === null || s.deliveryFeeUSD === '' || s.deliveryFeeUSD === undefined ? null : num(s.deliveryFeeUSD, 0, 999),
    usdToVes: num(s.usdToVes, 0.0001, 100_000_000, 4), exchangeRateDate: String(s.exchangeRateDate),
    exchangeRateName: str(s.exchangeRateName, 80) || 'Tasa BCV actualizada por Cochi',
    paymentInfo: str(s.paymentInfo, 500), ordersPaused: Boolean(s.ordersPaused),
    schedule: [0, 1, 2, 3, 4, 5, 6].map(day => { const r = list(s.schedule, 7).find(x => Number(x.day) === day) || {}; return { day, open: s.schedule ? r.open === true : [0, 5, 6].includes(day), from: hhmm(r.from ?? '00:00'), to: hhmm(r.to ?? '23:59') }; })
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
    add_slug: slug(u.add_slug), price_usd: num(u.price_usd, 0, 999), max_per_item: num(u.max_per_item ?? 1, 1, 5, 0), active: u.active !== false, start_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(u.start_time || '')) ? String(u.start_time) : '', end_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(u.end_time || '')) ? String(u.end_time) : '', days: Array.isArray(u.days) ? [...new Set(u.days.map(d => num(d, 0, 6, 0)))] : [], ...span(u)
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

/* ---------- Cupones ---------- */
const normCode = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
const normPhone = v => String(v ?? '').replace(/\D/g, '').slice(-10);
const caracasToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
const money2 = n => Math.round(n * 100) / 100;
const publicHits = new Map();
function throttlePublic(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(); const entry = (publicHits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (entry.length >= 40) throw bad('Demasiados intentos. Espera unos minutos e inténtalo otra vez.', 429);
  entry.push(now); publicHits.set(ip, entry);
}
async function loadCoupons() {
  const empty = { enabled: false, coupons: [] };
  try { const raw = await store.get('cochi:coupons'); const c = raw ? JSON.parse(raw) : null; return c && Array.isArray(c.coupons) ? c : empty; } catch { return empty; }
}
function cleanCoupons(input) {
  const c = input && typeof input === 'object' ? input : {}; const seen = new Set();
  const coupons = list(c.coupons, 100).map(x => {
    const code = normCode(x.code);
    if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw bad(`Código de cupón inválido: "${str(x.code, 20)}". Usa de 3 a 20 letras o números.`);
    if (seen.has(code)) throw bad(`Cupón repetido: ${code}`); seen.add(code);
    const type = x.type === 'fixed' ? 'fixed' : 'percent';
    return { code, label: str(x.label, 60), type, value: type === 'percent' ? num(x.value, 1, 100, 0) : num(x.value, 0.01, 999), max_uses: num(x.max_uses ?? 0, 0, 100000, 0), per_customer: Boolean(x.per_customer), phone: String(x.phone ?? '').replace(/\D/g, '').slice(-15), min_order_usd: num(x.min_order_usd ?? 0, 0, 999), active: x.active !== false, ...span(x) };
  });
  return { enabled: Boolean(c.enabled), coupons };
}
// Revisa el cupón. Con redeem=true además cuenta el uso (una sola vez por número de pedido).

async function readCustomers() {
  const raw = await store.get('cochi:customers');
  let customers = [];
  try { customers = raw ? JSON.parse(raw) : []; } catch {}
  return Array.isArray(customers) ? customers : [];
}
async function readOrders() {
  const raw = await store.get('cochi:orders');
  let saved = [];
  try { saved = raw ? JSON.parse(raw) : []; } catch {}
  if (!Array.isArray(saved)) saved = [];
  // Compatibilidad: incorpora el historial que las versiones anteriores solo guardaban
  // dentro de cada ficha de cliente. El ID evita duplicados al mezclar ambos formatos.
  const byId = new Map();
  saved.forEach(o => { if (o && o.id) byId.set(String(o.id), o); });
  const customers = await readCustomers();
  customers.forEach(c => (Array.isArray(c.orders) ? c.orders : []).forEach(o => {
    if (o && o.id && !byId.has(String(o.id))) byId.set(String(o.id), o);
  }));
  return [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 10000);
}
async function saveCustomerOrder(body) {
  const name = str(body.name, 100);
  const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 30);
  const orderId = str(body.orderId, 40);
  if (!name || phone.replace(/\D/g, '').length < 7) throw bad('Se necesita nombre y teléfono válido para registrar el pedido.');
  if (!/^CH-\d{4}-\d{4}$/.test(orderId)) throw bad('Número de pedido inválido.');
  const createdAt = new Date().toISOString();
  const items = list(body.items, 80).map(x => ({
    name: str(x.name, 100), quantity: num(x.quantity, 1, 99, 0), unitPrice: num(x.unitPrice, 0, 9999),
    lineTotal: num(x.lineTotal ?? (Number(x.unitPrice || 0) * Number(x.quantity || 1)), 0, 999999),
    promo: str(x.promo, 80), note: str(x.note, 240),
    options: list(x.options, 20).map(o => ({ groupName: str(o.groupName, 60), choiceLabel: str(o.choiceLabel, 80), quantity: num(o.quantity ?? 1, 1, 99, 0) }))
  })).filter(x => x.name);
  const order = {
    id: orderId, createdAt, updatedAt: createdAt, status: 'pending', name, phone,
    email: str(body.email, 120), address: str(body.address, 220), sector: str(body.sector, 120),
    reference: str(body.reference, 180), mode: body.mode === 'pickup' ? 'pickup' : 'delivery',
    notes: str(body.notes, 500), marketingConsent: Boolean(body.marketingConsent),
    marketingChannel: body.marketingChannel === 'email' ? 'email' : 'whatsapp',
    items,
    productsTotal: num(body.productsTotal ?? body.total, 0, 100000),
    discount: num(body.discount ?? 0, 0, 100000), couponCode: str(body.couponCode, 30),
    total: num(body.total, 0, 100000), deliveryFeeUSD: null, finalTotalUSD: null,
    rateUsdToVes: body.rateUsdToVes == null ? null : num(body.rateUsdToVes, 0.0001, 100000000, 4),
    rateDate: day(body.rateDate)
  };
  const orders = await readOrders();
  if (orders.some(o => String(o.id) === orderId)) return { ok: true, duplicate: true };
  orders.unshift(order);
  await store.set('cochi:orders', JSON.stringify(orders.slice(0, 10000)));

  const customers = await readCustomers();
  const normalized = phone.replace(/\D/g, '');
  let customer = customers.find(c => String(c.phone || '').replace(/\D/g, '') === normalized);
  if (!customer) {
    customer = { id: crypto.randomBytes(8).toString('hex'), name, phone, email: order.email, address: order.address, sector: order.sector, reference: order.reference, marketingConsent: order.marketingConsent, marketingChannel: order.marketingChannel, marketingConsentAt: order.marketingConsent ? createdAt : null, orders: [] };
    customers.unshift(customer);
  } else {
    customer.name = name; customer.email = order.email || customer.email;
    customer.address = order.address || customer.address; customer.sector = order.sector || customer.sector;
    customer.reference = order.reference || customer.reference;
    // Una autorización previa se conserva hasta que el cliente solicite retirarla en el panel.
    if (order.marketingConsent) {
      customer.marketingConsent = true; customer.marketingChannel = order.marketingChannel;
      customer.marketingConsentAt = createdAt;
    }
  }
  customer.orders = Array.isArray(customer.orders) ? customer.orders : [];
  if (!customer.orders.some(o => o.id === order.id)) customer.orders.unshift(order);
  customer.orders = customer.orders.slice(0, 30);
  await store.set('cochi:customers', JSON.stringify(customers.slice(0, 500)));
  return { ok: true };
}
async function updateCustomerConsent(id, consent) {
  const customers = await readCustomers();
  const customer = customers.find(c => String(c.id) === id);
  if (!customer) throw bad('No se encontró ese cliente.', 404);
  customer.marketingConsent = Boolean(consent);
  if (!consent) customer.marketingConsentAt = null;
  await store.set('cochi:customers', JSON.stringify(customers));
  return customer;
}
async function confirmOrder(orderId, body) {
  const orders = await readOrders();
  const order = orders.find(o => String(o.id) === orderId);
  if (!order) throw bad('No se encontró esa comanda.', 404);
  const deliveryFeeUSD = order.mode === 'delivery' ? num(body.deliveryFeeUSD, 0, 999) : 0;
  const base = Math.max(0, Number(order.total ?? order.productsTotal ?? 0) || 0);
  order.deliveryFeeUSD = deliveryFeeUSD;
  order.finalTotalUSD = Math.round((base + deliveryFeeUSD) * 100) / 100;
  order.status = 'confirmed';
  order.confirmedAt = new Date().toISOString();
  order.updatedAt = order.confirmedAt;
  await store.set('cochi:orders', JSON.stringify(orders));
  const customers = await readCustomers();
  let changed = false;
  for (const customer of customers) {
    const previous = (Array.isArray(customer.orders) ? customer.orders : []).find(o => String(o.id) === orderId);
    if (previous) { Object.assign(previous, order); changed = true; }
  }
  if (changed) await store.set('cochi:customers', JSON.stringify(customers));
  return order;
}
async function useCoupon(body, redeem) {
  const cfg = await loadCoupons(); const code = normCode(body.code); const c = cfg.coupons.find(x => x.code === code);
  if (!cfg.enabled || !c || !c.active) throw bad('Ese cupón no existe o no está disponible.', 404);
  const subtotal = Math.max(0, Number(body.subtotal) || 0);
  const summary = { code, label: c.label, type: c.type, value: c.value, discount: money2(c.type === 'percent' ? subtotal * c.value / 100 : Math.min(c.value, subtotal)) };
  const orderId = String(body.orderId || ''); const ordersKey = `cochi:cuporders:${code}`;
  if (redeem) { if (!/^CH-\d{4}-\d{4}$/.test(orderId)) throw bad('Número de pedido inválido.'); if (await store.sismember(ordersKey, orderId)) return summary; }
  const today = caracasToday();
  if ((c.start && today < c.start) || (c.end && today > c.end)) throw bad('Este cupón no está vigente.');
  const phone = normPhone(body.phone);
  if ((c.phone || c.per_customer) && phone.length < 7) throw bad('Escribe tu teléfono de contacto para usar este cupón.');
  if (c.phone && normPhone(c.phone) !== phone) throw bad('Este cupón es personal y no corresponde a este teléfono.');
  if (c.min_order_usd && subtotal < c.min_order_usd) throw bad(`Este cupón aplica desde $${c.min_order_usd.toFixed(2)} en productos.`);
  const useKey = `cochi:cupuse:${code}`; const phonesKey = `cochi:cupphones:${code}`;
  if (c.max_uses && Number((await store.get(useKey)) || 0) >= c.max_uses) throw bad('Este cupón ya no tiene usos disponibles.');
  if (c.per_customer && await store.sismember(phonesKey, phone)) throw bad('Ya usaste este cupón con este teléfono.');
  if (!redeem) return summary;
  await store.sadd(ordersKey, orderId);
  let phoneAdded = false;
  if (c.per_customer) { phoneAdded = Boolean(await store.sadd(phonesKey, phone)); if (!phoneAdded) { await store.srem(ordersKey, orderId); throw bad('Ya usaste este cupón con este teléfono.'); } }
  const used = await store.incr(useKey);
  if (c.max_uses && used > c.max_uses) { await store.incr(useKey, -1); await store.srem(ordersKey, orderId); if (phoneAdded) await store.srem(phonesKey, phone); throw bad('Este cupón ya no tiene usos disponibles.'); }
  return summary;
}

/* ---------- Rutas ---------- */
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    // En Vercel, vercel.json reescribe /api/ruta/subruta a /api/_handler
    // y pasa la ruta original en __cochi_path. En local llega la ruta normal.
    const forwardedPath = url.searchParams.get('__cochi_path') ?? req.query?.__cochi_path;
    const forwardedRoute = Array.isArray(forwardedPath) ? forwardedPath.join('/') : forwardedPath;
    const route = (forwardedRoute !== undefined && forwardedRoute !== null)
      ? `/api/${String(forwardedRoute).replace(/^\/+/, '')}`.replace(/\/+$/, '')
      : url.pathname.replace(/\/+$/, '');
    const method = req.method;

    if (route === '/api/health' && method === 'GET') return send(res, 200, { ok: true, storage: store.mode, adminConfigured: configured(), node: process.version });
    if (route === '/api/content' && method === 'GET') {
      try {
        const raw = await store.get('cochi:content');
        const out = raw ? JSON.parse(raw) : {};
        out.couponsEnabled = await loadCoupons().then(c => c.enabled).catch(() => false);
        return send(res, 200, out, { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' });
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
    if (route.startsWith('/api/coupon/') && method === 'POST') {
      if (!sameOrigin(req) || !/application\/json/.test(req.headers['content-type'] || '')) throw bad('Solicitud no permitida.', 403);
      throttlePublic(req);
      const body = await readBody(req, 20_000);
      if (route === '/api/coupon/check') return send(res, 200, { ok: true, coupon: await useCoupon(body, false) });
      if (route === '/api/coupon/redeem') return send(res, 200, { ok: true, coupon: await useCoupon(body, true) });
    }
    if (route === '/api/orders' && method === 'POST') {
      if (!sameOrigin(req) || !/application\/json/.test(req.headers['content-type'] || '')) throw bad('Solicitud no permitida.', 403);
      throttlePublic(req);
      const body = await readBody(req, 80_000);
      return send(res, 200, await saveCustomerOrder(body));
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

    if (route === '/api/admin/customers' && method === 'GET') {
      store.ensureAvailable();
      const raw = await store.get('cochi:customers');
      let customers = []; try { customers = raw ? JSON.parse(raw) : []; } catch {}
      return send(res, 200, { customers: Array.isArray(customers) ? customers : [] }, { 'Cache-Control': 'no-store' });
    }
    if (route === '/api/admin/orders' && method === 'GET') {
      store.ensureAvailable();
      return send(res, 200, { orders: await readOrders() }, { 'Cache-Control': 'no-store' });
    }
    if (route.startsWith('/api/admin/orders/') && method === 'PUT') {
      const orderId = route.slice('/api/admin/orders/'.length);
      if (!/^CH-\d{4}-\d{4}$/.test(orderId)) throw bad('Número de comanda inválido.');
      const body = await readBody(req, 20_000);
      return send(res, 200, { ok: true, order: await confirmOrder(orderId, body) });
    }
    if (route.startsWith('/api/admin/customers/') && method === 'PUT') {
      const customerId = route.slice('/api/admin/customers/'.length);
      if (!/^[a-f0-9]{8,40}$/i.test(customerId)) throw bad('Identificador de cliente inválido.');
      const body = await readBody(req, 10_000);
      if (typeof body.marketingConsent !== 'boolean') throw bad('Indica el estado de autorización.');
      const customer = await updateCustomerConsent(customerId, body.marketingConsent);
      return send(res, 200, { ok: true, customer: { id: customer.id, marketingConsent: customer.marketingConsent } });
    }
    if (route === '/api/admin/content' && method === 'GET') { const raw = await store.get('cochi:content'); return send(res, 200, { content: raw ? JSON.parse(raw) : null, storage: store.mode }); }
    if (route === '/api/admin/content' && method === 'PUT') {
      const body = await readBody(req, 1_900_000);
      const content = cleanContent(body.content);
      await store.set('cochi:content', JSON.stringify(content));
      return send(res, 200, { ok: true, updatedAt: content.updatedAt });
    }
    if (route === '/api/admin/coupons' && method === 'GET') {
      const cfg = await loadCoupons();
      const coupons = await Promise.all(cfg.coupons.map(async c => ({ ...c, uses: Number((await store.get(`cochi:cupuse:${c.code}`)) || 0) })));
      return send(res, 200, { coupons: { enabled: cfg.enabled, coupons } });
    }
    if (route === '/api/admin/coupons' && method === 'PUT') {
      const body = await readBody(req, 200_000);
      await store.set('cochi:coupons', JSON.stringify(cleanCoupons(body.coupons)));
      return send(res, 200, { ok: true });
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
module.exports = { handle, cleanContent, cleanCoupons, useCoupon };
