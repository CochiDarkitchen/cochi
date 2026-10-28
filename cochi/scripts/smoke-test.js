const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'public/data/products.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'public/admin.js'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');

function ok(message) { console.log(`✓ ${message}`); }

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
  assert.equal(catalog.length, 30, 'El menú debe contener 30 artículos (incluidas novedades futuras).');
  const slugs = catalog.map(p => p.slug);
  assert.equal(new Set(slugs).size, catalog.length, 'No deben repetirse los slugs.');
  for (const p of catalog) {
    assert.ok(p.name && p.category && p.description, `Faltan datos de producto: ${p.slug}`);
    assert.ok(Number.isFinite(p.price_usd) && p.price_usd >= 0, `Precio inválido: ${p.slug}`);
    assert.ok(p.price_usd > 0 || p.is_coming_soon, `Un producto comprable debe tener precio positivo: ${p.slug}`);
    if (p.image) {
      assert.ok(p.image.startsWith('/assets/'), `La imagen debe ser un recurso local seguro: ${p.slug}`);
      assert.ok(fs.existsSync(path.join(root, 'public', p.image.replace(/^\//, ''))), `No existe la imagen: ${p.slug} (${p.image})`);
    }
    for (const group of p.options || []) {
      assert.ok(group.id && group.name && Array.isArray(group.choices) && group.choices.length, `Grupo de opciones incompleto en ${p.slug}`);
      assert.ok(Number(group.min ?? (group.required ? 1 : 0)) >= 0, `Mínimo inválido en ${p.slug}`);
      assert.ok(Number(group.max ?? 99) >= Number(group.min ?? 0), `Máximo inválido en ${p.slug}`);
    }
  }
  ok(`Catálogo JSON válido: ${catalog.length} artículos, precios y opciones revisados.`);

  const soon = catalog.filter(p => p.is_coming_soon);
  assert.deepEqual(soon.map(p => p.slug).sort(), ['brownies-proximamente', 'sorpresa-dulce-proximamente']);
  assert.ok(soon.every(p => p.price_usd === 0 && p.is_coming_soon), 'Las novedades próximas deben seguir marcadas como no comprables.');
  const sunday = catalog.filter(p => p.category === 'Pollo asado');
  assert.equal(sunday.length, 2);
  assert.ok(sunday.every(p => JSON.stringify(p.availability_days) === '[0]'));
  const sauces = catalog.find(p => p.slug === 'racion-alitas');
  assert.equal(sauces.options[0].required, true);
  assert.equal(sauces.options[0].choices.length, 4);
  ok('Novedades futuras, regla del domingo y selección obligatoria de salsas revisadas.');

  const seedSlugs = new Set(seed.split(/\r?\n/).map(line => line.match(/^\s*\('([^']+)',\s*'([^']+)'/)).filter(Boolean).map(match => match[1]));
  assert.equal(seedSlugs.size, catalog.length, 'El seed SQL debe tener 30 slugs de producto.');
  for (const slug of slugs) assert.ok(seedSlugs.has(slug), `El catálogo SQL no tiene el slug ${slug}.`);
  assert.ok(schema.includes("('whatsapp_number_confirmed', 'false'::jsonb)") && schema.includes("('order_modes_confirmed', 'false'::jsonb)"), 'La configuración inicial no debe fingir que los datos comerciales están confirmados.');
  assert.ok(schema.includes("'whatsapp_number_confirmed','delivery_fee_usd','order_modes','order_modes_confirmed'"), 'La política de lectura debe incluir solo las claves públicas necesarias.');
  ok('El seed de productos coincide con el catálogo y el esquema deja las confirmaciones comerciales apagadas.');

  const mainIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const adminIds = new Set([...adminHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const appRefs = new Set([...app.matchAll(/\$\('#([A-Za-z][A-Za-z0-9_-]*)'/g)].map(match => match[1]));
  const adminRefs = new Set([...adminJs.matchAll(/\$\('#([A-Za-z][A-Za-z0-9_-]*)'/g)].map(match => match[1]));
  const dynamicDialogIds = new Set(['modalQtyMinus', 'modalQtyValue', 'modalQtyPlus', 'saveProductToCart', 'productDialogError', 'productNote']);
  const missingMain = [...appRefs].filter(id => !mainIds.has(id) && !dynamicDialogIds.has(id));
  const dynamicAdminIds = new Set(['importBaseCatalogButton']);
  const missingAdmin = [...adminRefs].filter(id => !adminIds.has(id) && !dynamicAdminIds.has(id));
  assert.deepEqual(missingMain, [], `El frontend referencia IDs inexistentes: ${missingMain.join(', ')}`);
  assert.deepEqual(missingAdmin, [], `El panel referencia IDs inexistentes: ${missingAdmin.join(', ')}`);
  for (const required of ['intro', 'menu', 'cartDrawer', 'checkoutForm', 'productDialog', 'dulceFeatured']) assert.ok(mainIds.has(required), `Falta sección esencial ${required}.`);
  ok('IDs referenciados por la aplicación y por el panel existen en sus respectivas vistas.');

  const port = 4184;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    await waitForServer(`http://127.0.0.1:${port}/`, child);
    const checks = [
      ['/', 'text/html'],
      ['/styles.css', 'text/css'],
      ['/app.js', 'javascript'],
      ['/admin.html', 'text/html'],
      ['/admin.js', 'javascript'],
      ['/data/products.json', 'application/json'],
      ['/assets/brand/cochi-logo-red.png', 'image/png'],
      ['/assets/food/shawarma-cesar.webp', 'image/webp'],
      ['/api/config', 'application/json']
    ];
    for (const [route, contentType] of checks) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 200, `${route} debe responder HTTP 200.`);
      assert.ok((response.headers.get('content-type') || '').includes(contentType), `${route} debe servir Content-Type ${contentType}.`);
      await response.arrayBuffer();
    }
    const config = await fetch(`http://127.0.0.1:${port}/api/config`).then(r => r.json());
    assert.equal(config.whatsappNumber, '584242246392');
    assert.equal(config.whatsappNumberConfirmed, false, 'El número de WhatsApp no debe figurar como confirmado de fábrica.');
    assert.equal(config.deliveryFeeUSD, null, 'La tarifa de entrega debe quedar pendiente salvo configuración expresa.');
    ok('Servidor local: páginas, recursos, catálogo y API de configuración responden correctamente.');
  } finally {
    child.kill('SIGTERM');
  }
  console.log('\nPruebas terminadas correctamente.');
})().catch(error => {
  console.error('\nFALLO DE PRUEBAS:', error.message);
  process.exitCode = 1;
});
