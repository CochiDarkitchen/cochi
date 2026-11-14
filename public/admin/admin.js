(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = [['temas', 'Temas'], ['tasa', 'Tasa y datos'], ['horario', 'Horario'], ['productos', 'Productos'], ['flyers', 'Flyers'], ['comentarios', 'Comentarios'], ['ofertas', 'Ofertas y avisos'], ['cupones', 'Cupones'], ['comandas', 'Comandas'], ['estadisticas', 'Estadísticas'], ['clientes', 'Clientes']];
  const THEME_PRESETS = [
    { id: 'original', name: 'Cochi original', note: 'Rojo intenso y crema', colors: ['#eb140c', '#e6e0bf', '#211e1a'] },
    { id: 'black-friday', name: 'Black Friday', note: 'Negro, dorado y alto contraste', colors: ['#151515', '#e4b64e', '#f8f2e7'] },
    { id: 'navidad', name: 'Navidad', note: 'Rojo festivo, verde y dorado', colors: ['#b52331', '#24563b', '#dbb75c'] },
    { id: 'ano-nuevo', name: 'Año Nuevo', note: 'Azul noche y champagne', colors: ['#11192c', '#d7b76a', '#f8f3e8'] },
    { id: 'san-valentin', name: 'San Valentín', note: 'Rosa suave y borgoña', colors: ['#ae3456', '#efd4db', '#4b2330'] }
  ];
  let data = null, tab = 'temas', dirty = false, openSlug = null, query = '', storage = 'file', fromDefaults = false, toastTimer = null, customers = [], customerQuery = '', orders = [], feeDrafts = {}, preview = null, modalReturnFocus = null, currentReceiptHtml = '', ordersLimit = 50, statsPeriod = '30', selectedCustomerIds = new Set(), campaignText = '¡Hola {nombre}! Tenemos novedades en Cochi. Queremos compartirte nuestros nuevos platillos y promociones. Escríbenos por aquí para conocerlos.', campaignLinksReady = false;

  async function api(path, options = {}) {
    const response = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
    const raw = await response.text();
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch {}
    if (!response.ok) throw Object.assign(new Error(body.error || `El servidor respondió ${response.status}${raw && !body.error ? `: ${raw.slice(0, 180)}` : '.'}`), { status: response.status });
    return body;
  }
  function toast(text, bad = false) {
    const node = $('#toast'); node.textContent = text; node.className = `toast is-on${bad ? ' is-bad' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('is-on'), 3600);
  }
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const money = n => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2);
  const dateTime = value => value ? new Date(value).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : 'Fecha no disponible';
  const caracasHour = value => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', hour: '2-digit', hourCycle: 'h23' }).format(new Date(value)));
  const waUrl = (phone, message = '') => `https://wa.me/${String(phone || '').replace(/\D/g, '')}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
  const moneyText = n => `$${money(n)}`;
  /* ---------- Comanda: cálculo, vista previa e impresión ---------- */
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fmtBs = n => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
  const orderBase = order => Math.max(0, Number(order.total ?? order.productsTotal ?? 0) || 0);
  const orderRate = order => Number(order.rateUsdToVes || data?.settings?.usdToVes || 0);
  // Devuelve el monto como número (0 a 999) o null si está vacío o es inválido.
  function parseFee(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 999 ? round2(n) : null;
  }
  // Mismas cuentas que hace el servidor al confirmar: total con descuento + delivery (retiro = 0).
  function draftOrder(order, fee) {
    const deliveryFeeUSD = order.mode === 'pickup' ? 0 : round2(fee);
    return { ...order, deliveryFeeUSD, finalTotalUSD: round2(orderBase(order) + deliveryFeeUSD) };
  }
  // Lo escrito en el campo se conserva aunque la lista se vuelva a dibujar.
  const feeValue = order => feeDrafts[order.id] !== undefined ? feeDrafts[order.id] : String(order.deliveryFeeUSD ?? data.settings.deliveryFeeUSD ?? '');
  function feeSummaryHtml(order, fee) {
    const ok = fee !== null, total = ok ? round2(orderBase(order) + fee) : 0, rate = orderRate(order);
    return `<span>Delivery</span><strong>${ok ? moneyText(fee) : '—'}</strong><span class="fee-total">Total a cobrar</span><strong class="fee-total">${ok ? moneyText(total) : '—'}</strong>${rate > 0 ? `<span class="muted">En bolívares (tasa ${money(rate)})</span><strong class="muted">${ok ? `Bs. ${fmtBs(total * rate)}` : '—'}</strong>` : ''}`;
  }
  // Actualiza el total y los avisos de una comanda mientras se escribe, sin redibujar toda la lista.
  function syncFee(input) {
    const id = input.dataset.orderFee, order = orders.find(o => String(o.id) === id); if (!order) return;
    feeDrafts[id] = input.value;
    const fee = parseFee(input.value);
    const summary = document.querySelector(`[data-fee-summary="${id}"]`); if (summary) summary.innerHTML = feeSummaryHtml(order, fee);
    const hint = document.querySelector(`[data-fee-hint="${id}"]`); if (hint) hint.hidden = fee !== null;
    if (fee === null) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }

  // Documento completo de la comanda (58 mm). Es el mismo que se ve en la vista previa y el que se imprime.
  function receiptHtml(order) {
    const mode = order.mode === 'pickup' ? 'RETIRO' : 'DELIVERY';
    const items = (order.items || []).map(item => {
      const options = (item.options || []).map(option => `${esc(option.groupName)}: ${esc(option.choiceLabel)}${Number(option.quantity) > 1 ? ` x${esc(option.quantity)}` : ''}`).join('<br>');
      const note = item.note ? `<div class="sub"><em>Nota: ${esc(item.note)}</em></div>` : '';
      return `<div class="line"><div class="item-name">${esc(item.quantity)} x ${esc(item.name)}</div><div class="amount">${moneyText(item.lineTotal ?? (Number(item.unitPrice || 0) * Number(item.quantity || 1)))}</div>${options ? `<div class="sub">${options}</div>` : ''}${note}</div>`;
    }).join('');
    const finalTotal = Number(order.finalTotalUSD ?? order.total ?? 0);
    const rate = orderRate(order);
    const rateDate = order.rateDate || data?.settings?.exchangeRateDate || '';
    const bolivares = rate > 0 ? `Bs. ${fmtBs(finalTotal * rate)}` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comanda ${esc(order.id)}</title><style>
      @page{size:58mm auto;margin:2mm}*{box-sizing:border-box}html,body{width:54mm;margin:0;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:10px;line-height:1.35}body{padding:1mm}.center{text-align:center}.brand{font-size:21px;font-weight:900;letter-spacing:1px}.muted{font-size:9px}.rule{border:0;border-top:1px dashed #000;margin:7px 0}.meta{display:flex;justify-content:space-between;gap:4px}.line{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:6px;padding:4px 0;border-bottom:1px dotted #777}.item-name{font-weight:700;overflow-wrap:anywhere}.amount{font-weight:700;white-space:nowrap;text-align:right}.sub{grid-column:1/-1;font-size:9px;padding-top:2px;overflow-wrap:anywhere}.totals{display:grid;gap:3px}.total{font-size:14px;font-weight:900}.address{overflow-wrap:anywhere}.footer{margin-top:8px;text-align:center;font-size:9px}
      @media screen{html{width:58mm;padding:2mm}body{width:54mm}}
      </style></head><body><header class="center"><div class="brand">COCHI</div><div class="muted">DARK KITCHEN · COMANDA</div></header><hr class="rule"><div class="meta"><strong>${esc(order.id)}</strong><span>${esc(dateTime(order.createdAt))}</span></div><p><strong>CLIENTE:</strong> ${esc(order.name)}<br><strong>CONTACTO:</strong> ${esc(order.phone)}<br><strong>MODALIDAD:</strong> ${mode}</p>${order.mode !== 'pickup' ? `<p class="address"><strong>DIRECCIÓN:</strong> ${esc(order.address || 'No indicada')}<br><strong>SECTOR:</strong> ${esc(order.sector || '—')}<br><strong>REFERENCIA:</strong> ${esc(order.reference || '—')}</p>` : ''}<hr class="rule"><div><strong>DETALLE DEL PEDIDO</strong></div>${items || '<p>Sin detalle de productos.</p>'}<hr class="rule"><div class="totals"><div class="meta"><span>Productos</span><strong>${moneyText(order.productsTotal ?? (Number(order.total || 0) + Number(order.discount || 0)))}</strong></div>${Number(order.discount) > 0 ? `<div class="meta"><span>Descuento ${esc(order.couponCode || '')}</span><strong>-${moneyText(order.discount)}</strong></div>` : ''}<div class="meta"><span>Productos con descuento</span><strong>${moneyText(order.total)}</strong></div><div class="meta"><span>Delivery</span><strong>${moneyText(order.deliveryFeeUSD || 0)}</strong></div><hr class="rule"><div class="meta total"><span>TOTAL</span><strong>${moneyText(finalTotal)}</strong></div>${bolivares ? `<div class="meta"><span>Estimado en bolívares</span><strong>${esc(bolivares)}</strong></div><div class="muted">Tasa: ${money(rate)} Bs./USD · ${esc(rateDate)}</div>` : ''}</div>${order.notes ? `<hr class="rule"><strong>NOTAS:</strong><p>${esc(order.notes)}</p>` : ''}<hr class="rule"><div class="footer">Gracias por pedir en Cochi.<br>La actitud tiene sabor.</div></body></html>`;
  }

  /* Ventana de vista previa: muestra la comanda en un marco y la imprime desde ahí mismo,
     así lo que se ve es exactamente lo que sale en papel y el navegador no bloquea ventanas emergentes. */
  function loadFrame(html) {
    const frame = $('#receiptFrame'); currentReceiptHtml = html;
    return new Promise(resolve => {
      frame.onload = () => {
        frame.onload = null; sizeFrame();
        // Si el foco queda dentro de la comanda (p. ej. después de imprimir), Esc debe seguir cerrando la ventana.
        frame.contentDocument?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closePreview(); } });
        resolve();
      };
      frame.srcdoc = html;
    });
  }
  function sizeFrame() {
    const frame = $('#receiptFrame'), wrap = $('#paperWrap'), doc = frame.contentDocument; if (!doc?.documentElement) return;
    frame.style.height = '0px';
    const height = Math.ceil(doc.documentElement.scrollHeight);
    frame.style.height = `${height}px`;
    wrap.style.height = `${Math.ceil(height * (parseFloat(getComputedStyle(wrap).getPropertyValue('--zoom')) || 1.5))}px`;
  }
  function paintFoot() {
    const order = orders.find(o => String(o.id) === preview.id), confirmed = order?.status === 'confirmed', busy = preview.saving ? 'disabled' : '';
    $('#modalFoot').innerHTML = confirmed
      ? `<button type="button" class="btn" data-act="closePreview">Cerrar</button><button type="button" class="btn btn--red" data-act="printPreview">${preview.printed ? 'Imprimir otra vez' : 'Imprimir'}</button>`
      : `<button type="button" class="btn" data-act="closePreview" ${busy}>Volver y editar</button><button type="button" class="btn btn--red" data-act="confirmAndPrint" ${busy}>${preview.saving ? 'Guardando…' : 'Confirmar e imprimir'}</button>`;
  }
  function paintNote(order, shown) {
    const confirmed = order.status === 'confirmed', pickup = order.mode === 'pickup';
    $('#modalTitle').textContent = `Vista previa · ${order.id}`;
    $('#modalNote').innerHTML = confirmed
      ? `<span class="chip chip--on">Confirmada</span><span>Total guardado: <strong>${moneyText(shown.finalTotalUSD)}</strong>${pickup ? '' : ` (delivery ${moneyText(shown.deliveryFeeUSD)})`}</span>`
      : `<span class="chip chip--soon">Aún no confirmada</span><span>${pickup ? 'Retiro: sin delivery.' : `Delivery <strong>${moneyText(shown.deliveryFeeUSD)}</strong>.`} Total <strong>${moneyText(shown.finalTotalUSD)}</strong>. Se guarda al confirmar.</span>`;
  }
  async function openPreview(order, fee) {
    preview = { id: String(order.id), fee, saving: false, printed: false };
    modalReturnFocus = document.activeElement;
    const shown = order.status === 'confirmed' ? order : draftOrder(order, fee);
    $('#receiptModal').hidden = false; document.body.classList.add('modal-open');
    paintNote(order, shown); paintFoot();
    await loadFrame(receiptHtml(shown));
    $('#modalFoot .btn--red')?.focus();
  }
  function closePreview() {
    if (!preview || preview.saving) return;
    const id = preview.id, back = modalReturnFocus; preview = null; modalReturnFocus = null;
    $('#receiptModal').hidden = true; document.body.classList.remove('modal-open');
    const frame = $('#receiptFrame'); frame.onload = null; frame.srcdoc = '';
    (back && document.contains(back) ? back : document.querySelector(`[data-act="previewOrder"][data-order-id="${id}"]`))?.focus();
  }
  function printFrame() {
    const frame = $('#receiptFrame');
    try { frame.contentWindow.focus(); frame.contentWindow.print(); return true; }
    catch {
      // Algunos navegadores del teléfono no imprimen desde un marco: se abre la comanda en una ventana aparte.
      const win = window.open('', '_blank', 'width=380,height=760');
      if (!win) { toast('No se pudo abrir la impresión. Permite las ventanas emergentes e inténtalo otra vez.', true); return false; }
      win.document.open(); win.document.write(currentReceiptHtml.replace('</body>', '<script>requestAnimationFrame(()=>window.print());<\/script></body>')); win.document.close();
      return true;
    }
  }
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
    temas() {
      const theme = data.settings.theme;
      const cards = THEME_PRESETS.map(preset => `<button type="button" class="theme-option${theme.preset === preset.id ? ' is-selected' : ''}" data-act="chooseTheme" data-theme-id="${preset.id}" aria-pressed="${theme.preset === preset.id}">
        <span class="theme-option__swatches">${preset.colors.map(color => `<i style="--swatch:${color}"></i>`).join('')}</span>
        <strong>${preset.name}</strong><small>${preset.note}</small>
        <span class="theme-option__state">${theme.preset === preset.id ? 'Tema seleccionado' : 'Seleccionar tema'}</span>
      </button>`).join('');
      const assets = [
        { key: 'logoHeader', title: 'Logo principal', subtitle: 'Se muestra en la parte superior del menú', fallback: '/assets/brand/cochi-logo-red.png', upload: 'Subir logo principal' },
        { key: 'logoFooter', title: 'Logo para fondo oscuro', subtitle: 'Se muestra en el pie de página', fallback: '/assets/brand/cochi-logo-cream.png', upload: 'Subir logo de pie de página' },
        { key: 'isotipo', title: 'Isotipo / cerdito', subtitle: 'Se usa en la intro y los detalles de marca', fallback: '/assets/brand/cochi-isotipo-red.png', upload: 'Subir isotipo' }
      ].map(asset => {
        const src = theme[asset.key] || asset.fallback;
        return `<article class="theme-asset"><div class="theme-asset__preview"><img src="${esc(src)}" alt="Vista previa: ${asset.title}"></div><div class="theme-asset__copy"><strong>${asset.title}</strong><small>${asset.subtitle}</small><small>${theme[asset.key] ? 'Logo personalizado cargado' : 'Se usará el logo original de Cochi'}</small><div class="theme-asset__actions"><button type="button" class="btn btn--small" data-act="uploadThemeAsset" data-asset="${asset.key}">${theme[asset.key] ? 'Cambiar imagen' : asset.upload}</button>${theme[asset.key] ? `<button type="button" class="btn btn--danger" data-act="removeThemeAsset" data-asset="${asset.key}">Usar original</button>` : ''}</div></div></article>`;
      }).join('');
      return `<section class="card"><h2>Temáticas de temporada</h2><p class="card__intro">Elige una temática para cambiar la paleta de colores de todo el menú digital: fondos, textos, botones, secciones y detalles. El cambio se publica cuando pulses <strong>Guardar cambios</strong>.</p><div class="theme-grid">${cards}</div><p class="preview">Tema activo: <strong>${esc(THEME_PRESETS.find(p => p.id === theme.preset)?.name || 'Cochi original')}</strong>. Puedes volver al diseño original en cualquier momento.</p></section>
        <section class="card"><h2>Logos de la temática</h2><p class="card__intro">Sube tus versiones temáticas de Cochi. Puedes dejar cualquiera sin cargar para conservar el logo original. Recomendado: PNG o WebP con fondo transparente.</p><div class="theme-assets">${assets}</div><p class="muted">Cada imagen se optimiza al subirla. Después de cargar o cambiar los logos, recuerda guardar los cambios.</p></section>`;
    },
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
    cupones() {
      const cp = data.cp;
      const items = cp.coupons.map((c, i) => `<article class="item"><div class="item__fields">
        <div class="row2">${field('Código', `cp.coupons.${i}.code`, c.code, 'maxlength="20" autocapitalize="characters"', 'Letras y números, sin espacios')}${field('Nota interna', `cp.coupons.${i}.label`, c.label || '', 'maxlength="60"', 'Solo para ti, ej. "Instagram octubre"')}</div>
        <div class="row2"><label class="field">Tipo de descuento<select data-b="cp.coupons.${i}.type" data-after="rerender"><option value="percent" ${c.type !== 'fixed' ? 'selected' : ''}>Porcentaje (%)</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>Monto fijo (USD)</option></select></label>${field(c.type === 'fixed' ? 'Descuento (USD)' : 'Descuento (%)', `cp.coupons.${i}.value`, c.value, 'type="number" data-t="n" step="any" min="0" inputmode="decimal"')}</div>
        <div class="row2">${field('Usos máximos', `cp.coupons.${i}.max_uses`, c.max_uses || 0, 'type="number" data-t="n" min="0"', '0 = sin límite')}${field('Pedido mínimo (USD)', `cp.coupons.${i}.min_order_usd`, c.min_order_usd || 0, 'type="number" data-t="n" step="0.01" min="0"', '0 = sin mínimo')}</div>
        ${field('Solo para este teléfono (opcional)', `cp.coupons.${i}.phone`, c.phone || '', 'type="tel" inputmode="tel" maxlength="20"', 'Si lo llenas, solo ese cliente podrá usar el cupón.')}
        ${dates(`cp.coupons.${i}`, c)}<p class="preview">Usos hasta ahora: ${c.uses || 0}${c.max_uses ? ` de ${c.max_uses}` : ''}.</p></div>
        <div class="item__bar">${sw(`cp.coupons.${i}.active`, c.active !== false, 'Activo')}${sw(`cp.coupons.${i}.per_customer`, Boolean(c.per_customer), 'Un uso por cliente')}<button type="button" class="btn btn--small" data-act="genCode" data-i="${i}">Generar código</button><button type="button" class="btn btn--danger" data-act="delCoupon" data-i="${i}">Eliminar</button></div></article>`).join('');
      return `<section class="card"><h2>Cupones de descuento</h2><p class="card__intro">Función de prueba. El interruptor enciende o apaga los cupones en toda la tienda. Un uso se cuenta cuando el cliente pulsa "Enviar por WhatsApp". Recuerda pulsar "Guardar cambios".</p>${sw('cp.enabled', cp.enabled, 'Cupones activados en la tienda')}<br><button type="button" class="btn btn--red" data-act="addCoupon">Crear cupón</button></section>${items}`;
    },
    horario() {
      const s = data.settings, names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const rows = [1, 2, 3, 4, 5, 6, 0].map(d => { const i = s.schedule.findIndex(x => x.day === d), r = s.schedule[i];
        return `<article class="item"><div class="item__fields"><h3>${names[d]}</h3><div class="row2">${field('Abre', `settings.schedule.${i}.from`, r.from, 'type="time"')}${field('Cierra', `settings.schedule.${i}.to`, r.to, 'type="time"')}</div></div><div class="item__bar">${sw(`settings.schedule.${i}.open`, r.open, 'Recibe pedidos este día')}</div></article>`; }).join('');
      return `<section class="card"><h2>Horario de pedidos</h2><p class="card__intro">Los clientes solo pueden enviar su pedido dentro de este horario (hora de Caracas). "00:00 a 23:59" significa todo el día. Si cierras después de medianoche, pon una hora menor que la de apertura (ej. abre 18:00, cierra 01:00). Los textos del sitio y de la factura se actualizan solos.</p>${sw('settings.ordersPaused', Boolean(s.ordersPaused), 'Pausar pedidos ahora (cierre temporal)')}</section>${rows}`;
    },
    ofertas() {
      const rules = data.upsells.map((u, i) => {
        const p = data.products.find(x => x.slug === u.add_slug), saving = p ? Math.max(0, p.price_usd - u.price_usd) : 0;
        return `<article class="item"><div class="item__fields">${field('Título', `upsells.${i}.title`, u.title, 'maxlength="60"')}
        <label class="field">Producto que se ofrece<select data-b="upsells.${i}.add_slug" data-after="rerender">${data.products.map(x => `<option value="${esc(x.slug)}" ${x.slug === u.add_slug ? 'selected' : ''}>${esc(x.name)} ($${money(x.price_usd)})</option>`).join('')}</select></label>
        <div class="row2">${field('Precio con la oferta (USD)', `upsells.${i}.price_usd`, u.price_usd, 'type="number" data-t="n" step="0.01" min="0" inputmode="decimal" data-after="rerender"')}${field('Unidades por producto', `upsells.${i}.max_per_item`, u.max_per_item, 'type="number" data-t="n" min="1" max="5"')}</div>
        <p class="preview">${p ? (saving > 0 ? `El cliente ahorra $${money(saving)} (normal $${money(p.price_usd)}).` : 'Esta oferta no baja el precio normal.') : 'Elige un producto.'}</p>
        ${dates(`upsells.${i}`, u)}
        <div class="row2">${field('Desde qué hora (opcional)', `upsells.${i}.start_time`, u.start_time || '', 'type="time"')}${field('Hasta qué hora (opcional)', `upsells.${i}.end_time`, u.end_time || '', 'type="time"')}</div>
        <div class="field">Días de la semana (sin marcar = todos)<div class="checks">${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d, day) => `<label class="chk"><input type="checkbox" data-act-change="ruleDay" data-i="${i}" value="${day}" ${Array.isArray(u.days) && u.days.includes(day) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>
        <div class="field">Se ofrece cuando pide de la categoría<div class="checks">${categories().map(c => `<label class="chk"><input type="checkbox" data-act-change="ruleCat" data-i="${i}" value="${esc(c)}" ${u.when_categories.includes(c) ? 'checked' : ''}>${esc(c)}</label>`).join('')}</div></div></div>
        <div class="item__bar">${sw(`upsells.${i}.active`, u.active !== false, 'Activa')}<button type="button" class="btn btn--danger" data-act="delRule" data-i="${i}">Eliminar</button></div></article>`;
      }).join('');
      const ann = data.announcements.map((a, i) => `<div class="row-inline"><label class="field"><span class="sr-only">Aviso ${i + 1}</span><input data-b="announcements.${i}" value="${esc(a)}" maxlength="60"></label><button type="button" class="btn btn--danger" data-act="delAnn" data-i="${i}" aria-label="Quitar aviso">Quitar</button></div>`).join('');
      return `<section class="card"><h2>Sugerencias al pedir</h2><p class="card__intro">Ofertas que aparecen al elegir un producto y en el pedido, por ejemplo: papas por $1 con cada shawarma. El ahorro se calcula solo.</p><button type="button" class="btn btn--red" data-act="addRule">Agregar sugerencia</button></section>${rules}
        <section class="card"><h2>Avisos de la barra roja</h2><p class="card__intro">Frases que giran en la franja superior del sitio. Máximo 8.</p>${ann}<button type="button" class="btn btn--small" data-act="addAnn" ${data.announcements.length >= 8 ? 'disabled' : ''}>Agregar aviso</button></section>`;
    },
    comandas() {
      const pending = orders.filter(o => o.status !== 'confirmed');
      const confirmed = orders.filter(o => o.status === 'confirmed');
      const cards = orders.slice(0, ordersLimit).map(order => {
        const isConfirmed = order.status === 'confirmed';
        const isPickup = order.mode === 'pickup';
        const id = esc(order.id);
        const items = (order.items || []).map(item => `<div class="order-line"><strong>${esc(item.quantity)} × ${esc(item.name)}</strong><span>${moneyText(item.lineTotal ?? Number(item.unitPrice || 0) * Number(item.quantity || 1))}</span>${(item.options || []).length ? `<small>${item.options.map(o => `${esc(o.groupName)}: ${esc(o.choiceLabel)}${Number(o.quantity) > 1 ? ` ×${esc(o.quantity)}` : ''}`).join(' · ')}</small>` : ''}${item.note ? `<small>Nota: ${esc(item.note)}</small>` : ''}</div>`).join('');
        const previewBtn = `<button type="button" class="btn btn--red" data-act="previewOrder" data-order-id="${id}">Vista previa de la comanda</button>`;
        let feeBox = '';
        if (!isConfirmed && isPickup) {
          feeBox = `<div class="fee-box"><div class="fee-box__head"><h4>Retiro en Cochi</h4></div><p class="muted">No se cobra delivery. Total a cobrar: <strong>${moneyText(orderBase(order))}</strong></p>${previewBtn}</div>`;
        } else if (!isConfirmed) {
          const raw = feeValue(order), fee = parseFee(raw);
          feeBox = `<div class="fee-box"><div class="fee-box__head"><h4>Delivery</h4><small>Costo real acordado con el cliente</small></div>
            <div class="fee-row"><button type="button" class="btn fee-step" data-act="feeStep" data-order-id="${id}" data-step="-0.5" aria-label="Restar 0,50 al delivery">−</button>
            <label class="fee-input"><span class="sr-only">Costo de delivery en USD</span><b aria-hidden="true">$</b><input type="number" data-order-fee="${id}" min="0" max="999" step="0.01" inputmode="decimal" value="${esc(raw)}" placeholder="0.00" ${fee === null ? 'aria-invalid="true"' : ''}></label>
            <button type="button" class="btn fee-step" data-act="feeStep" data-order-id="${id}" data-step="0.5" aria-label="Sumar 0,50 al delivery">+</button></div>
            <div class="fee-summary" data-fee-summary="${id}">${feeSummaryHtml(order, fee)}</div>
            <p class="fee-hint" data-fee-hint="${id}" ${fee === null ? '' : 'hidden'}>Escribe el costo del delivery (usa 0 si no se cobra).</p>${previewBtn}</div>`;
        }
        return `<article class="item order-card"><div class="order-head"><div><h3>${esc(order.id || 'Comanda')}</h3><p class="muted">${dateTime(order.createdAt)} · ${isPickup ? 'Retiro' : 'Delivery'}</p></div><span class="chip chip--${isConfirmed ? 'on' : 'soon'}">${isConfirmed ? 'Confirmada' : 'Pendiente'}</span></div><div class="order-customer"><strong>${esc(order.name)}</strong> · ${esc(order.phone)}${order.address ? `<br>${esc(order.address)} · ${esc(order.sector || '')}` : ''}${order.reference ? `<br>Referencia: ${esc(order.reference)}` : ''}</div><div class="order-items">${items || '<p class="muted">No hay detalle de productos.</p>'}</div><div class="order-totals"><span>Productos</span><strong>${moneyText(order.productsTotal ?? (Number(order.total || 0) + Number(order.discount || 0)))}</strong>${Number(order.discount) > 0 ? `<span>Cupón ${esc(order.couponCode || '')}</span><strong>-${moneyText(order.discount)}</strong>` : ''}<span>Subtotal</span><strong>${moneyText(order.total ?? order.productsTotal)}</strong>${isConfirmed ? `<span>Delivery</span><strong>${moneyText(order.deliveryFeeUSD || 0)}</strong><span>Total confirmado</span><strong>${moneyText(order.finalTotalUSD)}</strong>` : ''}</div>${order.notes ? `<p class="preview"><strong>Notas:</strong> ${esc(order.notes)}</p>` : ''}${feeBox}${isConfirmed ? `<div class="item__bar"><button type="button" class="btn btn--small" data-act="previewOrder" data-order-id="${id}">Vista previa e imprimir</button></div>` : ''}</article>`;
      }).join('');
      return `<section class="card"><h2>Comandas y pedidos</h2><p class="card__intro">Cada pedido que el cliente envía a WhatsApp aparece aquí como pendiente. Escribe el costo real del delivery, revisa cómo quedará la comanda en la vista previa y confírmala para imprimirla en la impresora térmica de 58 mm. Confirmar aquí registra el monto acordado, no el pago recibido.</p><div class="metric-grid"><div class="metric"><strong>${orders.length}</strong><span>Pedidos registrados</span></div><div class="metric"><strong>${pending.length}</strong><span>Pendientes</span></div><div class="metric"><strong>${confirmed.length}</strong><span>Confirmados</span></div></div><button type="button" class="btn btn--small" data-act="refreshOrders">Actualizar pedidos</button></section>${cards || '<section class="card"><p class="muted">Todavía no hay pedidos. Cuando un cliente envíe su solicitud a WhatsApp, aparecerá aquí.</p></section>'}${orders.length > ordersLimit ? `<button type="button" class="btn btn--small" data-act="loadMoreOrders">Mostrar ${Math.min(50, orders.length - ordersLimit)} pedidos más</button>` : ''}`;
    },
    estadisticas() {
      const cutoff = statsPeriod === 'all' ? 0 : Date.now() - Number(statsPeriod) * 86400000;
      const filtered = orders.filter(o => !cutoff || new Date(o.createdAt).getTime() >= cutoff);
      const confirmed = filtered.filter(o => o.status === 'confirmed');
      const pending = filtered.length - confirmed.length;
      const revenue = confirmed.reduce((sum, o) => sum + (Number(o.finalTotalUSD) || 0), 0);
      const avg = confirmed.length ? revenue / confirmed.length : 0;
      const productMap = new Map(), hourMap = new Map(), dayMap = new Map(), windowMap = new Map();
      for (const order of filtered) {
        for (const item of (order.items || [])) {
          const entry = productMap.get(item.name) || { qty: 0, total: 0 };
          entry.qty += Number(item.quantity) || 0; entry.total += Number(item.lineTotal ?? Number(item.unitPrice || 0) * Number(item.quantity || 1)) || 0;
          productMap.set(item.name, entry);
        }
        if (!order.createdAt) continue;
        const hour = caracasHour(order.createdAt);
        hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
        const dayName = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', weekday: 'long' }).format(new Date(order.createdAt));
        dayMap.set(dayName, (dayMap.get(dayName) || 0) + 1);
        const period = hour < 6 ? 'Madrugada · 00–05' : hour < 12 ? 'Mañana · 06–11' : hour < 18 ? 'Tarde · 12–17' : 'Noche · 18–23';
        windowMap.set(period, (windowMap.get(period) || 0) + 1);
      }
      const topProducts = [...productMap.entries()].sort((a,b) => b[1].qty-a[1].qty).slice(0,8);
      const dayOrder = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
      const days = dayOrder.map(d => [d, dayMap.get(d) || 0]);
      const hours = Array.from({length:24}, (_,h) => [String(h).padStart(2,'0')+':00', hourMap.get(h)||0]);
      const bestDay = [...dayMap.entries()].sort((a,b)=>b[1]-a[1])[0];
      const bestPeriod = [...windowMap.entries()].sort((a,b)=>b[1]-a[1])[0];
      const bestProduct = topProducts[0];
      const barList = (entries, formatter = x => x) => {
        const max = Math.max(1, ...entries.map(([,v])=>Number(v)||0));
        return entries.map(([label,value]) => `<div class="bar-row"><div><span>${esc(label)}</span><strong>${formatter(value)}</strong></div><span class="bar-track"><i style="width:${Math.max(0,Math.min(100,(Number(value)||0)/max*100))}%"></i></span></div>`).join('');
      };
      return `<section class="card"><div class="section-head"><div><h2>Estadísticas de Cochi</h2><p class="card__intro">Comportamiento de los pedidos registrados. Horas y días calculados con la hora de Caracas.</p></div><label class="field period-field">Período<select id="statsPeriod"><option value="7" ${statsPeriod==='7'?'selected':''}>Últimos 7 días</option><option value="30" ${statsPeriod==='30'?'selected':''}>Últimos 30 días</option><option value="90" ${statsPeriod==='90'?'selected':''}>Últimos 90 días</option><option value="all" ${statsPeriod==='all'?'selected':''}>Todo el historial</option></select></label></div><div class="metric-grid"><div class="metric"><strong>${filtered.length}</strong><span>Pedidos recibidos</span></div><div class="metric"><strong>${confirmed.length}</strong><span>Comandas confirmadas</span></div><div class="metric"><strong>${moneyText(revenue)}</strong><span>Monto confirmado</span></div><div class="metric"><strong>${moneyText(avg)}</strong><span>Promedio por comanda</span></div></div><p class="muted">${pending} pedido(s) aún pendiente(s) de confirmar. El monto mostrado corresponde a precios confirmados por el equipo; no significa necesariamente que el depósito ya fue recibido.</p></section><section class="card"><h2>Productos más pedidos</h2><p class="card__intro">Ranking por unidades solicitadas; incluye pedidos pendientes y confirmados.</p>${topProducts.length ? barList(topProducts.map(([name,v])=>[name,v.qty]), v=>`${v} uds.`) : '<p class="muted">Aún no hay datos suficientes.</p>'}${bestProduct ? `<p class="preview">El producto con más unidades en este período es <strong>${esc(bestProduct[0])}</strong> (${bestProduct[1].qty} unidades).</p>` : ''}</section><section class="card"><h2>¿Cuándo piden?</h2><p class="card__intro">Distribución por día de la semana y hora de recepción del pedido.</p><h3 class="subheading">Días</h3>${barList(days, v=>`${v} pedidos`)}<h3 class="subheading">Horas</h3>${barList(hours, v=>`${v} pedidos`)}${bestDay ? `<p class="preview">Día con más actividad: <strong>${esc(bestDay[0])}</strong> (${bestDay[1]} pedidos).</p>` : ''}</section><section class="card"><h2>Franjas de actividad</h2>${windowMap.size ? barList([...windowMap.entries()], v=>`${v} pedidos`) : '<p class="muted">Todavía no hay pedidos registrados.</p>'}${bestPeriod ? `<p class="preview">Mayor movimiento: <strong>${esc(bestPeriod[0])}</strong>.</p>` : ''}</section>`;
    },
    clientes() {
      const q = customerQuery.trim().toLowerCase();
      const rows = customers.filter(c => !q || `${c.name} ${c.phone} ${c.email || ''}`.toLowerCase().includes(q));
      const eligible = rows.filter(c => c.marketingConsent && c.marketingChannel !== 'email');
      const chosen = eligible.filter(c => selectedCustomerIds.has(String(c.id)));
      const cards = rows.map(c => {
        const customerOrders = Array.isArray(c.orders) ? c.orders : [];
        const last = customerOrders[0], wa = String(c.phone || '').replace(/\\D/g, '');
        const canCampaign = Boolean(c.marketingConsent && c.marketingChannel !== 'email');
        return `<article class="item"><div class="item__fields"><div class="customer-head"><h3>${esc(c.name)}</h3>${canCampaign ? `<label class="customer-check"><input type="checkbox" data-customer-select="${esc(c.id)}" ${selectedCustomerIds.has(String(c.id)) ? 'checked' : ''}> Seleccionar</label>` : ''}</div><p class="preview">Teléfono: ${esc(c.phone)}${c.email ? ` · Correo: ${esc(c.email)}` : ''}</p>
          <p class="preview">${c.address ? `Dirección: ${esc(c.address)} · ${esc(c.sector || '')}` : 'Sin dirección registrada'}${c.reference ? ` · Ref.: ${esc(c.reference)}` : ''}</p>
          <p class="preview">${customerOrders.length} pedido(s) · ${last ? `Último: ${dateTime(last.createdAt)}` : 'Sin pedidos'}</p>
          <p class="preview">${canCampaign ? `Autorizó promociones por WhatsApp${c.marketingConsentAt ? ` · ${dateTime(c.marketingConsentAt)}` : ''}` : c.marketingConsent ? 'Autorizó promociones por correo' : 'No autorizó promociones por WhatsApp'}</p>
          ${customerOrders.slice(0, 5).map(o => `<div class="preview"><strong>${esc(o.id || 'Pedido')}</strong> · ${dateTime(o.createdAt)} · ${moneyText(o.finalTotalUSD ?? o.total)}<br>${(o.items || []).map(it => `${esc(it.quantity)}× ${esc(it.name)}`).join(' · ')}</div>`).join('')}
        </div><div class="item__bar"><a class="btn btn--small" href="${waUrl(wa)}" target="_blank" rel="noopener">Abrir WhatsApp</a>${c.marketingConsent ? `<button type="button" class="btn btn--danger" data-act="revokeConsent" data-customer-id="${esc(c.id)}">Retirar autorización</button>` : ''}</div></article>`;
      }).join('');
      const ready = campaignLinksReady ? chosen : [];
      const campaignCards = ready.map(c => {
        const message = campaignText.replace(/\{nombre\}/g, c.name || '');
        return `<div class="campaign-link"><strong>${esc(c.name)}</strong><span>${esc(c.phone)}</span><a class="btn btn--small" href="${waUrl(c.phone, message)}" target="_blank" rel="noopener">Abrir mensaje</a></div>`;
      }).join('');
      return `<section class="card"><h2>Clientes de Cochi</h2><p class="card__intro">Los datos se guardan en la base de datos conectada al servidor y solo son visibles en este panel privado.</p><input type="search" id="customerSearch" placeholder="Buscar por nombre, teléfono o correo" value="${esc(customerQuery)}" aria-label="Buscar clientes"><div class="metric-grid"><div class="metric"><strong>${customers.length}</strong><span>Clientes guardados</span></div><div class="metric"><strong>${customers.filter(c=>c.marketingConsent && c.marketingChannel !== 'email').length}</strong><span>Autorizaron WhatsApp</span></div></div><p class="preview">${rows.length} cliente(s) encontrados · ${eligible.length} autorizados en esta búsqueda.</p><div class="item__bar"><button type="button" class="btn btn--small" data-act="selectAllCustomers">Seleccionar autorizados</button><button type="button" class="btn btn--small" data-act="clearCustomerSelection">Limpiar selección</button><button type="button" class="btn btn--small" data-act="refreshCustomers">Actualizar</button></div></section><section class="card"><h2>Preparar campaña por WhatsApp</h2><p class="card__intro">Selecciona solo clientes que autorizaron promociones. Se generará un enlace individual para abrir cada chat con el texto listo; tú decides cuándo enviarlo.</p><label class="field">Mensaje de promoción<textarea id="campaignText" rows="4" maxlength="900">${esc(campaignText)}</textarea><small>Puedes usar {nombre} para personalizar el saludo.</small></label><p class="muted">${selectedCustomerIds.size} seleccionado(s) · ${chosen.length} elegible(s) con autorización vigente.</p><button type="button" class="btn btn--red" data-act="prepareCampaign" ${chosen.length ? '' : 'disabled'}>Preparar ${chosen.length} mensaje(s)</button>${campaignLinksReady ? `<div class="campaign-results"><p class="preview">Mensajes listos para enviar individualmente: ${chosen.length}.</p>${campaignCards || '<p class="muted">No hay destinatarios seleccionados con autorización.</p>'}</div>` : ''}<p class="muted">WhatsApp no se envía automáticamente desde esta página. No se abrirán chats en cadena ni se enviarán mensajes sin revisión.</p></section>${cards || '<section class="card"><p class="muted">Todavía no hay clientes registrados.</p></section>'}`;
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
    chooseTheme(el) { data.settings.theme.preset = THEME_PRESETS.some(p => p.id === el.dataset.themeId) ? el.dataset.themeId : 'original'; markDirty(); render(); toast('Tema seleccionado. Guarda los cambios para publicarlo.'); },
    async uploadThemeAsset(el) { const url = await uploadImage(1200); if (url) { data.settings.theme[el.dataset.asset] = url; markDirty(); render(); } },
    removeThemeAsset(el) { data.settings.theme[el.dataset.asset] = ''; markDirty(); render(); toast('Se usará el recurso original de Cochi.'); },
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
    addCoupon() { data.cp.coupons.unshift({ code: '', label: '', type: 'percent', value: 10, max_uses: 0, per_customer: false, phone: '', min_order_usd: 0, active: true, start: '', end: '' }); markDirty(); render(); },
    delCoupon(el) { if (confirm('¿Eliminar este cupón?')) { data.cp.coupons.splice(el.dataset.i, 1); markDirty(); render(); } },
    genCode(el) { data.cp.coupons[el.dataset.i].code = `COCHI-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; markDirty(); render(); },
    addRule() { data.upsells.push({ id: `sugerencia-${Math.random().toString(16).slice(2, 7)}`, title: 'Agrégale algo más', text: '', when_categories: [], add_slug: data.products[0]?.slug || '', price_usd: 1, max_per_item: 1, active: true, start: '', end: '', start_time: '', end_time: '', days: [] }); markDirty(); render(); },
    delRule(el) { if (confirm('¿Eliminar esta sugerencia?')) { data.upsells.splice(el.dataset.i, 1); markDirty(); render(); } },
    addAnn() { data.announcements.push(''); markDirty(); render(); },
    delAnn(el) { data.announcements.splice(el.dataset.i, 1); markDirty(); render(); },
    async refreshOrders() { orders = (await api('orders')).orders || []; ordersLimit = 50; render(); toast('Pedidos actualizados.'); },
    loadMoreOrders() { ordersLimit += 50; render(); },
    feeStep(el) {
      const input = document.querySelector(`[data-order-fee="${el.dataset.orderId}"]`); if (!input) return;
      input.value = Math.min(999, Math.max(0, round2((parseFee(input.value) ?? 0) + Number(el.dataset.step)))).toFixed(2);
      syncFee(input); input.focus();
    },
    previewOrder(el) {
      const order = orders.find(o => String(o.id) === el.dataset.orderId); if (!order) throw new Error('No se encontró esa comanda.');
      let fee = Number(order.deliveryFeeUSD) || 0;
      if (order.status !== 'confirmed' && order.mode !== 'pickup') {
        const input = document.querySelector(`[data-order-fee="${order.id}"]`);
        fee = parseFee(input ? input.value : feeValue(order));
        if (fee === null) { input?.focus(); throw new Error('Escribe un costo de delivery válido (entre 0 y 999; usa 0 si no se cobra).'); }
      }
      return openPreview(order, fee);
    },
    closePreview() { closePreview(); },
    async confirmAndPrint() {
      if (!preview || preview.saving) return;
      const order = orders.find(o => String(o.id) === preview.id); if (!order) throw new Error('No se encontró esa comanda.');
      preview.saving = true; paintFoot();
      try {
        const result = await api(`orders/${encodeURIComponent(order.id)}`, { method: 'PUT', body: JSON.stringify({ deliveryFeeUSD: preview.fee }) });
        orders = orders.map(o => String(o.id) === String(order.id) ? result.order : o); delete feeDrafts[order.id];
        preview.saving = false; preview.printed = true;
        render(); paintNote(result.order, result.order); paintFoot();
        const html = receiptHtml(result.order);
        if (html !== currentReceiptHtml) await loadFrame(html); // solo si el servidor cambió algo
        printFrame();
        $('#modalFoot .btn--red')?.focus(); // imprimir deja el foco dentro de la comanda: se devuelve al botón
      } catch (error) { if (preview) { preview.saving = false; paintFoot(); } throw error; }
    },
    printPreview() { if (!preview) return; if (printFrame()) { preview.printed = true; paintFoot(); $('#modalFoot .btn--red')?.focus(); } },
    async refreshCustomers() { customers = (await api('customers')).customers || []; render(); toast('Clientes actualizados.'); },
    selectAllCustomers() { customers.filter(c => c.marketingConsent && c.marketingChannel !== 'email' && (!customerQuery.trim() || `${c.name} ${c.phone} ${c.email || ''}`.toLowerCase().includes(customerQuery.trim().toLowerCase()))).forEach(c => selectedCustomerIds.add(String(c.id))); campaignLinksReady = false; render(); },
    clearCustomerSelection() { selectedCustomerIds.clear(); campaignLinksReady = false; render(); },
    async prepareCampaign() { if (!campaignText.trim()) throw new Error('Escribe el mensaje de la campaña.'); customers = (await api('customers')).customers || []; const authorized = new Set(customers.filter(c => c.marketingConsent && c.marketingChannel !== 'email').map(c => String(c.id))); selectedCustomerIds = new Set([...selectedCustomerIds].filter(id => authorized.has(id))); if (!selectedCustomerIds.size) throw new Error('No hay clientes seleccionados con autorización vigente para WhatsApp.'); campaignLinksReady = true; render(); },
    async revokeConsent(el) { const id = el.dataset.customerId; await api(`customers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ marketingConsent: false }) }); customers = customers.map(c => String(c.id) === id ? { ...c, marketingConsent: false, marketingConsentAt: null } : c); selectedCustomerIds.delete(id); campaignLinksReady = false; render(); toast('Autorización retirada. El cliente ya no aparece como destinatario.'); }
  };
  const AFTER = {
    bs() { document.querySelectorAll('[data-bs]').forEach(n => { n.textContent = `Bs. ${bs(data.products[n.dataset.bs].price_usd)}`; }); const p = $('#ratePreview'); const s = data.products.find(x => x.slug === 'shawarma-cesar') || data.products[0]; if (p && s) p.textContent = `${s.name}: $${money(s.price_usd)} = Bs. ${bs(s.price_usd)}`; },
    rerender() { render(); }
  };
  const CHANGES = {
    flyerLink(el) { const f = data.flyers[el.dataset.i]; f.link = el.value === '__url' ? 'https://' : el.value; if (!el.value) f.linkLabel = ''; markDirty(); render(); },
    ruleCat(el) { const rule = data.upsells[el.dataset.i]; const set = new Set(rule.when_categories); el.checked ? set.add(el.value) : set.delete(el.value); rule.when_categories = [...set]; markDirty(); },
    ruleDay(el) { const rule = data.upsells[el.dataset.i]; const set = new Set(rule.days || []); el.checked ? set.add(Number(el.value)) : set.delete(Number(el.value)); rule.days = [...set].sort(); markDirty(); }
  };

  document.addEventListener('click', async event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) {
      tab = tabButton.dataset.tab; render(); window.scrollTo({ top: 0 });
      if (tab === 'clientes') api('customers').then(r => { customers = r.customers || []; render(); }).catch(e => toast(e.message, true));
      if (tab === 'comandas' || tab === 'estadisticas') api('orders').then(r => { orders = r.orders || []; render(); }).catch(e => toast(e.message, true));
      return;
    }
    const el = event.target.closest('[data-act]'); if (!el) return;
    try { await ACTIONS[el.dataset.act]?.(el); } catch (error) { if (error.status === 401) showLogin('Tu sesión venció. Entra de nuevo.'); else toast(error.message, true); }
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[data-order-fee]')) { syncFee(event.target); return; }
    if (event.target.id === 'q') { query = event.target.value; $('#plist').innerHTML = productList(); return; }
    if (event.target.id === 'customerSearch') { customerQuery = event.target.value; const pos = event.target.selectionStart; render(); const input = $('#customerSearch'); input.focus(); input.setSelectionRange(pos, pos); return; }
    if (event.target.id === 'campaignText') { campaignText = event.target.value; campaignLinksReady = false; return; }
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
    if (event.target.matches('[data-customer-select]')) {
      const id = String(event.target.dataset.customerSelect);
      if (event.target.checked) selectedCustomerIds.add(id); else selectedCustomerIds.delete(id);
      campaignLinksReady = false; render(); return;
    }
    if (event.target.id === 'statsPeriod') { statsPeriod = event.target.value; render(); return; }
    const el = event.target.closest('[data-act-change]'); if (el) CHANGES[el.dataset.actChange](el);
    const after = event.target.closest('[data-after="rerender"]'); if (after) render();
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  // Vista previa: Esc la cierra, tocar el fondo oscuro también, y Tab no se escapa hacia la página de atrás.
  document.addEventListener('click', event => { if (preview && event.target.id === 'receiptModal') closePreview(); });
  document.addEventListener('keydown', event => {
    if (!preview) return;
    if (event.key === 'Escape') { event.preventDefault(); closePreview(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...$('#receiptModal').querySelectorAll('button:not([disabled]),a[href],input,select,textarea')].filter(n => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  async function save() {
    const button = $('#saveBtn'); button.disabled = true; button.textContent = 'Guardando...';
    try {
      data.upsells.forEach(u => { u.price_usd = Number(u.price_usd) || 0; });
      const { cp, ...content } = data;
      await api('content', { method: 'PUT', body: JSON.stringify({ content }) });
      try {
        await api('coupons', { method: 'PUT', body: JSON.stringify({ coupons: cp }) });
        data.cp = (await api('coupons')).coupons;
      } catch (couponError) {
        throw new Error(`El contenido principal se guardó, pero los cupones no: ${couponError.message}`);
      }
      fromDefaults = false; markDirty(false); render(); toast('Guardado. El sitio ya muestra los cambios.');
    } catch (error) { if (error.status === 401) showLogin('Tu sesión venció. Entra de nuevo.'); else toast(error.message, true); markDirty(true); }
    finally { button.textContent = 'Guardar cambios'; button.disabled = !dirty || storage === 'none'; }
  }

  /* ---------- Inicio y sesión ---------- */
  function showLogin(message = '') {
    closePreview();
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
    const base = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, open: [5, 6, 0].includes(day), from: '00:00', to: '23:59' }));
    data.settings.schedule = base.map(b => ({ ...b, ...((data.settings.schedule || []).find(x => x.day === b.day) || {}) }));
    data.settings.ordersPaused = Boolean(data.settings.ordersPaused);
    const validThemes = THEME_PRESETS.map(item => item.id);
    data.settings.theme = { preset: validThemes.includes(data.settings.theme?.preset) ? data.settings.theme.preset : 'original', logoHeader: data.settings.theme?.logoHeader || '', logoFooter: data.settings.theme?.logoFooter || '', isotipo: data.settings.theme?.isotipo || '' };
    data.cp = await api('coupons').then(r => r.coupons).catch(() => ({ enabled: false, coupons: [] }));
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
    } catch (error) { showLogin(error?.status ? error.message : 'No se pudo conectar con el servidor.'); }
  })();
})();
