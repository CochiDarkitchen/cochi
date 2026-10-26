const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  const dynamicIds = new Set(['modalQtyMinus', 'modalQtyValue', 'modalQtyPlus', 'saveProductToCart', 'productDialogError', 'productNote']);
  assert.deepEqual([...appStaticIds].filter(id => !htmlIds.has(id) && !dynamicIds.has(id)), [], 'El frontend no debe buscar elementos inexistentes.');
  ok('Tasa manual, WhatsApp sin precios, depósito antes de preparar, horario y referencias HTML validados.');

  const port = 4184;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
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
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin.html`)).status, 404, 'No debe existir un panel Admin público.');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/bcv`)).status, 404, 'No debe depender de la API de tasa.');
    ok('Servidor local: página, catálogo, ajustes e imágenes accesibles; Admin y API innecesarios eliminados.');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('\nTodas las pruebas terminaron correctamente.');
})().catch(error => {
  console.error('\nFALLO DE PRUEBAS:', error.message);
  process.exitCode = 1;
});
