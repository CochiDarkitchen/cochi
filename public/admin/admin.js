(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Ordenadas por uso diario: lo que el equipo toca cada día va primero.
  const TABS = [['inicio', 'Inicio'], ['comandas', 'Comandas'], ['productos', 'Productos'], ['tasa', 'Tasa y datos'], ['horario', 'Horario'], ['ofertas', 'Ofertas y avisos'], ['cupones', 'Cupones'], ['flyers', 'Flyers'], ['clientes', 'Clientes'], ['estadisticas', 'Estadísticas'], ['comentarios', 'Comentarios'], ['temas', 'Temas']];
  /* ---------- Estados de la comanda ---------- */
  const ACTIVE_STATUSES = ['confirmed', 'preparing', 'ready', 'delivered'];
  const hasTotal = o => o.finalTotalUSD !== null && o.finalTotalUSD !== undefined;
  const isConfirmed = o => ACTIVE_STATUSES.includes(o.status) && hasTotal(o);
  const isCancelled = o => o.status === 'cancelled';
  const isPending = o => !isConfirmed(o) && !isCancelled(o);
  const stageOf = o => (isCancelled(o) ? 'cancelled' : isPending(o) ? 'pending' : o.status);
  const STAGE_LABEL = { pending: 'Pendiente', confirmed: 'Confirmada', preparing: 'En preparación', ready: 'En camino', delivered: 'Entregada', cancelled: 'Cancelada' };
  const stageLabel = o => (stageOf(o) === 'ready' && o.mode === 'pickup' ? 'Lista para retirar' : STAGE_LABEL[stageOf(o)]);
  const STAGE_CHIP = { pending: 'soon', confirmed: 'on', preparing: 'prep', ready: 'ready', delivered: 'done', cancelled: 'off' };
  const NEXT_STAGE = { confirmed: 'preparing', preparing: 'ready', ready: 'delivered' };
  const nextLabel = (o, stage) => (stage === 'preparing' ? 'Pasar a: en preparación' : stage === 'ready' ? (o.mode === 'pickup' ? 'Pasar a: lista para retirar' : 'Pasar a: en camino') : 'Marcar como entregada');
  // Teléfonos venezolanos: 0412... o 412... se convierten a 58412... para que WhatsApp los abra bien.
  function waPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (/^0\d{10}$/.test(digits)) return `58${digits.slice(1)}`;
    if (/^4\d{9}$/.test(digits)) return `58${digits}`;
    return digits;
  }
  const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';
  function orderMessage(order, kind) {
    const hi = `¡Hola${firstName(order.name) ? ` ${firstName(order.name)}` : ''}!`;
    const total = hasTotal(order) ? Number(order.finalTotalUSD) : Number(order.total || 0);
    const rate = orderRate(order), bsText = rate > 0 ? ` (Bs. ${fmtBs(total * rate)})` : '';
    const pay = String(data?.settings?.paymentInfo || '').trim();
    const messages = {
      received: `${hi} Recibimos tu pedido ${order.id} en Cochi. En un momento te confirmamos el total${order.mode === 'pickup' ? '' : ' con el delivery'}.`,
      total: `${hi} Tu pedido ${order.id} quedó en ${moneyText(total)}${bsText}${order.mode === 'pickup' ? '' : ', con delivery incluido'}.${pay ? `\n\nDatos para el depósito:\n${pay}` : ''}\n\nApenas recibamos el depósito empezamos a prepararlo. ¡Gracias por pedir en Cochi!`,
      preparing: `${hi} Ya estamos preparando tu pedido ${order.id}. Te avisamos cuando ${order.mode === 'pickup' ? 'esté listo para retirar' : 'salga para tu dirección'}.`,
      ready: order.mode === 'pickup' ? `${hi} Tu pedido ${order.id} está listo para retirar. ¡Te esperamos!` : `${hi} Tu pedido ${order.id} va en camino. ¡Prepárate para el antojo!`,
      thanks: `${hi} Gracias por pedir en Cochi. ¿Qué tal estuvo todo? Tu opinión nos ayuda muchísimo.`
    };
    return messages[kind] || '';
  }
  const WA_FOR_STAGE = { pending: ['received', 'Avisar que lo recibimos'], confirmed: ['total', 'Enviar total y datos de pago'], preparing: ['preparing', 'Avisar: en preparación'], ready: ['ready', 'Avisar: en camino'], delivered: ['thanks', 'Pedir opinión'] };
  const SOUND_KEY = 'cochi-admin-sound';
  let soundOn = (() => { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; } })();
  let knownOrderIds = null, pollTimer = null, orderFilter = 'activas', orderQuery = '', ordersToday = false, productFilter = 'todos', customerSort = 'recientes';
  function beep() {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = freq; osc.type = 'sine'; osc.connect(gain); gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at); gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
        osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.18);
      });
      setTimeout(() => ctx.close(), 900);
    } catch { /* sin audio */ }
  }
  function updateTitle() { const n = orders.filter(isPending).length; document.title = n ? `(${n}) Panel Cochi` : 'Panel Cochi'; }
  const isToday = value => value && new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }) === today();
  const userIsBusy = () => Boolean(preview) || (document.activeElement && $('#panel')?.contains(document.activeElement) && document.activeElement.matches('input,textarea,select'));
  async function pollOrders() {
    if (!['inicio', 'comandas'].includes(tab) || storage === 'none') return;
    try {
      const fresh = (await api('orders')).orders || [];
      const newOnes = knownOrderIds ? fresh.filter(o => !knownOrderIds.has(String(o.id))) : [];
      knownOrderIds = new Set(fresh.map(o => String(o.id)));
      orders = fresh; updateTitle();
      if (newOnes.length) { beep(); toast(newOnes.length === 1 ? `Nuevo pedido de ${newOnes[0].name} (${newOnes[0].id}).` : `${newOnes.length} pedidos nuevos.`); }
      if (!userIsBusy()) render();
    } catch (error) { if (error.status === 401) showLogin('Tu sesión venció. Entra de nuevo.'); }
  }
  function startPolling() { if (!pollTimer) pollTimer = setInterval(pollOrders, 30000); }
  // Archivo CSV que abre bien en Excel en español (separado por punto y coma, con acentos).
  function downloadCsv(filename, rows) {
    const cell = value => { const text = String(value ?? '').replace(/\r?\n/g, ' '); return /[";]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
    const blob = new Blob(['﻿' + rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; document.body.appendChild(link); link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 500);
  }
  const csvNumber = n => (Number(n) || 0).toFixed(2).replace('.', ',');
  const THEME_PRESETS = [
    { id: 'original', name: 'Cochi original', note: 'Rojo intenso y crema', colors: ['#eb140c', '#e6e0bf', '#211e1a'], palette: { primary:'#eb140c',primaryDark:'#c90f09',cream:'#e6e0bf',background:'#f5f0dc',surface:'#fbf7e9',text:'#211e1a',mutedText:'#60594e',border:'#211e1a',dulcePink:'#f1d6df',dulcePinkLight:'#faeaf0',dulceChocolate:'#4b2928',green:'#1f6644',white:'#fffdf7',redInk:'#bd0d07',announcementBg:'#eb140c',announcementText:'#fffdf7',announcementDot:'#e6e0bf',headerStripeStart:'#eb140c',headerStripeEnd:'#eb140c',featureGradientStart:'#b80f09',featureGradientEnd:'#ed261c' } },
    { id: 'black-friday', name: 'Black Friday', note: 'Negro, dorado y alto contraste', colors: ['#151515', '#e4b64e', '#f8f2e7'], palette: { primary:'#e0b34d',primaryDark:'#ba8c29',cream:'#e9c875',background:'#151515',surface:'#22211f',text:'#f8f2e7',mutedText:'#c9c1b1',border:'#f8f2e7',dulcePink:'#302b26',dulcePinkLight:'#f5ead6',dulceChocolate:'#e0b34d',green:'#80a98a',white:'#fffaf0',redInk:'#e9c875',announcementBg:'#080808',announcementText:'#f1cc72',announcementDot:'#f1cc72',headerStripeStart:'#e0b34d',headerStripeEnd:'#ba8c29',featureGradientStart:'#77551b',featureGradientEnd:'#d0a33e' } },
    { id: 'navidad', name: 'Navidad', note: 'Rojo festivo, verde y dorado', colors: ['#b52331', '#24563b', '#dbb75c'], palette: { primary:'#b52331',primaryDark:'#8f1925',cream:'#dbb75c',background:'#f2ecda',surface:'#fff9eb',text:'#203b2d',mutedText:'#5e6a5e',border:'#203b2d',dulcePink:'#f0d9d8',dulcePinkLight:'#fff0e9',dulceChocolate:'#6c3b36',green:'#24563b',white:'#fffaf0',redInk:'#98202b',announcementBg:'#1c5139',announcementText:'#fff4dc',announcementDot:'#dbb75c',headerStripeStart:'#1d6845',headerStripeEnd:'#b52331',featureGradientStart:'#1d6845',featureGradientEnd:'#b52331' } },
    { id: 'ano-nuevo', name: 'Año Nuevo', note: 'Azul noche y champagne', colors: ['#11192c', '#d7b76a', '#f8f3e8'], palette: { primary:'#d7b76a',primaryDark:'#b89445',cream:'#e7cf91',background:'#11192c',surface:'#1c2740',text:'#f8f3e8',mutedText:'#c6c1b7',border:'#f8f3e8',dulcePink:'#30334b',dulcePinkLight:'#f4e9d1',dulceChocolate:'#d7b76a',green:'#8cae9c',white:'#fffaf0',redInk:'#e7cf91',announcementBg:'#0b1223',announcementText:'#e7cf91',announcementDot:'#e7cf91',headerStripeStart:'#d7b76a',headerStripeEnd:'#f7e6b2',featureGradientStart:'#1c2740',featureGradientEnd:'#d7b76a' } },
    { id: 'san-valentin', name: 'San Valentín', note: 'Rosa suave y borgoña', colors: ['#ae3456', '#efd4db', '#4b2330'], palette: { primary:'#ae3456',primaryDark:'#842542',cream:'#dca4b0',background:'#f5e6e8',surface:'#fff6f6',text:'#4b2330',mutedText:'#785765',border:'#4b2330',dulcePink:'#efd4db',dulcePinkLight:'#fff0f3',dulceChocolate:'#6a3046',green:'#52735e',white:'#fffafb',redInk:'#842542',announcementBg:'#842542',announcementText:'#fff0f3',announcementDot:'#f1c3cf',headerStripeStart:'#ae3456',headerStripeEnd:'#e7b2bf',featureGradientStart:'#ae3456',featureGradientEnd:'#e7b2bf' } }
  ];
  const THEME_COLOR_GROUPS = [
    { title: 'Colores principales', fields: [
      ['primary','Color principal','Botones, enlaces y acentos'], ['primaryDark','Color principal oscuro','Estados activos y variaciones'], ['cream','Color crema / acento','Detalles claros y fondos de apoyo'], ['background','Fondo general','Fondo principal de toda la página'], ['surface','Tarjetas y superficies','Tarjetas, paneles y bloques'], ['text','Texto principal','Títulos y textos principales'], ['mutedText','Texto secundario','Descripciones y textos suaves'], ['border','Bordes y divisores','El color se aplica con transparencia']
    ]},
    { title: 'Cochi Dulce y colores complementarios', fields: [
      ['dulcePink','Rosa Cochi Dulce','Fondos de la marca dulce'], ['dulcePinkLight','Rosa claro','Superficies claras de Cochi Dulce'], ['dulceChocolate','Chocolate','Textos y acentos de Cochi Dulce'], ['green','Verde complementario','Detalles y estados complementarios'], ['white','Blanco','Elementos de alto contraste'], ['redInk','Texto de acento','Textos destacados y etiquetas']
    ]},
    { title: 'Detalles de temporada', fields: [
      ['announcementBg','Fondo de la franja superior','Banda informativa del encabezado'], ['announcementText','Texto de la franja superior','Texto de la banda informativa'], ['announcementDot','Punto decorativo','Puntos de la banda superior'], ['headerStripeStart','Franja del encabezado – color 1','Primer tono de la línea decorativa'], ['headerStripeEnd','Franja del encabezado – color 2','Segundo tono de la línea decorativa'], ['featureGradientStart','Degradado de tarjetas – inicio','Inicio del degradado decorativo'], ['featureGradientEnd','Degradado de tarjetas – final','Final del degradado decorativo']
    ]}
  ];
  let data = null, tab = 'inicio', dirty = false, openSlug = null, query = '', storage = 'file', fromDefaults = false, toastTimer = null, customers = [], customerQuery = '', orders = [], feeDrafts = {}, preview = null, modalReturnFocus = null, currentReceiptHtml = '', ordersLimit = 50, statsPeriod = '30', selectedCustomerIds = new Set(), campaignText = '¡Hola {nombre}! Tenemos novedades en Cochi. Queremos compartirte nuestros nuevos platillos y promociones. Escríbenos por aquí para conocerlos.', campaignLinksReady = false;

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
    const order = orders.find(o => String(o.id) === preview.id), confirmed = order ? isConfirmed(order) : false, busy = preview.saving ? 'disabled' : '';
    $('#modalFoot').innerHTML = confirmed
      ? `<button type="button" class="btn" data-act="closePreview">Cerrar</button><button type="button" class="btn btn--red" data-act="printPreview">${preview.printed ? 'Imprimir otra vez' : 'Imprimir'}</button>`
      : `<button type="button" class="btn" data-act="closePreview" ${busy}>Volver y editar</button><button type="button" class="btn btn--red" data-act="confirmAndPrint" ${busy}>${preview.saving ? 'Guardando…' : 'Confirmar e imprimir'}</button>`;
  }
  function paintNote(order, shown) {
    const confirmed = isConfirmed(order), pickup = order.mode === 'pickup';
    $('#modalTitle').textContent = `Vista previa · ${order.id}`;
    $('#modalNote').innerHTML = confirmed
      ? `<span class="chip chip--${STAGE_CHIP[stageOf(order)]}">${esc(stageLabel(order))}</span><span>Total guardado: <strong>${moneyText(shown.finalTotalUSD)}</strong>${pickup ? '' : ` (delivery ${moneyText(shown.deliveryFeeUSD)})`}</span>`
      : `<span class="chip chip--soon">Aún no confirmada</span><span>${pickup ? 'Retiro: sin delivery.' : `Delivery <strong>${moneyText(shown.deliveryFeeUSD)}</strong>.`} Total <strong>${moneyText(shown.finalTotalUSD)}</strong>. Se guarda al confirmar.</span>`;
  }
  async function openPreview(order, fee) {
    preview = { id: String(order.id), fee, saving: false, printed: false };
    modalReturnFocus = document.activeElement;
    const shown = isConfirmed(order) ? order : draftOrder(order, fee);
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
      theme.customColors ||= {};
      theme.customColors[theme.preset] ||= {};
      const cards = THEME_PRESETS.map(preset => {
        const saved = theme.customColors[preset.id] || {};
        const swatches = ['background','primary','text'].map(key => saved[key] || preset.palette[key]);
        return `<button type="button" class="theme-option${theme.preset === preset.id ? ' is-selected' : ''}" data-act="chooseTheme" data-theme-id="${preset.id}" aria-pressed="${theme.preset === preset.id}">
        <span class="theme-option__swatches">${swatches.map(color => `<i style="--swatch:${color}"></i>`).join('')}</span>
        <strong>${preset.name}</strong><small>${preset.note}</small>
        <span class="theme-option__state">${theme.preset === preset.id ? 'Tema seleccionado' : 'Seleccionar tema'}</span>
      </button>`;
      }).join('');
      const activePreset = THEME_PRESETS.find(p => p.id === theme.preset) || THEME_PRESETS[0];
      const activeColors = theme.customColors[theme.preset] || {};
      const colorGroups = THEME_COLOR_GROUPS.map(group => `<section class="theme-color-group"><h3>${group.title}</h3><div class="theme-color-grid">${group.fields.map(([key,label,hint]) => {
        const hex = activeColors[key] || activePreset.palette[key];
        return `<label class="theme-color-field"><span class="theme-color-field__name">${label}</span><div class="theme-color-control"><input type="color" data-theme-color-picker="${key}" data-theme-preset="${theme.preset}" value="${hex}" aria-label="Selector de color: ${label}"><input type="text" data-theme-color-hex="${key}" data-theme-preset="${theme.preset}" data-b="settings.theme.customColors.${theme.preset}.${key}" data-last-valid="${hex}" value="${hex}" maxlength="7" minlength="7" pattern="#[0-9A-Fa-f]{6}" spellcheck="false" autocapitalize="characters" aria-label="Código HEX de ${label}" title="Formato hexadecimal: #RRGGBB"></div><small>${hint}</small></label>`;
      }).join('')}</div></section>`).join('');
      const assets = [
        { key: 'logoHeader', title: 'Logo principal', subtitle: 'Se muestra en la parte superior del menú', fallback: '/assets/brand/cochi-logo-red.png', upload: 'Subir logo principal' },
        { key: 'logoFooter', title: 'Logo para fondo oscuro', subtitle: 'Se muestra en el pie de página', fallback: '/assets/brand/cochi-logo-cream.png', upload: 'Subir logo de pie de página' },
        { key: 'isotipo', title: 'Isotipo / cerdito', subtitle: 'Se usa en la intro y los detalles de marca', fallback: '/assets/brand/cochi-isotipo-red.png', upload: 'Subir isotipo' }
      ].map(asset => {
        const src = theme[asset.key] || asset.fallback;
        return `<article class="theme-asset"><div class="theme-asset__preview"><img src="${esc(src)}" alt="Vista previa: ${asset.title}"></div><div class="theme-asset__copy"><strong>${asset.title}</strong><small>${asset.subtitle}</small><small>${theme[asset.key] ? 'Logo personalizado cargado' : 'Se usará el logo original de Cochi'}</small><div class="theme-asset__actions"><button type="button" class="btn btn--small" data-act="uploadThemeAsset" data-asset="${asset.key}">${theme[asset.key] ? 'Cambiar imagen' : asset.upload}</button>${theme[asset.key] ? `<button type="button" class="btn btn--danger" data-act="removeThemeAsset" data-asset="${asset.key}">Usar original</button>` : ''}</div></div></article>`;
      }).join('');
      return `<section class="card"><h2>Temáticas de temporada</h2><p class="card__intro">Elige una temática para cambiar la paleta de colores de todo el menú digital: fondos, textos, botones, secciones y detalles. El cambio se publica cuando pulses <strong>Guardar cambios</strong>.</p><div class="theme-grid">${cards}</div><p class="preview">Tema activo: <strong>${esc(activePreset.name)}</strong>. Puedes volver al diseño original en cualquier momento.</p></section>
        <section class="card"><div class="theme-color-heading"><div><h2>Personalizar colores HEX</h2><p class="card__intro">Edita cada color de <strong>${esc(activePreset.name)}</strong>. Escribe el código hexadecimal o usa el selector visual. Cada temática guarda su propia paleta.</p></div><button type="button" class="btn btn--small" data-act="resetThemeColors">Restablecer paleta</button></div><div class="theme-color-groups">${colorGroups}</div><p class="muted">Usa el formato <strong>#RRGGBB</strong>, por ejemplo <strong>#EB140C</strong>. Los cambios se publican al pulsar Guardar cambios.</p></section>
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
      const counts = { todos: data.products.length, agotados: data.products.filter(p => p.available === false).length, ocultos: data.products.filter(p => p.is_visible === false).length, sinfoto: data.products.filter(p => !p.image).length, destacados: data.products.filter(p => p.featured).length };
      const chips = [['todos', 'Todos'], ['agotados', 'Agotados'], ['ocultos', 'Ocultos'], ['sinfoto', 'Sin foto'], ['destacados', 'Destacados']].map(([id, label]) => `<button type="button" class="fchip${productFilter === id ? ' is-on' : ''}" data-act="productFilter" data-filter="${id}" aria-pressed="${productFilter === id}">${label} <b>${counts[id]}</b></button>`).join('');
      return `<div class="toolbar"><input type="search" id="q" placeholder="Buscar producto" value="${esc(query)}" aria-label="Buscar producto"><button type="button" class="btn btn--red" data-act="addProduct">Agregar</button></div><div class="filters" role="group" aria-label="Filtrar productos">${chips}</div><p class="muted">Consejo: los platos con foto se piden más. Usa “Sin foto” para ver cuáles faltan. Con las flechas cambias el orden en que aparecen en el menú.</p><div id="plist" style="display:grid;gap:12px">${productList()}</div>`;
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
    inicio() {
      const s = data.settings, state = storeState();
      const todayOrders = orders.filter(o => isToday(o.createdAt));
      const pending = orders.filter(isPending);
      const inProgress = orders.filter(o => ['confirmed', 'preparing', 'ready'].includes(stageOf(o)));
      const soldToday = todayOrders.filter(isConfirmed).reduce((sum, o) => sum + (Number(o.finalTotalUSD) || 0), 0);
      const weekAgo = Date.now() - 7 * 86400000, productMap = new Map();
      orders.filter(o => !isCancelled(o) && new Date(o.createdAt).getTime() >= weekAgo).forEach(o => (o.items || []).forEach(item => productMap.set(item.name, (productMap.get(item.name) || 0) + (Number(item.quantity) || 0))));
      const top = [...productMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const maxTop = Math.max(1, ...top.map(([, v]) => v));
      const stock = data.products.map((p, i) => ({ p, i })).filter(({ p }) => p.is_visible !== false && !p.is_coming_soon);
      const outCount = stock.filter(({ p }) => p.available === false).length;
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
      const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
      const longDate = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
      const sample = data.products.find(p => p.slug === 'shawarma-cesar') || data.products[0];
      const pendingList = pending.slice(0, 6).map(o => `<button type="button" class="mini-order" data-act="goTab" data-goto="comandas"><span class="mini-order__id">${esc(o.id)}</span><span class="mini-order__who">${esc(o.name)} · ${o.mode === 'pickup' ? 'Retiro' : 'Delivery'}${o.sector ? ` · ${esc(o.sector)}` : ''}</span><strong>${moneyText(o.total)}</strong><small>${esc(timeAgo(o.createdAt))}</small></button>`).join('');
      return `<section class="card status-card status-card--${state.kind}"><div class="status-card__main"><span class="status-card__dot" aria-hidden="true"></span><div><small>${greeting}, equipo Cochi · ${esc(longDate)}</small><h2>${esc(state.title)}</h2><p>${esc(state.detail)}</p></div></div><button type="button" class="btn ${s.ordersPaused ? 'btn--red' : 'btn--light'}" data-act="togglePause">${s.ordersPaused ? 'Reanudar pedidos' : 'Pausar pedidos ahora'}</button></section>
        <section class="card"><div class="section-head"><div><h2>Hoy en Cochi</h2><p class="card__intro">Resumen del día con la hora de Caracas.</p></div><button type="button" class="btn btn--small" data-act="goTab" data-goto="comandas">Ir a comandas</button></div>
        <div class="metric-grid metric-grid--4"><div class="metric${pending.length ? ' metric--alert' : ''}"><strong>${pending.length}</strong><span>Por confirmar</span></div><div class="metric"><strong>${inProgress.length}</strong><span>En curso</span></div><div class="metric"><strong>${todayOrders.length}</strong><span>Pedidos de hoy</span></div><div class="metric"><strong>${moneyText(soldToday)}</strong><span>Confirmado hoy</span></div></div>
        ${pending.length ? `<h3 class="subheading">Esperan tu confirmación</h3><div class="mini-orders">${pendingList}</div>` : '<p class="empty-ok">Todo al día: no hay pedidos esperando confirmación.</p>'}
        <p class="muted live-note"><span class="live-dot" aria-hidden="true"></span> Se actualiza sola cada 30 segundos y suena un aviso con cada pedido nuevo. <button type="button" class="linkbtn" data-act="toggleSound">${soundOn ? 'Apagar sonido' : 'Encender sonido'}</button></p></section>
        <section class="card"><div class="section-head"><div><h2>Tasa del día</h2><p class="card__intro">Actualízala antes de abrir. Los precios en bolívares del menú se calculan solos.</p></div>${s.exchangeRateDate === today() ? '<span class="chip chip--on">Fecha de hoy</span>' : '<span class="chip chip--soon">No es de hoy</span>'}</div>
        <div class="row2">${field('Bolívares por 1 USD', 'settings.usdToVes', s.usdToVes, 'type="number" data-t="n" step="0.01" min="0" inputmode="decimal" data-after="bs"')}<div class="row-inline">${field('Fecha de la tasa', 'settings.exchangeRateDate', s.exchangeRateDate, 'type="date"')}<button type="button" class="btn btn--small" data-act="today">Hoy</button></div></div>
        <p class="preview" id="ratePreview">${sample ? `${esc(sample.name)}: $${money(sample.price_usd)} = Bs. ${bs(sample.price_usd)}` : ''}</p></section>
        <section class="card"><div class="section-head"><div><h2>¿Qué hay hoy?</h2><p class="card__intro">Toca un producto para marcarlo como agotado o disponible. Se publica al pulsar <strong>Guardar cambios</strong>.</p></div><span class="chip ${outCount ? 'chip--off' : 'chip--on'}">${outCount ? `${outCount} agotado(s)` : 'Todo disponible'}</span></div>
        <div class="stock-grid">${stock.map(({ p, i }) => `<label class="stock${p.available === false ? ' is-out' : ''}"><input type="checkbox" data-b="products.${i}.available" data-after="rerender" ${p.available !== false ? 'checked' : ''}><span class="stock__name">${esc(p.name)}</span><span class="stock__state">${p.available !== false ? 'Disponible' : 'Agotado'}</span></label>`).join('')}</div></section>
        ${top.length ? `<section class="card"><h2>Lo más pedido esta semana</h2>${top.map(([name, qty]) => `<div class="bar-row"><div><span>${esc(name)}</span><strong>${qty} uds.</strong></div><span class="bar-track"><i style="width:${Math.round(qty / maxTop * 100)}%"></i></span></div>`).join('')}</section>` : ''}`;
    },
    comandas() {
      const count = stage => orders.filter(o => stageOf(o) === stage).length;
      const q = orderQuery.trim().toLowerCase();
      const FILTERS = [['activas', 'Activas'], ['pending', 'Por confirmar'], ['encurso', 'En curso'], ['delivered', 'Entregadas'], ['cancelled', 'Canceladas'], ['todas', 'Todas']];
      const matches = o => { const st = stageOf(o); return orderFilter === 'todas' || (orderFilter === 'activas' ? !['delivered', 'cancelled'].includes(st) : orderFilter === 'encurso' ? ['confirmed', 'preparing', 'ready'].includes(st) : st === orderFilter); };
      const list = orders.filter(o => matches(o) && (!ordersToday || isToday(o.createdAt)) && (!q || `${o.id} ${o.name} ${o.phone} ${o.sector || ''} ${o.address || ''}`.toLowerCase().includes(q)));
      const todayOrders = orders.filter(o => isToday(o.createdAt));
      const soldToday = todayOrders.filter(isConfirmed).reduce((sum, o) => sum + (Number(o.finalTotalUSD) || 0), 0);
      const filterBar = FILTERS.map(([id, label]) => { const n = id === 'pending' ? count('pending') : id === 'encurso' ? count('confirmed') + count('preparing') + count('ready') : 0; return `<button type="button" class="fchip${orderFilter === id ? ' is-on' : ''}" data-act="orderFilter" data-filter="${id}" aria-pressed="${orderFilter === id}">${label}${n ? ` <b>${n}</b>` : ''}</button>`; }).join('');
      const cards = list.slice(0, ordersLimit).map(orderCard).join('');
      return `<section class="card"><div class="section-head"><div><h2>Comandas y pedidos</h2><p class="card__intro">Cada pedido enviado a WhatsApp llega aquí como <strong>por confirmar</strong>. Escribe el delivery, confirma e imprime la comanda de 58 mm, y luego avanza el pedido: en preparación, en camino y entregado. Confirmar registra el monto acordado, no el pago recibido.</p></div><div class="head-actions"><button type="button" class="btn btn--small" data-act="refreshOrders">Actualizar</button><button type="button" class="btn btn--small" data-act="exportOrders">Descargar para Excel</button></div></div>
        <div class="metric-grid metric-grid--4"><div class="metric${count('pending') ? ' metric--alert' : ''}"><strong>${count('pending')}</strong><span>Por confirmar</span></div><div class="metric"><strong>${count('confirmed') + count('preparing') + count('ready')}</strong><span>En curso</span></div><div class="metric"><strong>${todayOrders.length}</strong><span>Pedidos de hoy</span></div><div class="metric"><strong>${moneyText(soldToday)}</strong><span>Confirmado hoy</span></div></div>
        <div class="filters" role="group" aria-label="Filtrar comandas">${filterBar}</div>
        <div class="toolbar"><input type="search" id="orderSearch" placeholder="Buscar cliente, teléfono o número" value="${esc(orderQuery)}" aria-label="Buscar comandas"><label class="chk chk--pill"><input type="checkbox" id="ordersToday" ${ordersToday ? 'checked' : ''}> Solo hoy</label></div>
        <p class="muted live-note"><span class="live-dot" aria-hidden="true"></span> Se actualiza sola cada 30 segundos. <button type="button" class="linkbtn" data-act="toggleSound">${soundOn ? 'Sonido de aviso: activado' : 'Sonido de aviso: apagado'}</button></p></section>
        ${cards || `<section class="card"><p class="muted">${orders.length ? 'No hay comandas con este filtro.' : 'Todavía no hay pedidos. Cuando un cliente envíe su solicitud a WhatsApp, aparecerá aquí.'}</p></section>`}${list.length > ordersLimit ? `<button type="button" class="btn btn--small" data-act="loadMoreOrders">Mostrar ${Math.min(50, list.length - ordersLimit)} pedidos más</button>` : ''}`;
    },
    estadisticas() {
      const cutoff = statsPeriod === 'all' ? 0 : Date.now() - Number(statsPeriod) * 86400000;
      const filtered = orders.filter(o => !cutoff || new Date(o.createdAt).getTime() >= cutoff);
      const confirmed = filtered.filter(isConfirmed);
      const cancelledCount = filtered.filter(isCancelled).length;
      const pending = filtered.length - confirmed.length - cancelledCount;
      const salesByDay = new Map();
      confirmed.forEach(o => { const key = new Date(o.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); salesByDay.set(key, (salesByDay.get(key) || 0) + (Number(o.finalTotalUSD) || 0)); });
      const lastDays = Array.from({ length: 14 }, (_, k) => { const d = new Date(Date.now() - (13 - k) * 86400000); const key = d.toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }); return [new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', weekday: 'short', day: 'numeric' }).format(d), salesByDay.get(key) || 0]; });
      const revenue = confirmed.reduce((sum, o) => sum + (Number(o.finalTotalUSD) || 0), 0);
      const avg = confirmed.length ? revenue / confirmed.length : 0;
      const productMap = new Map(), hourMap = new Map(), dayMap = new Map(), windowMap = new Map();
      for (const order of filtered.filter(o => !isCancelled(o))) {
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
      return `<section class="card"><div class="section-head"><div><h2>Estadísticas de Cochi</h2><p class="card__intro">Comportamiento de los pedidos registrados. Horas y días calculados con la hora de Caracas.</p></div><label class="field period-field">Período<select id="statsPeriod"><option value="7" ${statsPeriod==='7'?'selected':''}>Últimos 7 días</option><option value="30" ${statsPeriod==='30'?'selected':''}>Últimos 30 días</option><option value="90" ${statsPeriod==='90'?'selected':''}>Últimos 90 días</option><option value="all" ${statsPeriod==='all'?'selected':''}>Todo el historial</option></select></label></div><div class="metric-grid"><div class="metric"><strong>${filtered.length}</strong><span>Pedidos recibidos</span></div><div class="metric"><strong>${confirmed.length}</strong><span>Comandas confirmadas</span></div><div class="metric"><strong>${moneyText(revenue)}</strong><span>Monto confirmado</span></div><div class="metric"><strong>${moneyText(avg)}</strong><span>Promedio por comanda</span></div></div><p class="muted">${pending} pedido(s) aún pendiente(s) de confirmar${cancelledCount ? ` · ${cancelledCount} cancelado(s), que no se suman` : ''}. El monto mostrado corresponde a precios confirmados por el equipo; no significa necesariamente que el depósito ya fue recibido.</p></section><section class="card"><h2>Ventas confirmadas por día</h2><p class="card__intro">Últimos 14 días (montos confirmados con delivery).</p>${barList(lastDays, v => moneyText(v))}</section><section class="card"><h2>Productos más pedidos</h2><p class="card__intro">Ranking por unidades solicitadas; incluye pedidos pendientes y confirmados.</p>${topProducts.length ? barList(topProducts.map(([name,v])=>[name,v.qty]), v=>`${v} uds.`) : '<p class="muted">Aún no hay datos suficientes.</p>'}${bestProduct ? `<p class="preview">El producto con más unidades en este período es <strong>${esc(bestProduct[0])}</strong> (${bestProduct[1].qty} unidades).</p>` : ''}</section><section class="card"><h2>¿Cuándo piden?</h2><p class="card__intro">Distribución por día de la semana y hora de recepción del pedido.</p><h3 class="subheading">Días</h3>${barList(days, v=>`${v} pedidos`)}<h3 class="subheading">Horas</h3>${barList(hours, v=>`${v} pedidos`)}${bestDay ? `<p class="preview">Día con más actividad: <strong>${esc(bestDay[0])}</strong> (${bestDay[1]} pedidos).</p>` : ''}</section><section class="card"><h2>Franjas de actividad</h2>${windowMap.size ? barList([...windowMap.entries()], v=>`${v} pedidos`) : '<p class="muted">Todavía no hay pedidos registrados.</p>'}${bestPeriod ? `<p class="preview">Mayor movimiento: <strong>${esc(bestPeriod[0])}</strong>.</p>` : ''}</section>`;
    },
    clientes() {
      const q = customerQuery.trim().toLowerCase();
      const spent = c => (Array.isArray(c.orders) ? c.orders : []).filter(o => !isCancelled(o)).reduce((sum, o) => sum + (Number(o.finalTotalUSD ?? o.total) || 0), 0);
      const lastAt = c => String((Array.isArray(c.orders) && c.orders[0]?.createdAt) || '');
      const sorters = { recientes: (a, b) => lastAt(b).localeCompare(lastAt(a)), pedidos: (a, b) => (b.orders?.length || 0) - (a.orders?.length || 0), gasto: (a, b) => spent(b) - spent(a), nombre: (a, b) => String(a.name).localeCompare(String(b.name), 'es') };
      const rows = customers.filter(c => !q || `${c.name} ${c.phone} ${c.email || ''} ${c.sector || ''}`.toLowerCase().includes(q)).sort(sorters[customerSort] || sorters.recientes);
      const eligible = rows.filter(c => c.marketingConsent && c.marketingChannel !== 'email');
      const chosen = eligible.filter(c => selectedCustomerIds.has(String(c.id)));
      const cards = rows.map(c => {
        const customerOrders = Array.isArray(c.orders) ? c.orders : [];
        const last = customerOrders[0], wa = waPhone(c.phone);
        const canCampaign = Boolean(c.marketingConsent && c.marketingChannel !== 'email');
        const frequent = customerOrders.filter(o => !isCancelled(o)).length >= 3;
        return `<article class="item"><div class="item__fields"><div class="customer-head"><h3>${esc(c.name)}${frequent ? ' <span class="chip chip--prep">Cliente frecuente</span>' : ''}</h3>${canCampaign ? `<label class="customer-check"><input type="checkbox" data-customer-select="${esc(c.id)}" ${selectedCustomerIds.has(String(c.id)) ? 'checked' : ''}> Seleccionar</label>` : ''}</div><p class="preview">Teléfono: ${esc(c.phone)}${c.email ? ` · Correo: ${esc(c.email)}` : ''}</p>
          <p class="preview">${c.address ? `Dirección: ${esc(c.address)} · ${esc(c.sector || '')}` : 'Sin dirección registrada'}${c.reference ? ` · Ref.: ${esc(c.reference)}` : ''}</p>
          <p class="preview">${customerOrders.length} pedido(s) · Total: ${moneyText(spent(c))} · ${last ? `Último: ${dateTime(last.createdAt)}` : 'Sin pedidos'}</p>
          <p class="preview">${canCampaign ? `Autorizó promociones por WhatsApp${c.marketingConsentAt ? ` · ${dateTime(c.marketingConsentAt)}` : ''}` : c.marketingConsent ? 'Autorizó promociones por correo' : 'No autorizó promociones por WhatsApp'}</p>
          ${customerOrders.slice(0, 5).map(o => `<div class="preview"><strong>${esc(o.id || 'Pedido')}</strong> · ${dateTime(o.createdAt)} · ${moneyText(o.finalTotalUSD ?? o.total)}<br>${(o.items || []).map(it => `${esc(it.quantity)}× ${esc(it.name)}`).join(' · ')}</div>`).join('')}
        </div><div class="item__bar"><a class="btn btn--small" href="${waUrl(wa)}" target="_blank" rel="noopener">Abrir WhatsApp</a>${c.marketingConsent ? `<button type="button" class="btn btn--danger" data-act="revokeConsent" data-customer-id="${esc(c.id)}">Retirar autorización</button>` : ''}</div></article>`;
      }).join('');
      const ready = campaignLinksReady ? chosen : [];
      const campaignCards = ready.map(c => {
        const message = campaignText.replace(/\{nombre\}/g, c.name || '');
        return `<div class="campaign-link"><strong>${esc(c.name)}</strong><span>${esc(c.phone)}</span><a class="btn btn--small" href="${waUrl(waPhone(c.phone), message)}" target="_blank" rel="noopener">Abrir mensaje</a></div>`;
      }).join('');
      return `<section class="card"><h2>Clientes de Cochi</h2><p class="card__intro">Los datos se guardan en la base de datos conectada al servidor y solo son visibles en este panel privado.</p><input type="search" id="customerSearch" placeholder="Buscar por nombre, teléfono o correo" value="${esc(customerQuery)}" aria-label="Buscar clientes"><div class="metric-grid"><div class="metric"><strong>${customers.length}</strong><span>Clientes guardados</span></div><div class="metric"><strong>${customers.filter(c=>c.marketingConsent && c.marketingChannel !== 'email').length}</strong><span>Autorizaron WhatsApp</span></div></div><p class="preview">${rows.length} cliente(s) encontrados · ${eligible.length} autorizados en esta búsqueda.</p><div class="item__bar"><button type="button" class="btn btn--small" data-act="selectAllCustomers">Seleccionar autorizados</button><button type="button" class="btn btn--small" data-act="clearCustomerSelection">Limpiar selección</button><button type="button" class="btn btn--small" data-act="refreshCustomers">Actualizar</button><button type="button" class="btn btn--small" data-act="exportCustomers">Descargar para Excel</button><label class="field field--inline">Ordenar por<select id="customerSort"><option value="recientes" ${customerSort === 'recientes' ? 'selected' : ''}>Pedido más reciente</option><option value="pedidos" ${customerSort === 'pedidos' ? 'selected' : ''}>Más pedidos</option><option value="gasto" ${customerSort === 'gasto' ? 'selected' : ''}>Mayor gasto</option><option value="nombre" ${customerSort === 'nombre' ? 'selected' : ''}>Nombre (A-Z)</option></select></label></div></section><section class="card"><h2>Preparar campaña por WhatsApp</h2><p class="card__intro">Selecciona solo clientes que autorizaron promociones. Se generará un enlace individual para abrir cada chat con el texto listo; tú decides cuándo enviarlo.</p><label class="field">Mensaje de promoción<textarea id="campaignText" rows="4" maxlength="900">${esc(campaignText)}</textarea><small>Puedes usar {nombre} para personalizar el saludo.</small></label><p class="muted">${selectedCustomerIds.size} seleccionado(s) · ${chosen.length} elegible(s) con autorización vigente.</p><button type="button" class="btn btn--red" data-act="prepareCampaign" ${chosen.length ? '' : 'disabled'}>Preparar ${chosen.length} mensaje(s)</button>${campaignLinksReady ? `<div class="campaign-results"><p class="preview">Mensajes listos para enviar individualmente: ${chosen.length}.</p>${campaignCards || '<p class="muted">No hay destinatarios seleccionados con autorización.</p>'}</div>` : ''}<p class="muted">WhatsApp no se envía automáticamente desde esta página. No se abrirán chats en cadena ni se enviarán mensajes sin revisión.</p></section>${cards || '<section class="card"><p class="muted">Todavía no hay clientes registrados.</p></section>'}`;
    }
  };

  /* ---------- Comandas: tarjeta con seguimiento, WhatsApp y comanda impresa ---------- */
  function timeAgo(value) {
    if (!value) return '';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    if (minutes < 1) return 'hace un momento';
    if (minutes < 60) return `hace ${minutes} min`;
    if (minutes < 24 * 60) return `hace ${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
    return dateTime(value);
  }
  function orderProgress(order, stage) {
    const steps = [['confirmed', 'Confirmada'], ['preparing', 'Preparación'], ['ready', order.mode === 'pickup' ? 'Lista' : 'En camino'], ['delivered', 'Entregada']];
    const at = steps.findIndex(([id]) => id === stage);
    return `<ol class="progress" aria-label="Avance del pedido">${steps.map(([id, label], i) => `<li class="${i < at ? 'is-done' : i === at ? 'is-now' : ''}"${i === at ? ' aria-current="step"' : ''}>${label}</li>`).join('')}</ol>`;
  }
  function orderCard(order) {
    const stage = stageOf(order), isPickup = order.mode === 'pickup', id = esc(order.id), confirmed = isConfirmed(order);
    const items = (order.items || []).map(item => `<div class="order-line"><strong>${esc(item.quantity)} × ${esc(item.name)}</strong><span>${moneyText(item.lineTotal ?? Number(item.unitPrice || 0) * Number(item.quantity || 1))}</span>${(item.options || []).length ? `<small>${item.options.map(o => `${esc(o.groupName)}: ${esc(o.choiceLabel)}${Number(o.quantity) > 1 ? ` ×${esc(o.quantity)}` : ''}`).join(' · ')}</small>` : ''}${item.note ? `<small>Nota: ${esc(item.note)}</small>` : ''}</div>`).join('');
    const previewBtn = `<button type="button" class="btn btn--red" data-act="previewOrder" data-order-id="${id}">Vista previa de la comanda</button>`;
    let feeBox = '';
    if (stage === 'pending' && isPickup) {
      feeBox = `<div class="fee-box"><div class="fee-box__head"><h4>Retiro en Cochi</h4></div><p class="muted">No se cobra delivery. Total a cobrar: <strong>${moneyText(orderBase(order))}</strong></p>${previewBtn}</div>`;
    } else if (stage === 'pending') {
      const raw = feeValue(order), fee = parseFee(raw);
      feeBox = `<div class="fee-box"><div class="fee-box__head"><h4>Delivery</h4><small>Costo real acordado con el cliente</small></div>
        <div class="fee-row"><button type="button" class="btn fee-step" data-act="feeStep" data-order-id="${id}" data-step="-0.5" aria-label="Restar 0,50 al delivery">−</button>
        <label class="fee-input"><span class="sr-only">Costo de delivery en USD</span><b aria-hidden="true">$</b><input type="number" data-order-fee="${id}" min="0" max="999" step="0.01" inputmode="decimal" value="${esc(raw)}" placeholder="0.00" ${fee === null ? 'aria-invalid="true"' : ''}></label>
        <button type="button" class="btn fee-step" data-act="feeStep" data-order-id="${id}" data-step="0.5" aria-label="Sumar 0,50 al delivery">+</button></div>
        <div class="fee-summary" data-fee-summary="${id}">${feeSummaryHtml(order, fee)}</div>
        <p class="fee-hint" data-fee-hint="${id}" ${fee === null ? '' : 'hidden'}>Escribe el costo del delivery (usa 0 si no se cobra).</p>${previewBtn}</div>`;
    }
    const phone = waPhone(order.phone), wa = WA_FOR_STAGE[stage];
    const waLabel = stage === 'ready' && isPickup ? 'Avisar: listo para retirar' : wa?.[1];
    const waBtn = wa && phone.length >= 10 ? `<a class="btn btn--small btn--wa" href="${waUrl(phone, orderMessage(order, wa[0]))}" target="_blank" rel="noopener">${waLabel}</a>` : '';
    const next = NEXT_STAGE[stage];
    const nextBtn = next ? `<button type="button" class="btn btn--red btn--small" data-act="setStatus" data-order-id="${id}" data-status="${next}">${nextLabel(order, next)}</button>` : '';
    const printBtn = confirmed ? `<button type="button" class="btn btn--small" data-act="previewOrder" data-order-id="${id}">Vista previa e imprimir</button>` : '';
    const cancelBtn = ['pending', 'confirmed', 'preparing', 'ready'].includes(stage) ? `<button type="button" class="btn btn--danger" data-act="cancelOrder" data-order-id="${id}">Cancelar</button>` : '';
    const reopenBtn = stage === 'cancelled' ? `<button type="button" class="btn btn--small" data-act="reopenOrder" data-order-id="${id}">Reactivar</button>` : '';
    const mapLink = !isPickup && order.address ? ` · <a class="linkbtn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.address} ${order.sector || ''}`)}" target="_blank" rel="noopener">Ver en mapa</a>` : '';
    const telLink = order.phone ? `<a class="linkbtn" href="tel:${esc(String(order.phone).replace(/[^\d+]/g, ''))}">${esc(order.phone)}</a>` : '';
    return `<article class="item order-card order-card--${stage}"><div class="order-head"><div><h3>${esc(order.id || 'Comanda')}</h3><p class="muted">${dateTime(order.createdAt)} · ${esc(timeAgo(order.createdAt))} · ${isPickup ? 'Retiro' : 'Delivery'}</p></div><span class="chip chip--${STAGE_CHIP[stage]}">${esc(stageLabel(order))}</span></div>
      ${confirmed ? orderProgress(order, stage) : ''}
      <div class="order-customer"><strong>${esc(order.name)}</strong> · ${telLink}${order.address ? `<br>${esc(order.address)} · ${esc(order.sector || '')}${mapLink}` : ''}${order.reference ? `<br>Referencia: ${esc(order.reference)}` : ''}</div>
      <div class="order-items">${items || '<p class="muted">No hay detalle de productos.</p>'}</div>
      <div class="order-totals"><span>Productos</span><strong>${moneyText(order.productsTotal ?? (Number(order.total || 0) + Number(order.discount || 0)))}</strong>${Number(order.discount) > 0 ? `<span>Cupón ${esc(order.couponCode || '')}</span><strong>-${moneyText(order.discount)}</strong>` : ''}<span>Subtotal</span><strong>${moneyText(order.total ?? order.productsTotal)}</strong>${hasTotal(order) ? `<span>Delivery</span><strong>${moneyText(order.deliveryFeeUSD || 0)}</strong><span>Total confirmado</span><strong>${moneyText(order.finalTotalUSD)}</strong>` : ''}</div>
      ${order.notes ? `<p class="preview"><strong>Notas:</strong> ${esc(order.notes)}</p>` : ''}${stage === 'cancelled' && order.cancelReason ? `<p class="preview"><strong>Motivo de cancelación:</strong> ${esc(order.cancelReason)}</p>` : ''}
      ${feeBox}<div class="item__bar">${nextBtn}${waBtn}${printBtn}${reopenBtn}${cancelBtn}</div></article>`;
  }
  async function changeStatus(id, status, reason = '') {
    const result = await api(`orders/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status, reason }) });
    orders = orders.map(o => String(o.id) === String(id) ? result.order : o);
    updateTitle(); render(); toast(`Comanda ${id}: ${stageLabel(result.order)}.`);
  }
  // Estado de la tienda según el horario guardado (hora de Caracas), igual que lo calcula el menú.
  function storeState() {
    const s = data.settings;
    if (s.ordersPaused) return { kind: 'paused', title: 'Pedidos en pausa', detail: 'Los clientes ven el menú, pero no pueden enviar pedidos hasta que los reanudes.' };
    const names = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), time = `${p.hour}:${p.minute}`;
    const list = s.schedule || [], end = d => (d.to === '23:59' ? '24:00' : d.to);
    const t = list.find(d => d.day === day), prev = list.find(d => d.day === (day + 6) % 7);
    const open = (t && t.open && (t.from < end(t) ? time >= t.from && time < end(t) : time >= t.from)) || (prev && prev.open && end(prev) <= prev.from && time < end(prev));
    if (open) return { kind: 'open', title: 'Abierto: recibiendo pedidos', detail: `El botón para pedir está activo${t && t.to !== '23:59' && t.open ? ` hasta las ${t.to}` : ''}.` };
    for (let offset = 0; offset < 8; offset++) {
      const d = list.find(x => x.day === (day + offset) % 7);
      if (!d || !d.open || (offset === 0 && d.from <= time)) continue;
      const when = offset === 0 ? 'hoy' : offset === 1 ? 'mañana' : `el ${names[d.day]}`;
      return { kind: 'closed', title: 'Cerrado ahora', detail: `Próxima apertura: ${when}${d.from === '00:00' ? '' : ` a las ${d.from}`}. Los clientes pueden ver el menú.` };
    }
    return { kind: 'closed', title: 'Cerrado ahora', detail: 'No hay días abiertos en el horario. Revísalo en la pestaña Horario.' };
  }
  function switchTab(id) {
    tab = TABS.some(([key]) => key === id) ? id : 'inicio';
    render(); window.scrollTo({ top: 0 });
    if (tab === 'clientes') api('customers').then(r => { customers = r.customers || []; render(); }).catch(e => toast(e.message, true));
    if (['inicio', 'comandas', 'estadisticas'].includes(tab) && storage !== 'none') {
      api('orders').then(r => { orders = r.orders || []; if (!knownOrderIds) knownOrderIds = new Set(orders.map(o => String(o.id))); updateTitle(); if (!userIsBusy()) render(); }).catch(e => toast(e.message, true));
      startPolling();
    }
  }
  /* ---------- Productos: orden, copia y grupos de opciones ---------- */
  const rid = (prefix = 'op') => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  function renumberProducts() { data.products.forEach((p, index) => { p.sort_order = (index + 1) * 10; }); }
  function optionsEditor(p, i) {
    const groups = (p.options || []).map((g, gi) => {
      const base = `products.${i}.options.${gi}`;
      const choices = (g.choices || []).map((c, ci) => `<div class="choice-row">${field('Opción', `${base}.choices.${ci}.label`, c.label, 'maxlength="80" placeholder="Ej. Alitas BBQ"')}${field('Extra $', `${base}.choices.${ci}.price_usd`, c.price_usd ?? 0, 'type="number" data-t="n" step="0.01" min="0" inputmode="decimal"')}<button type="button" class="btn btn--danger btn--icon" data-act="delChoice" data-i="${i}" data-g="${gi}" data-c="${ci}" aria-label="Quitar opción ${esc(c.label)}">×</button></div>`).join('');
      return `<div class="opt-group"><div class="row2">${field('Nombre del grupo', `${base}.name`, g.name, 'maxlength="60" placeholder="Ej. Elige tu salsa"')}<label class="field">Tipo<select data-act-change="groupType" data-i="${i}" data-g="${gi}"><option value="single" ${g.type !== 'multiple' ? 'selected' : ''}>El cliente elige una</option><option value="multiple" ${g.type === 'multiple' ? 'selected' : ''}>Puede elegir varias</option></select></label></div>
        <div class="row-inline">${`<label class="sw"><input type="checkbox" data-act-change="groupReq" data-i="${i}" data-g="${gi}" ${g.required ? 'checked' : ''}><span></span>Obligatorio</label>`}${g.type === 'multiple' ? field('Máximo a elegir', `${base}.max`, g.max ?? 3, 'type="number" data-t="n" min="1" max="99"') : ''}</div>
        ${choices || '<p class="muted">Agrega al menos una opción.</p>'}<div class="item__bar"><button type="button" class="btn btn--small" data-act="addChoice" data-i="${i}" data-g="${gi}">Agregar opción</button><button type="button" class="btn btn--danger" data-act="delGroup" data-i="${i}" data-g="${gi}">Eliminar grupo</button></div></div>`;
    }).join('');
    return `<div class="opt-editor"><strong>Opciones para el cliente</strong><p class="muted">Ej.: “Elige tenders o alitas”, salsas, término o extras con precio. Un producto con opciones se abre en su ficha antes de añadirse.</p>${groups}<button type="button" class="btn btn--small" data-act="addGroup" data-i="${i}">Agregar grupo de opciones</button></div>`;
  }
  function productList() {
    const q = query.trim().toLowerCase();
    const keep = { todos: () => true, agotados: p => p.available === false, ocultos: p => p.is_visible === false, sinfoto: p => !p.image, destacados: p => p.featured }[productFilter] || (() => true);
    const rows = data.products.map((p, i) => ({ p, i })).filter(({ p }) => keep(p) && (!q || `${p.name} ${p.category}`.toLowerCase().includes(q)));
    if (!rows.length) return '<p class="muted">No hay productos con ese filtro o nombre.</p>';
    const groups = new Map(); rows.forEach(r => groups.set(r.p.category, [...(groups.get(r.p.category) || []), r]));
    return [...groups].map(([cat, list]) => `<h3 class="cat">${esc(cat)} <small>${list.length}</small></h3>${list.map(({ p, i }) => productRow(p, i)).join('')}`).join('');
  }
  function productRow(p, i) {
    const open = openSlug === p.slug;
    return `<article class="prow ${p.is_visible === false ? 'is-off' : ''}" data-slug="${esc(p.slug)}"><div class="prow__main">${thumb(p.image)}
      <div class="prow__name"><strong>${esc(p.name)}</strong><small>${p.tag ? `${esc(p.tag)} · ` : ''}${p.is_coming_soon ? 'Próximamente' : 'Precio en USD'}</small></div>
      <div class="price"><input type="number" data-b="products.${i}.price_usd" data-t="n" data-after="bs" value="${esc(p.price_usd)}" step="0.01" min="0" inputmode="decimal" aria-label="Precio de ${esc(p.name)} en USD"><small data-bs="${i}">Bs. ${bs(p.price_usd)}</small></div></div>
      <div class="prow__bar">${sw(`products.${i}.is_visible`, p.is_visible !== false, 'Visible')}${sw(`products.${i}.available`, p.available !== false, 'Disponible')}<button type="button" class="btn btn--small" data-act="editProduct" data-slug="${esc(p.slug)}">${open ? 'Cerrar' : 'Editar'}</button><span class="order-btns"><button type="button" class="btn btn--small btn--icon" data-act="moveProduct" data-i="${i}" data-dir="-1" aria-label="Subir ${esc(p.name)} en el menú">↑</button><button type="button" class="btn btn--small btn--icon" data-act="moveProduct" data-i="${i}" data-dir="1" aria-label="Bajar ${esc(p.name)} en el menú">↓</button></span></div>
      ${open ? `<div class="editor">${field('Nombre', `products.${i}.name`, p.name, 'maxlength="80"')}
        ${field('Etiqueta (opcional)', `products.${i}.tag`, p.tag || '', 'maxlength="16" list="tagList" placeholder="Nuevo, Más pedido, Picante..."', 'Aparece sobre la foto del producto en el menú.')}<datalist id="tagList"><option value="Nuevo"><option value="Más pedido"><option value="Picante"><option value="Oferta"><option value="Solo domingos"></datalist>
        <label class="field">Descripción<textarea data-b="products.${i}.description" maxlength="420" rows="3">${esc(p.description)}</textarea></label>
        <label class="field">Categoría<input data-b="products.${i}.category" value="${esc(p.category)}" list="catList" maxlength="40"><datalist id="catList">${categories().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <div class="imgbox">${thumb(p.image)}<div class="imgbox__btns"><button type="button" class="btn btn--small" data-act="imgProduct" data-i="${i}">${p.image ? 'Cambiar foto' : 'Subir foto'}</button>${p.image ? `<button type="button" class="btn btn--danger" data-act="rmImg" data-i="${i}">Quitar foto</button>` : ''}</div></div>
        <div class="prow__bar">${sw(`products.${i}.featured`, p.featured, 'Destacado en favoritos')}${sw(`products.${i}.is_coming_soon`, p.is_coming_soon, 'Próximamente')}</div>
        <div class="field">Días en que se vende (sin marcar = todos los días)<div class="checks">${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d, day) => `<label class="chk"><input type="checkbox" data-act-change="prodDay" data-i="${i}" value="${day}" ${(p.availability_days || []).includes(day) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>
        ${optionsEditor(p, i)}
        <div class="item__bar"><button type="button" class="btn btn--small" data-act="dupProduct" data-i="${i}">Duplicar producto</button><button type="button" class="btn btn--danger" data-act="delProduct" data-i="${i}">Eliminar producto</button></div></div>` : ''}</article>`;
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
    chooseTheme(el) { data.settings.theme.preset = THEME_PRESETS.some(p => p.id === el.dataset.themeId) ? el.dataset.themeId : 'original'; data.settings.theme.customColors ||= {}; data.settings.theme.customColors[data.settings.theme.preset] ||= {}; markDirty(); render(); toast('Tema seleccionado. Puedes personalizar sus HEX y guardar los cambios.'); },
    resetThemeColors() { const preset = data.settings.theme.preset; if (data.settings.theme.customColors) delete data.settings.theme.customColors[preset]; data.settings.theme.customColors ||= {}; data.settings.theme.customColors[preset] = {}; markDirty(); render(); toast('Se restauró la paleta original de esta temática. Guarda los cambios.'); },
    async uploadThemeAsset(el) { const url = await uploadImage(1200); if (url) { data.settings.theme[el.dataset.asset] = url; markDirty(); render(); } },
    removeThemeAsset(el) { data.settings.theme[el.dataset.asset] = ''; markDirty(); render(); toast('Se usará el recurso original de Cochi.'); },
    save: save,
    goTab(el) { switchTab(el.dataset.goto); },
    async togglePause() {
      const pausing = !data.settings.ordersPaused;
      if (pausing && !confirm('¿Pausar los pedidos ahora? Los clientes podrán ver el menú, pero no enviar pedidos hasta que los reanudes.')) return;
      if (dirty && !confirm('También se guardarán los otros cambios que tienes pendientes. ¿Continuar?')) return;
      data.settings.ordersPaused = pausing; markDirty(); await save();
    },
    orderFilter(el) { orderFilter = el.dataset.filter; ordersLimit = 50; render(); },
    productFilter(el) { productFilter = el.dataset.filter; render(); },
    toggleSound() { soundOn = !soundOn; try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch { /* sin almacenamiento */ } if (soundOn) beep(); render(); toast(soundOn ? 'Sonido de aviso activado.' : 'Sonido de aviso apagado.'); },
    async setStatus(el) { await changeStatus(el.dataset.orderId, el.dataset.status); },
    async cancelOrder(el) {
      const reason = prompt(`¿Cancelar la comanda ${el.dataset.orderId}? Escribe el motivo (opcional, solo lo ve el equipo):`, '');
      if (reason === null) return;
      await changeStatus(el.dataset.orderId, 'cancelled', reason);
    },
    async reopenOrder(el) { const order = orders.find(o => String(o.id) === el.dataset.orderId); if (order) await changeStatus(order.id, hasTotal(order) ? 'confirmed' : 'pending'); },
    exportOrders() {
      const rows = [['Número', 'Fecha', 'Estado', 'Cliente', 'Teléfono', 'Modalidad', 'Dirección', 'Sector', 'Productos', 'Subtotal USD', 'Descuento USD', 'Cupón', 'Delivery USD', 'Total USD', 'Notas']];
      orders.forEach(o => rows.push([o.id, dateTime(o.createdAt), stageLabel(o), o.name, o.phone, o.mode === 'pickup' ? 'Retiro' : 'Delivery', o.address || '', o.sector || '', (o.items || []).map(it => `${it.quantity} x ${it.name}`).join(', '), csvNumber(o.total), csvNumber(o.discount), o.couponCode || '', hasTotal(o) ? csvNumber(o.deliveryFeeUSD) : '', hasTotal(o) ? csvNumber(o.finalTotalUSD) : '', o.notes || '']));
      downloadCsv(`cochi-comandas-${today()}.csv`, rows); toast(`Se descargaron ${orders.length} comandas.`);
    },
    exportCustomers() {
      const rows = [['Nombre', 'Teléfono', 'Correo', 'Dirección', 'Sector', 'Pedidos', 'Último pedido', 'Autorizó WhatsApp']];
      customers.forEach(c => { const list = Array.isArray(c.orders) ? c.orders : []; rows.push([c.name, c.phone, c.email || '', c.address || '', c.sector || '', list.length, list[0] ? dateTime(list[0].createdAt) : '', c.marketingConsent && c.marketingChannel !== 'email' ? 'Sí' : 'No']); });
      downloadCsv(`cochi-clientes-${today()}.csv`, rows); toast(`Se descargaron ${customers.length} clientes.`);
    },
    moveProduct(el) {
      const i = Number(el.dataset.i), dir = Number(el.dataset.dir), cat = data.products[i].category;
      let j = i + dir; while (j >= 0 && j < data.products.length && data.products[j].category !== cat) j += dir;
      if (j < 0 || j >= data.products.length) { toast(dir < 0 ? 'Ya es el primero de su categoría.' : 'Ya es el último de su categoría.'); return; }
      [data.products[i], data.products[j]] = [data.products[j], data.products[i]];
      renumberProducts(); markDirty(); $('#plist').innerHTML = productList();
      document.querySelector(`[data-act="moveProduct"][data-i="${j}"][data-dir="${dir}"]`)?.focus();
    },
    dupProduct(el) {
      const i = Number(el.dataset.i), source = data.products[i], copy = JSON.parse(JSON.stringify(source));
      let slug = slugify(`${source.name} copia`), n = 2; while (data.products.some(p => p.slug === slug)) slug = slugify(`${source.name} copia ${n++}`);
      Object.assign(copy, { id: slug, slug, name: `${source.name} (copia)`.slice(0, 80), is_visible: false, featured: false });
      data.products.splice(i + 1, 0, copy); renumberProducts(); openSlug = slug; markDirty(); $('#plist').innerHTML = productList();
      toast('Copia creada y oculta. Revísala y márcala como Visible cuando esté lista.');
    },
    addGroup(el) { const p = data.products[el.dataset.i]; p.options = Array.isArray(p.options) ? p.options : []; p.options.push({ id: rid('grupo'), name: '', type: 'single', required: true, min: 1, max: 1, choices: [{ id: rid(), label: '', price_usd: 0 }] }); markDirty(); $('#plist').innerHTML = productList(); },
    delGroup(el) { if (!confirm('¿Eliminar este grupo de opciones?')) return; data.products[el.dataset.i].options.splice(Number(el.dataset.g), 1); markDirty(); $('#plist').innerHTML = productList(); },
    addChoice(el) { data.products[el.dataset.i].options[el.dataset.g].choices.push({ id: rid(), label: '', price_usd: 0 }); markDirty(); $('#plist').innerHTML = productList(); },
    delChoice(el) { data.products[el.dataset.i].options[el.dataset.g].choices.splice(Number(el.dataset.c), 1); markDirty(); $('#plist').innerHTML = productList(); },
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
    async refreshOrders() { orders = (await api('orders')).orders || []; knownOrderIds = new Set(orders.map(o => String(o.id))); ordersLimit = 50; updateTitle(); render(); toast('Pedidos actualizados.'); },
    loadMoreOrders() { ordersLimit += 50; render(); },
    feeStep(el) {
      const input = document.querySelector(`[data-order-fee="${el.dataset.orderId}"]`); if (!input) return;
      input.value = Math.min(999, Math.max(0, round2((parseFee(input.value) ?? 0) + Number(el.dataset.step)))).toFixed(2);
      syncFee(input); input.focus();
    },
    previewOrder(el) {
      const order = orders.find(o => String(o.id) === el.dataset.orderId); if (!order) throw new Error('No se encontró esa comanda.');
      let fee = Number(order.deliveryFeeUSD) || 0;
      if (!isConfirmed(order) && order.mode !== 'pickup') {
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
    ruleDay(el) { const rule = data.upsells[el.dataset.i]; const set = new Set(rule.days || []); el.checked ? set.add(Number(el.value)) : set.delete(Number(el.value)); rule.days = [...set].sort(); markDirty(); },
    prodDay(el) { const p = data.products[el.dataset.i]; const set = new Set(p.availability_days || []); el.checked ? set.add(Number(el.value)) : set.delete(Number(el.value)); p.availability_days = [...set].sort(); markDirty(); },
    groupType(el) { const g = data.products[el.dataset.i].options[el.dataset.g]; g.type = el.value === 'multiple' ? 'multiple' : 'single'; g.max = g.type === 'single' ? 1 : Math.max(2, Number(g.max) || 3); g.min = g.required ? 1 : 0; markDirty(); $('#plist').innerHTML = productList(); },
    groupReq(el) { const g = data.products[el.dataset.i].options[el.dataset.g]; g.required = el.checked; g.min = el.checked ? 1 : 0; markDirty(); }
  };

  document.addEventListener('click', async event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { switchTab(tabButton.dataset.tab); return; }
    const el = event.target.closest('[data-act]'); if (!el) return;
    try { await ACTIONS[el.dataset.act]?.(el); } catch (error) { if (error.status === 401) showLogin('Tu sesión venció. Entra de nuevo.'); else toast(error.message, true); }
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[data-order-fee]')) { syncFee(event.target); return; }
    if (event.target.id === 'q') { query = event.target.value; $('#plist').innerHTML = productList(); return; }
    if (event.target.id === 'orderSearch') { orderQuery = event.target.value; const pos = event.target.selectionStart; render(); const input = $('#orderSearch'); input.focus(); input.setSelectionRange(pos, pos); return; }
    if (event.target.id === 'customerSearch') { customerQuery = event.target.value; const pos = event.target.selectionStart; render(); const input = $('#customerSearch'); input.focus(); input.setSelectionRange(pos, pos); return; }
    if (event.target.id === 'campaignText') { campaignText = event.target.value; campaignLinksReady = false; return; }
    const picker = event.target.closest('[data-theme-color-picker]');
    if (picker) {
      const key = picker.dataset.themeColorPicker, preset = picker.dataset.themePreset, value = picker.value.toUpperCase();
      const hexInput = document.querySelector(`[data-theme-color-hex="${key}"][data-theme-preset="${preset}"]`);
      if (hexInput) { hexInput.value = value; hexInput.dataset.lastValid = value; }
      setPath(`settings.theme.customColors.${preset}.${key}`, value); markDirty(); return;
    }
    const hexInput = event.target.closest('[data-theme-color-hex]');
    if (hexInput) {
      const value = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        const normalized = value.toUpperCase();
        hexInput.dataset.lastValid = normalized;
        hexInput.value = normalized;
        const pickerInput = document.querySelector(`[data-theme-color-picker="${hexInput.dataset.themeColorHex}"][data-theme-preset="${hexInput.dataset.themePreset}"]`);
        if (pickerInput) pickerInput.value = normalized;
        setPath(`settings.theme.customColors.${hexInput.dataset.themePreset}.${hexInput.dataset.themeColorHex}`, normalized); markDirty();
      }
      return;
    }
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
    if (event.target.id === 'ordersToday') { ordersToday = event.target.checked; render(); return; }
    if (event.target.id === 'customerSort') { customerSort = event.target.value; render(); return; }
    const el = event.target.closest('[data-act-change]'); if (el) CHANGES[el.dataset.actChange](el);
    const hexInput = event.target.closest('[data-theme-color-hex]');
    if (hexInput && !/^#[0-9a-fA-F]{6}$/.test(hexInput.value.trim())) {
      hexInput.value = hexInput.dataset.lastValid || '#000000';
      toast('Código HEX inválido. Usa el formato #RRGGBB.', true);
      return;
    }
    const after = event.target.closest('[data-after="rerender"]'); if (after) render();
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  // Atajo: Ctrl + S (o Cmd + S en Mac) guarda los cambios.
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && data && !$('#app').hidden) { event.preventDefault(); if (dirty && storage !== 'none') save(); }
  });
  // Al volver a la pestaña del navegador, se revisa si llegaron pedidos.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && data) pollOrders(); });
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
    const button = $('#saveBtn');
    // Revisa que los grupos de opciones estén completos antes de publicar.
    for (const p of data.products) {
      for (const g of (p.options || [])) {
        if (!String(g.name || '').trim() || !(g.choices || []).length || g.choices.some(c => !String(c.label || '').trim())) {
          toast(`Completa el nombre del grupo y de cada opción en "${p.name}" (o elimina las que estén vacías).`, true);
          tab = 'productos'; openSlug = p.slug; render(); return;
        }
      }
    }
    button.disabled = true; button.textContent = 'Guardando...';
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
    const savedTheme = data.settings.theme || {};
    data.settings.theme = { preset: validThemes.includes(savedTheme.preset) ? savedTheme.preset : 'original', logoHeader: savedTheme.logoHeader || '', logoFooter: savedTheme.logoFooter || '', isotipo: savedTheme.isotipo || '', customColors: savedTheme.customColors && typeof savedTheme.customColors === 'object' && !Array.isArray(savedTheme.customColors) ? savedTheme.customColors : {} };
    data.settings.theme.customColors[data.settings.theme.preset] ||= {};
    data.cp = await api('coupons').then(r => r.coupons).catch(() => ({ enabled: false, coupons: [] }));
    // La lista del panel sigue el mismo orden que ve el cliente en el menú.
    data.products = data.products.map((p, index) => ({ p, index })).sort((a, b) => (Number(a.p.sort_order ?? 999) - Number(b.p.sort_order ?? 999)) || a.index - b.index).map(x => x.p);
    $('#login').hidden = true; $('#app').hidden = false; markDirty(false);
    switchTab(tab);
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
