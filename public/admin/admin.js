(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = [['tasa', 'Tasa y datos'], ['productos', 'Productos'], ['flyers', 'Flyers'], ['comentarios', 'Comentarios'], ['ofertas', 'Ofertas y avisos']];
  let data = null, tab = 'tasa', dirty = false, openSlug = null, query = '', storage = 'file', fromDefaults = false, toastTimer = null;

  async function api(path, options = {}) {
    const response = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const sinDatos = `El servidor del panel no respondió como se esperaba (código ${response.status}). Abre /api/health en tu sitio: si no muestra datos, la carpeta "api" no está publicada.`;
      throw Object.assign(new Error((body && body.error) || sinDatos), { status: response.status });
    }
    return body || {};
  }
  function toast(text, bad = false) {
    const node = $('#toast'); node.textContent = text; node.className = `toast is-on${bad ? ' is-bad' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('is-on'), 3600);
  }
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const money = n => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2);
  const bs = usd => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(usd) || 0) * (Number(data.settings.usdToVes) || 0));
  function markDirty(value = true) {
    dirty = value;
    $('#savebar').classList.toggle('is-dirty', dirty);
    $('#saveState').textContent = dirty ? 'Hay cambios sin guardar' : 'Todo guardado';
    $('#saveBtn').disabled = !dirty || storage === 'none';
  }
  function setPath(path, value) {
    const parts = path.split('.'); let target = data;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    target[parts.at(-1)] = value;
  }
  const categories = () => [...new Set(data.products.map(p => p.category))];
  const slugify = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'producto';
  const sw = (path, checked, label) => `<label class="sw"><input type="checkbox" data-b="${path}" ${checked ? 'checked' : ''}><span></span>${label}</label>`;
  const field = (label, path, value, extra = '', hint = '') => `<label class="field">${label}<input data-b="${path}" value="${esc(value)}" ${extra}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  const thumb = (src, cls = '') => `<span class="thumb">${src ? `<img src="${esc(src)}" alt="">` : '<img class="iso" src="/assets/brand/cochi-isotipo-red.png" alt="">'}</span>`.replace('class="thumb"', `class="thumb ${cls}"`);

  const windowStatus = o => { const t = today(); if (o.start && t < o.start) return ['Programada', 'soon']; if (o.end && t > o.end) return ['Vencida', 'off']; return o.start || o.end ? ['Vigente', 'on'] : ['Siempre visible', 'on']; };
  const dates = (path, o) => { const [label, kind] = windowStatus(o); return `<div class="row2">${field('Desde (opcional)', `${path}.start`, o.start || '', 'type="date" data-after="rerender"')}${field('Hasta (opcional)', `${path}.end`, o.end || '', 'type="date" data-after="rerender"')}</div><p class="chip chip--${kind}">${label}</p>`; };

  /* ---------- Pestañas ---------- */
  const VIEWS = {
    tasa() {
      const s = data.settings, sample = data.products.find(p => p.slug === 'shawarma-cesar') || data.products[0];
      return `<section class="card"><h2>Tasa BCV</h2><p class="card__intro">Cambia el valor y la fecha cada vez que cambie la tasa. Los precios en bolívares del sitio se calculan solos.</p>
        ${field('Bolívares por 1 USD', 'settings.usdToVes', s.usdToVes, 'type="number" data-t="n" step="0.01" min="0" inputmode="decimal" data-after="bs"')}
        <div class="row-inline">${field('Fecha de la tasa', 'settings.exchangeRateDate', s.exchangeRateDate, 'type="date"')}<button type="button" class="btn btn--small" data-act="today">Hoy</button></div>
        ${field('Nombre que se muestra', 'settings.exchangeRateName', s.exchangeRateName, 'maxlength="80"')}
        <p class="preview" id="ratePreview">${sample ? `${esc(sample.name)}: $${money(sample.price_usd)} = Bs. ${bs(sample.price_usd)}` : ''}</p></section>
        <section class="card"><h2>Pedidos por WhatsApp</h2>
        ${field('Número de WhatsApp', 'settings.whatsappNumber', s.whatsappNumber, 'inputmode="numeric" maxlength="15"', 'Solo números, con código de país. Ejemplo: 584242246392')}
        ${field('Costo de delivery en USD', 'settings.deliveryFeeUSD', s.deliveryFeeUSD ?? '', 'type="number" data-t="nullable" step="0.01" min="0" inputmode="decimal"', 'Déjalo vacío si el costo se coordina por WhatsApp.')}
        <label class="field">Datos para el depósito (opcional)<textarea data-b="settings.paymentInfo" maxlength="500" rows="4">${esc(s.paymentInfo)}</textarea><small>Se muestran en la pantalla de confirmación, con un botón para copiarlos. Por ejemplo: banco, cuenta, titular y cédula, o Pago Móvil.</small></label></section>`;
    },
    productos() {
      return `<div class="toolbar"><input type="search" id="q" placeholder="Buscar producto" value="${esc(query)}" aria-label="Buscar producto"><button type="button" class="btn btn--red" data-act="addProduct">Agregar</button></div><div id="plist" style="display:grid;gap:12px">${productList()}</div>`;
    },
    flyers() {
      const opts = link => {
        const sel = link ? (link.startsWith('https://') ? '__url' : link) : '';
        const base = [['', 'Sin botón'], ['#menu', 'Ir al menú'], ['#favoritos', 'Ir a favoritos'], ['#cochi-dulce', 'Ir a Cochi Dulce']].map(([v, l]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${l}</option>`).join('');
        const prods = data.products.filter(p => !p.is_coming_soon).map(p => `<option value="product:${esc(p.slug)}" ${sel === 'product:' + p.slug ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
        return `${base}<optgroup label="Abrir un producto">${prods}</optgroup><option value="__url" ${sel === '__url' ? 'selected' : ''}>Otro enlace (https)</option>`;
      };
      const cards = data.flyers.map((f, i) => `<article class="item item--flyer">${thumb(f.image)}<div class="item__fields">
        ${field('Título', `flyers.${i}.title`, f.title, 'maxlength="70"')}
        <label class="field">Texto<textarea data-b="flyers.${i}.text" maxlength="220" rows="3">${esc(f.text)}</textarea></label>
        <div class="row2">${field('Etiqueta (opcional)', `flyers.${i}.badge`, f.badge, 'maxlength="16" placeholder="NUEVO, OFERTA..."')}${field('Texto del botón', `flyers.${i}.linkLabel`, f.linkLabel, 'maxlength="26" placeholder="Pedir ahora"')}</div>
        ${dates(`flyers.${i}`, f)}
        <label class="field">El botón lleva a<select data-act-change="flyerLink" data-i="${i}">${opts(f.link)}</select></label>
        ${f.link && f.link.startsWith('https://') ? field('Enlace', `flyers.${i}.link`, f.link, 'type="url" placeholder="https://"') : ''}</div>
        <div class="item__bar">${sw(`flyers.${i}.active`, f.active !== false, 'Visible')}
        <button type="button" class="btn btn--small" data-act="imgFlyer" data-i="${i}">${f.image ? 'Cambiar imagen' : 'Subir imagen'}</button>
        <button type="button" class="btn btn--small" data-act="flyerUp" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">Subir</button>
        <button type="button" class="btn btn--small" data-act="flyerDown" data-i="${i}" ${i === data.flyers.length - 1 ? 'disabled' : ''} aria-label="Bajar">Bajar</button>
        <button type="button" class="btn btn--danger" data-act="delFlyer" data-i="${i}">Eliminar</button></div></article>`).join('');
      return `<section class="card"><h2>Flyers y novedades</h2><p class="card__intro">Aparecen en la sección “Lo nuevo”. Usa imágenes verticales (proporción 4:5, por ejemplo 1080 x 1350). Si no hay ninguno visible, la sección se oculta sola.</p>
        <button type="button" class="btn btn--red" data-act="addFlyer">Agregar flyer</button></section>${cards}`;
    },
    comentarios() {
      const cards = data.testimonials.map((t, i) => `<article class="item"><div class="item__fields">
        ${field('Nombre', `testimonials.${i}.name`, t.name, 'maxlength="40" placeholder="Ej. María, Caracas"')}
        <label class="field">Comentario<textarea data-b="testimonials.${i}.text" maxlength="300" rows="3">${esc(t.text)}</textarea></label></div>
        <div class="item__bar">${sw(`testimonials.${i}.active`, t.active !== false, 'Visible')}<button type="button" class="btn btn--danger" data-act="delQuote" data-i="${i}">Eliminar</button></div></article>`).join('');
      return `<section class="card"><h2>Comentarios de clientes</h2><p class="card__intro">Publica solo comentarios reales y con permiso de quien los escribió. Si no hay ninguno visible, la sección no se muestra.</p>
        <button type="button" class="btn btn--red" data-act="addQuote">Agregar comentario</button></section>${cards}`;
    },
    ofertas() {
      const rules = data.upsells.map((u, i) => {
        const p = data.products.find(x => x.slug === u.add_slug), saving = p ? Math.max(0, p.price_usd - u.price_usd) : 0;
        return `<article class="item"><div class="item__fields">${field('Título', `upsells.${i}.title`, u.title, 'maxlength="60"')}
        <label class="field">Producto que se ofrece<select data-b="upsells.${i}.add_slug" data-after="rerender">${data.products.map(x => `<option value="${esc(x.slug)}" ${x.slug === u.add_slug ? 'selected' : ''}>${esc(x.name)} ($${money(x.price_usd)})</option>`).join('')}</select></label>
        <div class="row2">${field('Precio con la oferta (USD)', `upsells.${i}.price_usd`, u.price_usd, 'type="number" data-t="n" step="0.01" min="0" inputmode="decimal" data-after="rerender"')}${field('Unidades por producto', `upsells.${i}.max_per_item`, u.max_per_item, 'type="number" data-t="n" min="1" max="5"')}</div>
        <p class="preview">${p ? (saving > 0 ? `El cliente ahorra $${money(saving)} (normal $${money(p.price_usd)}).` : 'Esta oferta no baja el precio normal.') : 'Elige un producto.'}</p>
        ${dates(`upsells.${i}`, u)}<div class="field">Se ofrece cuando pide de la categoría<div class="checks">${categories().map(c => `<label class="chk"><input type="checkbox" data-act-change="ruleCat" data-i="${i}" value="${esc(c)}" ${u.when_categories.includes(c) ? 'checked' : ''}>${esc(c)}</label>`).join('')}</div></div></div>
        <div class="item__bar">${sw(`upsells.${i}.active`, u.active !== false, 'Activa')}<button type="button" class="btn btn--danger" data-act="delRule" data-i="${i}">Eliminar</button></div></article>`;
      }).join('');
      const ann = data.announcements.map((a, i) => `<div class="row-inline"><label class="field"><span class="sr-only">Aviso ${i + 1}</span><input data-b="announcements.${i}" value="${esc(a)}" maxlength="60"></label><button type="button" class="btn btn--danger" data-act="delAnn" data-i="${i}" aria-label="Quitar aviso">Quitar</button></div>`).join('');
      return `<section class="card"><h2>Sugerencias al pedir</h2><p class="card__intro">Ofertas que aparecen al elegir un producto y en el pedido, por ejemplo: papas por $1 con cada shawarma. El ahorro se calcula solo.</p><button type="button" class="btn btn--red" data-act="addRule">Agregar sugerencia</button></section>${rules}
        <section class="card"><h2>Avisos de la barra roja</h2><p class="card__intro">Frases que giran en la franja superior del sitio. Máximo 8.</p>${ann}<button type="button" class="btn btn--small" data-act="addAnn" ${data.announcements.length >= 8 ? 'disabled' : ''}>Agregar aviso</button></section>`;
    }
  };

  function productList() {
    const q = query.trim().toLowerCase();
    const rows = data.products.map((p, i) => ({ p, i })).filter(({ p }) => !q || `${p.name} ${p.category}`.toLowerCase().includes(q));
    if (!rows.length) return '<p class="muted">No hay productos con ese nombre.</p>';
    const groups = new Map(); rows.forEach(r => groups.set(r.p.category, [...(groups.get(r.p.category) || []), r]));
    return [...groups].map(([cat, list]) => `<h3 class="cat">${esc(cat)} <small>${list.length}</small></h3>${list.map(({ p, i }) => productRow(p, i)).join('')}`).join('');
  }
  function productRow(p, i) {
    const open = openSlug === p.slug;
    return `<article class="prow ${p.is_visible === false ? 'is-off' : ''}" data-slug="${esc(p.slug)}"><div class="prow__main">${thumb(p.image)}
      <div class="prow__name"><strong>${esc(p.name)}</strong><small>${p.tag ? `${esc(p.tag)} · ` : ''}${p.is_coming_soon ? 'Próximamente' : 'Precio en USD'}</small></div>
      <div class="price"><input type="number" data-b="products.${i}.price_usd" data-t="n" data-after="bs" value="${esc(p.price_usd)}" step="0.01" min="0" inputmode="decimal" aria-label="Precio de ${esc(p.name)} en USD"><small data-bs="${i}">Bs. ${bs(p.price_usd)}</small></div></div>
      <div class="prow__bar">${sw(`products.${i}.is_visible`, p.is_visible !== false, 'Visible')}${sw(`products.${i}.available`, p.available !== false, 'Disponible')}<button type="button" class="btn btn--small" data-act="editProduct" data-slug="${esc(p.slug)}">${open ? 'Cerrar' : 'Editar'}</button></div>
      ${open ? `<div class="editor">${field('Nombre', `products.${i}.name`, p.name, 'maxlength="80"')}
        ${field('Etiqueta (opcional)', `products.${i}.tag`, p.tag || '', 'maxlength="16" list="tagList" placeholder="Nuevo, Más pedido, Picante..."', 'Aparece sobre la foto del producto en el menú.')}<datalist id="tagList"><option value="Nuevo"><option value="Más pedido"><option value="Picante"><option value="Oferta"><option value="Solo domingos"></datalist>
        <label class="field">Descripción<textarea data-b="products.${i}.description" maxlength="420" rows="3">${esc(p.description)}</textarea></label>
        <label class="field">Categoría<input data-b="products.${i}.category" value="${esc(p.category)}" list="catList" maxlength="40"><datalist id="catList">${categories().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <div class="imgbox">${thumb(p.image)}<div class="imgbox__btns"><button type="button" class="btn btn--small" data-act="imgProduct" data-i="${i}">${p.image ? 'Cambiar foto' : 'Subir foto'}</button>${p.image ? `<button type="button" class="btn btn--danger" data-act="rmImg" data-i="${i}">Quitar foto</button>` : ''}</div></div>
        <div class="prow__bar">${sw(`products.${i}.featured`, p.featured, 'Destacado en favoritos')}${sw(`products.${i}.is_coming_soon`, p.is_coming_soon, 'Próximamente')}</div>
        <button type="button" class="btn btn--danger" data-act="delProduct" data-i="${i}">Eliminar producto</button></div>` : ''}</article>`;
  }

  function render() {
    $('#tabs').innerHTML = TABS.map(([id, label]) => `<button type="button" class="tab" aria-current="${id === tab ? 'page' : 'false'}" data-tab="${id}">${label}</button>`).join('');
    $('#panel').innerHTML = VIEWS[tab]();
    const banner = $('#banner');
    banner.hidden = false; banner.className = 'banner';
    if (storage === 'none') { banner.className = 'banner banner--bad'; banner.textContent = 'La base de datos aún no está conectada, por eso no se pueden guardar cambios. Sigue el paso 3 del README.'; }
    else if (fromDefaults && !dirty) banner.textContent = 'Aún no has guardado cambios desde el panel: estás viendo los valores actuales del sitio.';
    else if (storage === 'file') banner.textContent = 'Modo local de pruebas: los cambios se guardan en la carpeta storage de este proyecto.';
    else banner.hidden = true;
  }

  /* ---------- Imágenes ---------- */
  function pickFile() { return new Promise(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = () => resolve(input.files[0] || null); input.click(); }); }
  async function optimize(file, max) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.86, .76, .66, .56, .46]) {
      let blob = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= 420 * 1024) return blob;
    }
    throw new Error('La imagen sigue muy pesada. Prueba con una más pequeña.');
  }
  const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  async function uploadImage(max) {
    const file = await pickFile(); if (!file) return null;
    toast('Subiendo imagen...');
    const { url } = await api('upload', { method: 'POST', body: JSON.stringify({ dataUrl: await toDataUrl(await optimize(file, max)) }) });
    toast('Imagen lista. Recuerda tocar "Guardar cambios".');
    return url;
  }

  /* ---------- Acciones ---------- */
  const ACTIONS = {
    logout: async () => { await api('logout', { method: 'POST', body: '{}' }).catch(() => {}); location.reload(); },
    today: () => { data.settings.exchangeRateDate = today(); markDirty(); render(); },
    save: save,
    addProduct() {
      const name = prompt('Nombre del nuevo producto:'); if (!name || !name.trim()) return;
      let slug = slugify(name), n = 2; while (data.products.some(p => p.slug === slug)) slug = `${slugify(name)}-${n++}`;
      data.products.push({ id: slug, slug, name: name.trim().slice(0, 80), category: 'Adicionales', description: '', price_usd: 1, image: '', available: true, availability_days: [], is_visible: true, is_coming_soon: false, featured: false, tag: '', brand: 'cochi', sort_order: Math.max(0, ...data.products.map(p => Number(p.sort_order) || 0)) + 1, options: [] });
      openSlug = slug; query = ''; markDirty(); render(); toast('Producto agregado. Completa su categoría, precio y foto.');
    },
    editProduct: el => { openSlug = openSlug === el.dataset.slug ? null : el.dataset.slug; $('#plist').innerHTML = productList(); },
    async imgProduct(el) { const url = await uploadImage(1000); if (url) { data.products[el.dataset.i].image = url; markDirty(); $('#plist').innerHTML = productList(); } },
    rmImg(el) { data.products[el.dataset.i].image = ''; markDirty(); $('#plist').innerHTML = productList(); },
    delProduct(el) { const p = data.products[el.dataset.i]; if (confirm(`¿Eliminar "${p.name}" del menú? Esta acción no se puede deshacer.`)) { data.products.splice(el.dataset.i, 1); openSlug = null; markDirty(); $('#plist').innerHTML = productList(); } },
    addFlyer() { data.flyers.unshift({ id: Math.random().toString(16).slice(2, 12), title: '', text: '', image: '', badge: 'NUEVO', link: '#menu', linkLabel: 'Ver el menú', active: true, start: '', end: '' }); markDirty(); render(); toast('Sube la imagen del flyer y escribe su título.'); },
    async imgFlyer(el) { const url = await uploadImage(1000); if (url) { data.flyers[el.dataset.i].image = url; markDirty(); render(); } },
    delFlyer(el) { if (confirm('¿Eliminar este flyer?')) { data.flyers.splice(el.dataset.i, 1); markDirty(); render(); } },
    flyerUp(el) { const i = +el.dataset.i; [data.flyers[i - 1], data.flyers[i]] = [data.flyers[i], data.flyers[i - 1]]; markDirty(); render(); },
    flyerDown(el) { const i = +el.dataset.i; [data.flyers[i + 1], data.flyers[i]] = [data.flyers[i], data.flyers[i + 1]]; markDirty(); render(); },
    addQuote() { data.testimonials.unshift({ id: Math.random().toString(16).slice(2, 12), name: '', text: '', active: true }); markDirty(); render(); },
    delQuote(el) { if (confirm('¿Eliminar este comentario?')) { data.testimonials.splice(el.dataset.i, 1); markDirty(); render(); } },
    addRule() { data.upsells.push({ id: `sugerencia-${Math.random().toString(16).slice(2, 7)}`, title: 'Agrégale algo más', text: '', when_categories: [], add_slug: data.products[0]?.slug || '', price_usd: 1, max_per_item: 1, active: true, start: '', end: '' }); markDirty(); render(); },
    delRule(el) { if (confirm('¿Eliminar esta sugerencia?')) { data.upsells.splice(el.dataset.i, 1); markDirty(); render(); } },
    addAnn() { data.announcements.push(''); markDirty(); render(); },
    delAnn(el) { data.announcements.splice(el.dataset.i, 1); markDirty(); render(); }
  };
  const AFTER = {
    bs() { document.querySelectorAll('[data-bs]').forEach(n => { n.textContent = `Bs. ${bs(data.products[n.dataset.bs].price_usd)}`; }); const p = $('#ratePreview'); const s = data.products.find(x => x.slug === 'shawarma-cesar') || data.products[0]; if (p && s) p.textContent = `${s.name}: $${money(s.price_usd)} = Bs. ${bs(s.price_usd)}`; },
    rerender() { render(); }
  };
  const CHANGES = {
    flyerLink(el) { const f = data.flyers[el.dataset.i]; f.link = el.value === '__url' ? 'https://' : el.value; if (!el.value) f.linkLabel = ''; markDirty(); render(); },
    ruleCat(el) { const rule = data.upsells[el.dataset.i]; const set = new Set(rule.when_categories); el.checked ? set.add(el.value) : set.delete(el.value); rule.when_categories = [...set]; markDirty(); }
  };

  document.addEventListener('click', async event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { tab = tabButton.dataset.tab; render(); window.scrollTo({ top: 0 }); return; }
    const el = event.target.closest('[data-act]'); if (!el) return;
    try { await ACTIONS[el.dataset.act]?.(el); } catch (error) { if (error.status === 401) showLogin('Tu sesión venció. Entra de nuevo.'); else toast(error.message, true); }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'q') { query = event.target.value; $('#plist').innerHTML = productList(); return; }
    const el = event.target.closest('[data-b]'); if (!el) return;
    const kind = el.dataset.t; let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (kind === 'n') value = el.value === '' ? 0 : Number(el.value);
    else if (kind === 'nullable') value = el.value === '' ? null : Number(el.value);
    else value = el.value;
    setPath(el.dataset.b, value); markDirty();
    if (el.dataset.after && (el.tagName !== 'INPUT' || el.type === 'checkbox' || el.dataset.after === 'bs')) AFTER[el.dataset.after]();
  });
  document.addEventListener('change', event => {
    const el = event.target.closest('[data-act-change]'); if (el) CHANGES[el.dataset.actChange](el);
    const after = event.target.closest('[data-after="rerender"]'); if (after) render();
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

  async function save() {
    const button = $('#saveBtn'); button.disabled = true; button.textContent = 'Guardando...';
    try {
      data.upsells.forEach(u => { u.price_usd = Number(u.price_usd) || 0; });
      await api('content', { method: 'PUT', body: JSON.stringify({ content: data }) });
      fromDefaults = false; markDirty(false); render(); toast('Guardado. El sitio ya muestra los cambios.');
    } catch (error) { if (error.status === 401) showLogin('Tu sesión venció. Entra de nuevo.'); else toast(error.message, true); markDirty(true); }
    finally { button.textContent = 'Guardar cambios'; button.disabled = !dirty || storage === 'none'; }
  }

  /* ---------- Inicio y sesión ---------- */
  function showLogin(message = '') {
    $('#app').hidden = true; $('#login').hidden = false;
    const node = $('#loginMsg'); node.hidden = !message; node.textContent = message;
  }
  async function loadData() {
    const { content, storage: mode } = await api('content');
    storage = mode; fromDefaults = !content;
    if (content) data = content;
    else {
      const [settings, products, extras] = await Promise.all(['settings', 'products', 'extras'].map(n => fetch(`/data/${n}.json`, { cache: 'no-store' }).then(r => r.json())));
      data = { settings, products, ...extras };
    }
    ['products', 'flyers', 'testimonials', 'upsells', 'announcements'].forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
    $('#login').hidden = true; $('#app').hidden = false; markDirty(false); render();
  }
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#loginBtn'); button.disabled = true; button.textContent = 'Entrando...';
    try { await api('login', { method: 'POST', body: JSON.stringify({ email: $('#loginEmail').value, password: $('#loginPass').value }) }); $('#loginPass').value = ''; await loadData(); }
    catch (error) { showLogin(error.message); }
    finally { button.disabled = false; button.textContent = 'Entrar'; }
  });
  (async () => {
    try {
      const session = await api('session');
      if (!session.configured) return showLogin('El panel aún no está configurado: faltan ADMIN_EMAIL, ADMIN_PASSWORD y SESSION_SECRET (mira el README).');
      if (session.authenticated) await loadData(); else showLogin();
    } catch { showLogin('No se pudo conectar con el servidor.'); }
  })();
})();
