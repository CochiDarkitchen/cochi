const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const catalogPath = path.join(publicDir, 'data/products.json');
const settingsPath = path.join(publicDir, 'data/settings.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

function ok(message) { console.log(`OK: ${message}`); }
async function waitForServer(url, child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`El servidor local cerró con código ${child.exitCode}.`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('El servidor local no respondió en 5 segundos.');
}

(async () => {
  assert.equal(catalog.length, 30, 'El menú debe contener 30 artículos.');
  const slugs = catalog.map(p => p.slug);
  assert.equal(new Set(slugs).size, catalog.length, 'No deben repetirse los slugs.');
  for (const p of catalog) {
    assert.ok(p.name && p.category && p.description, `Faltan datos de producto: ${p.slug}`);
    assert.ok(Number.isFinite(p.price_usd) && p.price_usd >= 0, `Precio inválido: ${p.slug}`);
    assert.ok(p.price_usd > 0 || p.is_coming_soon, `Un producto comprable debe tener precio positivo: ${p.slug}`);
    if (p.image) assert.ok(fs.existsSync(path.join(publicDir, p.image.replace(/^\//, ''))), `No existe la imagen: ${p.slug}`);
    for (const group of p.options || []) {
      assert.ok(group.id && group.name && Array.isArray(group.choices) && group.choices.length, `Opciones incompletas en ${p.slug}`);
    }
  }
  ok(`Catálogo de ${catalog.length} productos válido y fácil de editar.`);

  const soon = catalog.filter(p => p.is_coming_soon);
  assert.deepEqual(soon.map(p => p.slug).sort(), ['brownies-proximamente', 'sorpresa-dulce-proximamente']);
  const sunday = catalog.filter(p => p.category === 'Pollo asado');
  assert.equal(sunday.length, 2);
  assert.ok(sunday.every(p => JSON.stringify(p.availability_days) === '[0]'));
  assert.ok(settings.whatsappNumber && /^\d+$/.test(settings.whatsappNumber), 'El WhatsApp debe estar en formato de solo números.');
  assert.ok(Number(settings.usdToVes) > 0, 'La tasa manual debe ser mayor que cero.');
  assert.match(settings.exchangeRateDate, /^\d{4}-\d{2}-\d{2}$/, 'La fecha de tasa debe usar formato AAAA-MM-DD.');
  assert.ok(settings.orderModes.includes('delivery') && settings.orderModes.includes('pickup'));
  assert.ok(app.includes("['Fri', 'Sat', 'Sun'].includes(weekday)"), 'Los pedidos solo continúan viernes, sábado y domingo.');
  assert.ok(app.includes('La preparación del pedido comienza únicamente después de que Cochi reciba el depósito acordado.'), 'WhatsApp debe comunicar la condición del depósito.');
  assert.ok(html.includes('La preparación comienza únicamente después de recibir el depósito acordado.'), 'La web debe comunicar cuándo comienza la preparación.');
  const messageBuilder = app.slice(app.indexOf('function buildWhatsAppMessage'), app.indexOf('function handleCheckoutSubmit'));
  assert.ok(messageBuilder.includes('Monto final') || messageBuilder.includes('monto final'));
  assert.ok(!messageBuilder.includes('currencyUSD') && !messageBuilder.includes('currencyVES') && !messageBuilder.includes('cartProductTotal'), 'WhatsApp no debe incluir montos calculados.');
  assert.ok(html.includes('TRABAJAMOS DE VIERNES A DOMINGO') && html.includes('orderScheduleNote'));
  assert.ok(!html.includes('/admin.html') && !app.includes('supabaseUrl') && !app.includes('/api/bcv') && !app.includes('/api/config'), 'La experiencia pública no debe depender de Admin, Supabase ni APIs de tasa.');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const appStaticIds = new Set([...app.matchAll(/\$\('#([A-Za-z][A-Za-z0-9_-]*)'/g)].map(match => match[1]));
  const dynamicIds = new Set(['modalQtyMinus', 'modalQtyValue', 'modalQtyPlus', 'saveProductToCart', 'productDialogError', 'productNote', 'upsellCheck']);
  assert.deepEqual([...appStaticIds].filter(id => !htmlIds.has(id) && !dynamicIds.has(id)), [], 'El frontend no debe buscar elementos inexistentes.');
  ok('Tasa manual, WhatsApp sin precios, depósito antes de preparar, horario y referencias HTML validados.');

  const port = 4184;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_EMAIL: 'dueno@cochi.test', ADMIN_PASSWORD: 'clave-de-prueba-123', SESSION_SECRET: 'secreto-de-prueba-largo-123', COCHI_STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cochi-test-')) }, stdio: 'ignore' });
  try {
    await waitForServer(`http://127.0.0.1:${port}/`, child);
    for (const [route, contentType] of [
      ['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'javascript'],
      ['/data/products.json', 'application/json'], ['/data/settings.json', 'application/json'],
      ['/assets/brand/cochi-logo-red.png', 'image/png'], ['/assets/food/shawarma-cesar.webp', 'image/webp']
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 200, `${route} debe responder HTTP 200.`);
      assert.ok((response.headers.get('content-type') || '').includes(contentType), `${route} debe servir el tipo correcto.`);
      if (route.includes('.json')) assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
      await response.arrayBuffer();
    }
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/admin.html`)).status, 404, 'No debe existir /admin.html suelto.');
    assert.equal((await fetch(`${base}/api/bcv`)).status, 404, 'No debe depender de la API de tasa.');
    ok('Servidor local: página, catálogo, ajustes e imágenes accesibles.');

    // ---- Panel admin y API ----
    const json = { 'Content-Type': 'application/json' };
    const adminPage = await fetch(`${base}/admin/`);
    assert.equal(adminPage.status, 200); assert.equal(adminPage.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${base}/data/extras.json`)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/content`)).json(), {}, 'Sin cambios guardados, el sitio usa los archivos de /data.');
    assert.equal((await fetch(`${base}/api/admin/content`)).status, 401, 'El contenido de admin exige sesión.');
    const wrong = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'dueno@cochi.test', password: 'incorrecta' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'DUENO@cochi.test', password: 'clave-de-prueba-123' }) });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') || '';
    assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), 'La sesión debe ser HttpOnly y SameSite=Strict.');
    const auth = { ...json, Cookie: setCookie.split(';')[0] };
    const extras = JSON.parse(fs.readFileSync(path.join(publicDir, 'data/extras.json'), 'utf8'));
    const draft = { settings, products: JSON.parse(JSON.stringify(catalog)), ...extras };
    draft.products[0].price_usd = 9.75; draft.settings.usdToVes = 901.55;
    const put = (content, headers = auth) => fetch(`${base}/api/admin/content`, { method: 'PUT', headers, body: JSON.stringify({ content }) });
    assert.equal((await put(draft)).status, 200, 'El admin debe poder guardar.');
    const published = await (await fetch(`${base}/api/content`)).json();
    assert.equal(published.products[0].price_usd, 9.75); assert.equal(published.settings.usdToVes, 901.55);
    assert.equal(published.flyers.length, extras.flyers.length); assert.equal(published.upsells[0].price_usd, 1);
    const negative = JSON.parse(JSON.stringify(draft)); negative.products[0].price_usd = -3;
    assert.equal((await put(negative)).status, 400, 'No se aceptan precios negativos.');
    const evil = JSON.parse(JSON.stringify(draft)); evil.flyers[0].link = 'javascript:alert(1)';
    assert.equal((await put(evil)).status, 400, 'No se aceptan enlaces peligrosos.');
    const evilImg = JSON.parse(JSON.stringify(draft)); evilImg.products[0].image = 'https://otro-sitio.com/x.png';
    assert.equal((await put(evilImg)).status, 400, 'Las imágenes deben ser del propio sitio.');
    assert.equal((await put(draft, { Cookie: auth.Cookie })).status, 403, 'Se exige JSON (protección contra solicitudes ajenas).');
    assert.equal((await put(draft, { ...auth, Origin: 'https://sitio-malo.com' })).status, 403, 'Se rechazan solicitudes de otros orígenes.');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
    const up = await fetch(`${base}/api/admin/upload`, { method: 'POST', headers: auth, body: JSON.stringify({ dataUrl: `data:image/webp;base64,${webp.toString('base64')}` }) });
    assert.equal(up.status, 200); const { url } = await up.json(); assert.match(url, /^\/api\/img\/[\w-]+$/);
    const served = await fetch(`${base}${url}`); assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/webp');
    const fake = await fetch(`${base}/api/admin/upload`, { method: 'POST', headers: auth, body: JSON.stringify({ dataUrl: `data:image/webp;base64,${Buffer.from('no soy una imagen').toString('base64')}` }) });
    assert.equal(fake.status, 400, 'Un archivo que no es imagen se rechaza.');
    ok('Panel admin: login, sesión segura, guardado validado, protección de origen y subida de imágenes.');
    const withExtras = JSON.parse(JSON.stringify(draft));
    withExtras.products[0].tag = 'Más pedido'; withExtras.settings.paymentInfo = 'Pago Móvil 0424-0000000'; withExtras.flyers[0].start = '2026-11-01'; withExtras.flyers[0].end = '2026-11-03';
    assert.equal((await put(withExtras)).status, 200);
    const saved = await (await fetch(`${base}/api/content`)).json();
    assert.equal(saved.products[0].tag, 'Más pedido'); assert.equal(saved.settings.paymentInfo, 'Pago Móvil 0424-0000000'); assert.equal(saved.flyers[0].end, '2026-11-03');
    const backwards = JSON.parse(JSON.stringify(withExtras)); backwards.flyers[0].end = '2026-10-01';
    assert.equal((await put(backwards)).status, 400, 'La fecha final no puede ser anterior a la inicial.');
    const badDate = JSON.parse(JSON.stringify(withExtras)); badDate.upsells[0].start = '31/10/2026';
    assert.equal((await put(badDate)).status, 400, 'Las fechas deben tener formato AAAA-MM-DD.');
    ok('Etiquetas, datos de pago y fechas de inicio/fin: se guardan y se validan.');

    // ---- App instalable y vista previa ----
    const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
    assert.equal(manifest.display, 'standalone'); assert.ok(manifest.icons.some(i => i.purpose === 'maskable'));
    for (const icon of manifest.icons) assert.equal((await fetch(`${base}${icon.src}`)).status, 200, `Falta el ícono ${icon.src}`);
    const worker = await fetch(`${base}/sw.js`); assert.equal(worker.status, 200); assert.equal(worker.headers.get('cache-control'), 'no-cache');
    assert.equal((await fetch(`${base}/offline.html`)).status, 200);
    assert.ok(/og:image"[^>]*data-abs/.test(html) && html.includes('rel="manifest"') && html.includes('rel="apple-touch-icon"'), 'Faltan etiquetas para compartir o instalar.');
    assert.ok(!app.includes('caches.open') && fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8').includes("request.mode === 'navigate'"));
    ok('App instalable (manifiesto, íconos, service worker) y etiquetas para compartir listos.');

  } finally {
    child.kill('SIGTERM');
  }
  console.log('\nTodas las pruebas terminaron correctamente.');
})().catch(error => {
  console.error('\nFALLO DE PRUEBAS:', error.message);
  process.exitCode = 1;
});
