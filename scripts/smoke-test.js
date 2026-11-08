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
const adminJs = fs.readFileSync(path.join(publicDir, 'admin/admin.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(publicDir, 'admin/admin.css'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const singleApiRoute = path.join(root, 'api', '_handler.js');
function listApiJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listApiJavaScriptFiles(fullPath) : (entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : []);
  });
}

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
  assert.ok(app.includes('function isOrderDay') && app.includes('scheduleList') && app.includes('ordersPaused'), 'Los pedidos dependen del horario editable del panel.');
  assert.ok(app.includes('La preparación del pedido comienza únicamente después de que Cochi reciba el depósito acordado.'), 'WhatsApp debe comunicar la condición del depósito.');
  assert.ok(html.includes('La preparación comienza únicamente después de recibir el depósito acordado.'), 'La web debe comunicar cuándo comienza la preparación.');
  const messageBuilder = app.slice(app.indexOf('function buildWhatsAppMessage'), app.indexOf('function handleCheckoutSubmit'));
  assert.ok(messageBuilder.includes('Monto final') || messageBuilder.includes('monto final'));
  assert.ok(messageBuilder.includes('DETALLE DEL PEDIDO') && messageBuilder.includes('currencyUSD'), 'La factura de WhatsApp debe incluir el detalle con precios.');
  assert.ok(!messageBuilder.includes('currencyVES') && !messageBuilder.includes('cartGrandTotal'), 'El total final con entrega y los bolívares los confirma Cochi por el chat.');
  assert.ok(html.includes('TRABAJAMOS DE VIERNES A DOMINGO') && html.includes('orderScheduleNote'));
  assert.ok(html.includes('Quiero recibir ofertas y cupones de Cochi por WhatsApp.'), 'El consentimiento debe especificar el canal de promociones.');
  assert.ok(!html.includes('/admin.html') && !app.includes('supabaseUrl') && !app.includes('/api/bcv') && !app.includes('/api/config'), 'La experiencia pública no debe depender de Admin, Supabase ni APIs de tasa.');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const appStaticIds = new Set([...app.matchAll(/\$\('#([A-Za-z][A-Za-z0-9_-]*)'/g)].map(match => match[1]));
  const dynamicIds = new Set(['modalQtyMinus', 'modalQtyValue', 'modalQtyPlus', 'saveProductToCart', 'productDialogError', 'productNote', 'upsellCheck']);
  assert.deepEqual([...appStaticIds].filter(id => !htmlIds.has(id) && !dynamicIds.has(id)), [], 'El frontend no debe buscar elementos inexistentes.');
  assert.ok(app.includes('productsTotal: cartProductTotal()') && app.includes('lineTotal: lineUnitPrice(item) * item.quantity'), 'Los pedidos deben conservar importes y detalle por línea.');
  ok('Tasa manual, factura de WhatsApp con detalle (sin total final), depósito antes de preparar, horario y referencias HTML validados.');

  const port = 4184;
  const child = spawn(process.execPath, ['scripts/dev-server.js'], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_EMAIL: 'dueno@cochi.test', ADMIN_PASSWORD: 'clave-de-prueba-123', SESSION_SECRET: 'secreto-de-prueba-largo-123', COCHI_STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cochi-test-')) }, stdio: 'ignore' });
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
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true); assert.equal(health.adminConfigured, true); assert.ok(!JSON.stringify(health).includes('clave-de-prueba'), 'El diagnóstico no debe revelar secretos.');
    ok('Servidor local: página, catálogo, ajustes e imágenes accesibles.');

    // ---- Panel admin y API ----
    const json = { 'Content-Type': 'application/json' };
    const adminPage = await fetch(`${base}/admin/`);
    assert.equal(adminPage.status, 200); assert.equal(adminPage.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(`${base}/data/extras.json`)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/api/content`)).json(), { couponsEnabled: false }, 'Sin cambios guardados, el sitio usa los archivos de /data.');
    assert.equal((await fetch(`${base}/api/admin/content`)).status, 401, 'El contenido de admin exige sesión.');
    const wrong = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'dueno@cochi.test', password: 'incorrecta' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'DUENO@cochi.test', password: 'clave-de-prueba-123' }) });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') || '';
    assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), 'La sesión debe ser HttpOnly y SameSite=Strict.');
    const auth = { ...json, Cookie: setCookie.split(';')[0] };
    // ---- Historial de pedidos, estadísticas y autorización de campañas ----
    const orderTest = { orderId: 'CH-1107-9876', name: 'Cliente de prueba', phone: '584121234567', email: 'prueba@cochi.test', address: 'Calle 1, casa 2', sector: 'Centro', reference: 'Portón azul', mode: 'delivery', notes: 'Sin cebolla', marketingConsent: true, marketingChannel: 'whatsapp', items: [{ name: 'Shawarma César', quantity: 2, unitPrice: 8, lineTotal: 16, options: [{ groupName: 'Salsa', choiceLabel: 'César', quantity: 1 }], note: 'Extra salsa' }], productsTotal: 16, discount: 1, couponCode: 'COCHI10', total: 15, rateUsdToVes: 900, rateDate: '2026-11-07' };
    const orderSaved = await fetch(`${base}/api/orders`, { method: 'POST', headers: json, body: JSON.stringify(orderTest) });
    assert.equal(orderSaved.status, 200, 'El sitio debe guardar el pedido en el historial privado.');
    const ordersBefore = await (await fetch(`${base}/api/admin/orders`, { headers: auth })).json();
    const pendingTest = ordersBefore.orders.find(o => o.id === orderTest.orderId);
    assert.ok(pendingTest && pendingTest.status === 'pending');
    assert.equal(pendingTest.items[0].options[0].choiceLabel, 'César', 'La comanda debe conservar las opciones del producto.');
    const orderConfirmed = await fetch(`${base}/api/admin/orders/${orderTest.orderId}`, { method: 'PUT', headers: auth, body: JSON.stringify({ deliveryFeeUSD: 2.5 }) });
    assert.equal(orderConfirmed.status, 200);
    const confirmedBody = await orderConfirmed.json();
    assert.equal(confirmedBody.order.finalTotalUSD, 17.5, 'El total debe sumar delivery una sola vez sobre el subtotal.');
    assert.equal(confirmedBody.order.status, 'confirmed');
    const customersBefore = await (await fetch(`${base}/api/admin/customers`, { headers: auth })).json();
    const testCustomer = customersBefore.customers.find(c => c.phone === orderTest.phone);
    assert.ok(testCustomer && testCustomer.marketingConsent, 'El cliente con autorización debe aparecer en el panel.');
    const revoke = await fetch(`${base}/api/admin/customers/${testCustomer.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ marketingConsent: false }) });
    assert.equal(revoke.status, 200, 'El panel debe permitir retirar la autorización de promociones.');
    assert.ok(adminJs.includes("['comandas', 'Comandas']") && adminJs.includes("['estadisticas', 'Estadísticas']") && adminJs.includes('prepareCampaign'), 'El panel debe incluir comandas, estadísticas y campañas.');
    assert.ok(adminJs.includes('@page{size:58mm auto') && adminJs.includes('Imprimir otra vez') && adminCss.includes('.bar-track'), 'La comanda térmica y las barras estadísticas deben estar preparadas.');
    ok('Pedidos: historial completo, datos de opciones, confirmación del delivery, total final y revocación de consentimiento validados.');
    const apiFiles = listApiJavaScriptFiles(path.join(root, 'api'));
    assert.deepEqual(apiFiles.map(file => path.relative(root, file).split(path.sep).join('/')), ['api/_handler.js'], 'En el plan Hobby debe existir una sola función API.');
    const vercelEntry = require(singleApiRoute);
    assert.equal(typeof vercelEntry, 'function', 'La única función API de Vercel debe exportar un manejador válido.');
    const simulatedVercel = require('node:http').createServer((req, res) => vercelEntry(req, res));
    await new Promise(resolve => simulatedVercel.listen(4185, '127.0.0.1', resolve));
    try {
      const routedHealth = await fetch('http://127.0.0.1:4185/api/_handler?__cochi_path=health');
      assert.equal(routedHealth.status, 200, 'La ruta reescrita /api/health debe llegar a la función única.');
      assert.equal((await routedHealth.json()).ok, true);
      const routedSession = await fetch('http://127.0.0.1:4185/api/_handler?__cochi_path=admin%2Fsession');
      assert.equal(routedSession.status, 200, 'Las rutas API de varios niveles deben llegar a la función única.');
      assert.equal((await routedSession.json()).authenticated, false);
    } finally { await new Promise(resolve => simulatedVercel.close(resolve)); }
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    assert.ok(vercelConfig.rewrites.some(rule => rule.source === '/api/:path*' && rule.destination === '/api/_handler?__cochi_path=:path*'), 'Vercel debe redirigir todos los endpoints al manejador único.');
    ok('Enrutamiento Vercel: una sola función y rewrite probado para rutas simples y anidadas de la API.');
    const couponRead = await fetch(`${base}/api/admin/coupons`, { headers: auth });
    assert.equal(couponRead.status, 200, 'El panel debe poder leer los cupones.');
    assert.deepEqual((await couponRead.json()).coupons, { enabled: false, coupons: [] });
    const couponConfig = { enabled: true, coupons: [{ code: 'COCHI10', label: 'Prueba', type: 'percent', value: 10, max_uses: 2, per_customer: true, phone: '', min_order_usd: 0, active: true, start: '', end: '' }] };
    const couponWrite = await fetch(`${base}/api/admin/coupons`, { method: 'PUT', headers: auth, body: JSON.stringify({ coupons: couponConfig }) });
    assert.equal(couponWrite.status, 200, 'El panel debe poder guardar los cupones.');
    const couponSaved = await (await fetch(`${base}/api/admin/coupons`, { headers: auth })).json();
    assert.equal(couponSaved.coupons.enabled, true);
    assert.equal(couponSaved.coupons.coupons[0].code, 'COCHI10');
    assert.equal(couponSaved.coupons.coupons[0].uses, 0);
    const couponCheck = await fetch(`${base}/api/coupon/check`, { method: 'POST', headers: json, body: JSON.stringify({ code: 'COCHI10', phone: '04121234567', subtotal: 20 }) });
    assert.equal(couponCheck.status, 200, 'El sitio debe validar un cupón activo.');
    assert.equal((await couponCheck.json()).coupon.discount, 2);
    const couponRedeem = await fetch(`${base}/api/coupon/redeem`, { method: 'POST', headers: json, body: JSON.stringify({ code: 'COCHI10', phone: '04121234567', subtotal: 20, orderId: 'CH-2026-0001' }) });
    assert.equal(couponRedeem.status, 200, 'El sitio debe registrar el uso de un cupón.');
    const couponAfterUse = await (await fetch(`${base}/api/admin/coupons`, { headers: auth })).json();
    assert.equal(couponAfterUse.coupons.coupons[0].uses, 1, 'El uso del cupón debe reflejarse en el panel.');
    assert.equal((await (await fetch(`${base}/api/content`)).json()).couponsEnabled, true, 'La tienda debe conocer si los cupones están activados.');
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
    ok('Cupones: lectura y guardado desde el panel, validación pública y conteo de usos comprobados.')
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
