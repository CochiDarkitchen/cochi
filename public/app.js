/* Cochi — carta digital simple. Catálogo y configuración editables en public/data/. Sin base de datos. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const CART_KEY = 'cochi-cart-v1';
  const INTRO_KEY = 'cochi-intro-seen-v1';
  const defaultConfig = {
    whatsappNumber: '584242246392',
    orderModes: ['delivery', 'pickup'],
    deliveryFeeUSD: null,
    usdToVes: 887.302,
    exchangeRateDate: '2026-10-27',
    exchangeRateName: 'Tasa BCV actualizada por Cochi'
  };

  let config = { ...defaultConfig };
  let products = [];
  let cart = [];
  let rate = null;
  let activeCategory = 'Todo';
  let activeSearch = '';
  let cartPreviousFocus = null;
  let editingCartKey = null;
  let modalProduct = null;
  let modalQuantity = 1;
  let lastToastTimer = null;
  let productDialogLastFocus = null;
  let contentApi = null;
  let extras = { announcements: [], upsells: [], flyers: [], testimonials: [] };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function safeAssetPath(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    try {
      const parsed = new URL(url, window.location.href);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
    } catch { return ''; }
  }
  function currencyUSD(value) {
    return '$' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function currencyVES(value) {
    return 'Bs. ' + Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatDate(dateText) {
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return '';
    const [year, month, day] = dateText.split('-').map(Number);
    return new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Caracas' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }
  function todayInCaracas() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  function isOrderDay(date = new Date()) {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', weekday: 'short' }).format(date);
    return ['Fri', 'Sat', 'Sun'].includes(weekday);
  }
  function orderScheduleMessage() {
    return 'Cochi recibe pedidos únicamente de viernes a domingo. Puedes explorar el menú y preparar tu selección; vuelve durante esos días para enviarla por WhatsApp.';
  }
  function updateScheduleNotice() {
    const note = $('#orderScheduleNote');
    if (note) {
      note.textContent = isOrderDay() ? '¡Estamos en días de pedidos! Trabajamos de viernes a domingo.' : orderScheduleMessage();
      note.classList.toggle('is-closed', !isOrderDay());
    }
    const button = $('#startCheckout');
    if (button) {
      const needsReview = cart.some(line => line.needsReview || !productAvailability(productFromCatalog(line.slug) || {}).canOrder);
      button.disabled = !isOrderDay() || cart.length === 0 || needsReview;
      button.setAttribute('aria-describedby', 'orderScheduleNote');
      button.innerHTML = isOrderDay()
        ? 'Continuar con mis datos <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg>'
        : 'Pedidos de viernes a domingo';
    }
  }

  function businessDaysElapsed(fromDate, toDate = todayInCaracas()) {
    if (!fromDate || fromDate >= toDate) return 0;
    const start = new Date(fromDate + 'T12:00:00Z');
    const end = new Date(toDate + 'T12:00:00Z');
    let count = 0;
    const cursor = new Date(start);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor <= end && count < 45) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  }
  function rateIsStale(rateObject) {
    return !rateObject?.effectiveDate || Boolean(rateObject.stale) || businessDaysElapsed(rateObject.effectiveDate) > 0;
  }
  function getConvertedPrice(usd) {
    if (!rate || !Number.isFinite(Number(rate.usdVES)) || Number(rate.usdVES) <= 0) return null;
    return Number(usd || 0) * Number(rate.usdVES);
  }
  function rateLabel() {
    if (!rate) return 'La conversión a bolívares no está disponible. El equipo de Cochi confirmará el monto por WhatsApp.';
    const status = rateIsStale(rate) ? 'Tasa Cochi por verificar' : 'Tasa manual de Cochi';
    return `${status}: 1 USD = ${currencyVES(rate.usdVES)} · fecha ${formatDate(rate.effectiveDate)}.`;
  }
  function formatPriceBlock(usd) {
    let result = `<strong>${currencyUSD(usd)}</strong>`;
    const ves = getConvertedPrice(usd);
    if (ves !== null) {
      const staleClass = rateIsStale(rate) ? ' price-stale' : '';
      result += `<small class="price-ves${staleClass}">${currencyVES(ves)}${rateIsStale(rate) ? ' · tasa anterior' : ''}</small>`;
    } else {
      result += '<small>Conversión Bs. no disponible</small>';
    }
    return result;
  }
  function normalizeProduct(row) {
    return {
      id: String(row.id ?? row.slug ?? ''),
      slug: String(row.slug ?? row.id ?? ''),
      name: String(row.name ?? ''),
      category: String(row.category ?? 'Otros'),
      description: String(row.description ?? ''),
      price_usd: Number(row.price_usd ?? row.price ?? 0),
      image: String(row.image ?? ''),
      available: row.available !== false,
      availability_days: Array.isArray(row.availability_days) ? row.availability_days.map(Number) : [],
      is_visible: row.is_visible !== false,
      is_coming_soon: Boolean(row.is_coming_soon),
      featured: Boolean(row.featured),
      brand: row.brand === 'dulce' ? 'dulce' : 'cochi',
      sort_order: Number(row.sort_order ?? 999),
      options: Array.isArray(row.options) ? row.options : []
    };
  }
  function productFromCatalog(slug) {
    return products.find(product => product.slug === slug || product.id === slug);
  }
  function productAvailability(product) {
    if (product.is_coming_soon) return { canOrder: false, type: 'soon', label: 'PRÓXIMAMENTE', reason: 'Todavía no está disponible para comprar.' };
    if (product.available === false) return { canOrder: false, type: 'out', label: 'AGOTADO', reason: 'Este producto está agotado temporalmente.' };
    if (Array.isArray(product.availability_days) && product.availability_days.length) {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', weekday: 'short' }).format(new Date());
      const day = ({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 })[weekday];
      if (!product.availability_days.includes(day)) {
        const names = product.availability_days.map(d => ({ 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado' }[d])).filter(Boolean);
        return { canOrder: false, type: 'day', label: `SOLO ${names.join(' / ').toUpperCase()}`, reason: `Este producto se ofrece solo ${names.join(' / ')}.` };
      }
    }
    return { canOrder: true, type: 'available', label: '', reason: '' };
  }
  function defaultGraphic(product, large = false) {
    const dulce = product.brand === 'dulce';
    const red = ['Costillas a la BBQ', 'Tenders y alitas'].includes(product.category);
    const cls = dulce ? ' product-card__graphic--dulce' : red ? ' product-card__graphic--red' : '';
    const icon = dulce ? '/assets/brand/dulce-isotipo-chocolate.png' : red ? '/assets/brand/cochi-isotipo-cream.png' : '/assets/brand/cochi-isotipo-red.png';
    return `<div class="product-card__graphic${cls}"><img src="${icon}" alt="" ${large ? 'width="140" height="150"' : 'width="66" height="72"'}></div>`;
  }
  function imageBlock(product, klass = '') {
    const safe = safeAssetPath(product.image);
    if (safe) {
      return `<div class="${klass}"><img src="${escapeHtml(safe)}" alt="${escapeHtml(`Fotografía de referencia de ${product.name}, tomada de los recursos promocionales de Cochi`)}" loading="lazy" decoding="async" width="720" height="540"></div>`;
    }
    return `<div class="${klass}">${defaultGraphic(product, true)}</div>`;
  }
  function productPriceMarkup(product, includeUSD = true) {
    const ves = getConvertedPrice(product.price_usd);
    let html = `<div class="product-price"><strong>${currencyUSD(product.price_usd)}</strong>`;
    if (ves !== null) html += `<small class="price-ves${rateIsStale(rate) ? ' price-stale' : ''}">${currencyVES(ves)}${rateIsStale(rate) ? ' · tasa anterior' : ''}</small>`;
    else html += '<small>Sin conversión Bs.</small>';
    html += '</div>';
    return html;
  }
  function renderFeatured() {
    const target = $('#featuredGrid');
    if (!target) return;
    const featured = products.filter(p => p.is_visible && p.brand === 'cochi' && p.featured && !p.is_coming_soon).sort((a,b) => a.sort_order - b.sort_order).slice(0,3);
    if (!featured.length) {
      target.innerHTML = '<p class="section-heading__aside">Los favoritos se están preparando.</p>';
      return;
    }
    target.innerHTML = featured.map((product, index) => {
      const availability = productAvailability(product);
      const image = safeAssetPath(product.image);
      const picture = image
        ? `<div class="featured-card__image"><img src="${escapeHtml(image)}" alt="${escapeHtml(`Fotografía promocional de ${product.name}`)}" loading="lazy" width="760" height="650"></div>`
        : `<div class="featured-card__placeholder">${defaultGraphic(product, true)}</div>`;
      const light = !image && index === 0 ? ' featured-card--light' : '';
      const dark = !image && index !== 0 ? ' featured-card--dark' : '';
      return `<article class="featured-card${light}${dark}">${picture}<div class="featured-card__top"><span class="featured-card__tag">${index === 0 ? 'UN CLÁSICO' : index === 1 ? 'PARA ANTOJARSE' : 'DE LA CASA'}</span><span class="featured-card__number">0${index + 1}</span></div><div class="featured-card__copy"><p>${escapeHtml(product.category.toUpperCase())}</p><h3>${escapeHtml(product.name)}</h3><div class="featured-card__bottom"><span class="featured-card__price">${currencyUSD(product.price_usd)}</span><button type="button" class="round-add" data-product-slug="${escapeHtml(product.slug)}" ${availability.canOrder ? '' : 'disabled'} aria-label="Elegir ${escapeHtml(product.name)}">+</button></div></div></article>`;
    }).join('');
    prepReveal($$('.featured-card', target));
  }
  function getMenuProducts() {
    return products.filter(p => p.is_visible && p.brand !== 'dulce' && !p.is_coming_soon).sort((a,b) => a.sort_order - b.sort_order);
  }
  function renderCategories() {
    const target = $('#categoryList');
    if (!target) return;
    const allProducts = getMenuProducts();
    const cats = [...new Set(allProducts.map(p => p.category))];
    if (activeCategory !== 'Todo' && !cats.includes(activeCategory)) activeCategory = 'Todo';
    const buttons = [{ name: 'Todo', count: allProducts.length }, ...cats.map(name => ({ name, count: allProducts.filter(p => p.category === name).length }))];
    const prevLeft = target.scrollLeft;
    target.innerHTML = buttons.map(item => `<button type="button" class="category-chip${activeCategory === item.name ? ' is-active' : ''}" data-category="${escapeHtml(item.name)}" aria-pressed="${activeCategory === item.name ? 'true' : 'false'}">${escapeHtml(item.name)} <span class="category-chip__count">${item.count}</span></button>`).join('');
    target.scrollLeft = prevLeft;
    const chip = $('.is-active', target);
    if (chip) target.scrollTo({ left: Math.max(0, chip.offsetLeft - (target.clientWidth - chip.offsetWidth) / 2), behavior: reducedMotion ? 'auto' : 'smooth' });
  }
  function renderProductCard(product) {
    const state = productAvailability(product);
    const hasPhoto = Boolean(safeAssetPath(product.image));
    const visual = hasPhoto ? `<div class="product-card__visual"><img src="${escapeHtml(safeAssetPath(product.image))}" alt="${escapeHtml(`Fotografía promocional de ${product.name}`)}" loading="lazy" decoding="async" width="600" height="420"><div class="product-card__badges">${product.featured ? '<span class="product-badge">FAVORITO</span>' : '<span></span>'}${state.label ? `<span class="product-badge ${state.type === 'out' ? 'product-badge--out' : state.type === 'soon' ? 'product-badge--soon' : 'product-badge--sunday'}">${escapeHtml(state.label)}</span>` : ''}</div></div>` : `<div class="product-card__visual">${defaultGraphic(product)}<div class="product-card__badges">${product.featured ? '<span class="product-badge">FAVORITO</span>' : '<span></span>'}${state.label ? `<span class="product-badge ${state.type === 'out' ? 'product-badge--out' : state.type === 'soon' ? 'product-badge--soon' : 'product-badge--sunday'}">${escapeHtml(state.label)}</span>` : ''}</div></div>`;
    const coming = product.is_coming_soon;
    return `<article class="product-card${product.brand === 'dulce' ? ' product-card--dulce' : ''}${!state.canOrder && !coming ? ' product-card--unavailable' : ''}" data-product-card="${escapeHtml(product.slug)}">
      ${visual}<div class="product-card__content"><p class="product-card__category">${escapeHtml(product.category)}</p><h3 class="product-card__title">${escapeHtml(product.name)}</h3><p class="product-card__desc">${escapeHtml(product.description)}</p><div class="product-card__bottom">${coming ? '<div class="product-price"><strong>Muy pronto</strong><small>Estamos preparando algo</small></div>' : productPriceMarkup(product)}<button type="button" class="product-card__add" data-product-slug="${escapeHtml(product.slug)}" ${state.canOrder ? '' : 'disabled'} aria-label="${state.canOrder ? 'Elegir ' + escapeHtml(product.name) : escapeHtml(state.reason)}">${state.canOrder ? 'Elegir' : state.type === 'day' ? 'No disponible' : state.type === 'soon' ? 'Próximamente' : 'Agotado'} ${state.canOrder ? '<span aria-hidden="true">+</span>' : ''}</button></div></div></article>`;
  }
  function renderProducts() {
    const target = $('#productGrid');
    if (!target) return;
    renderCategories();
    let list = getMenuProducts();
    if (activeCategory !== 'Todo') list = list.filter(p => p.category === activeCategory);
    if (activeSearch) {
      const q = activeSearch.toLocaleLowerCase('es');
      list = list.filter(p => `${p.name} ${p.description} ${p.category}`.toLocaleLowerCase('es').includes(q));
    }
    $('#menuStatus').textContent = rate ? `${rateIsStale(rate) ? 'AVISO · ' : ''}${rateLabel()}` : 'Los precios base están en USD. La conversión a bolívares no está disponible temporalmente.';
    target.innerHTML = list.length ? list.map(renderProductCard).join('') : `<div class="empty-filter"><strong>No encontramos ese antojo.</strong><p>Prueba con otra palabra o vuelve a ver todas las categorías.</p><button type="button" class="button button--cream" data-category="Todo">Ver todo el menú</button></div>`;
    prepReveal($$('.product-card', target));
  }
  function renderDulceFeatured() {
    const product = products.find(p => p.slug === 'marquesa-chocolate' && p.is_visible) || products.find(p => p.brand === 'dulce' && !p.is_coming_soon && p.is_visible);
    if (!product) {
      $('#dulceFeatured').hidden = true;
      return;
    }
    $('#dulceFeatured').innerHTML = `<div class="dulce-product__thumb"><img src="/assets/brand/dulce-isotipo-chocolate.png" alt="" width="58" height="62"></div><div class="dulce-product__text"><span>EL CLÁSICO DULCE</span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description)}</small><b>${currencyUSD(product.price_usd)}${getConvertedPrice(product.price_usd) !== null ? ' · ' + currencyVES(getConvertedPrice(product.price_usd)) : ''}</b></div><button class="round-add round-add--dulce" type="button" data-product-slug="${escapeHtml(product.slug)}" aria-label="Elegir ${escapeHtml(product.name)}">+</button>`;
  }

  function lineKey(slug, selections, note) {
    const selected = (selections || []).map(s => `${s.groupId}:${s.choiceId}:${s.quantity || 1}`).sort().join('|');
    return `${slug}::${selected}::${String(note || '').trim().toLocaleLowerCase('es')}`;
  }
  function getSelectedCurrentOptions(product, selectedOptions) {
    const result = [];
    let needsReview = false;
    const saved = Array.isArray(selectedOptions) ? selectedOptions : [];
    (product.options || []).forEach(group => {
      const groupSaved = saved.filter(item => item.groupId === group.id);
      groupSaved.forEach(item => {
        const choice = (group.choices || []).find(c => c.id === item.choiceId);
        if (!choice) { needsReview = true; return; }
        result.push({
          groupId: group.id, groupName: group.name,
          choiceId: choice.id, choiceLabel: choice.label,
          price_usd: Number(choice.price_usd || 0), quantity: group.type === 'multiple' ? Math.max(1, Number(item.quantity || 1)) : 1
        });
      });
      if (group.required && result.filter(s => s.groupId === group.id).length < Math.max(1, Number(group.min || 1))) needsReview = true;
    });
    return { selections: result, needsReview };
  }
  function hydrateCart(saved) {
    const result = [];
    if (!Array.isArray(saved)) return result;
    saved.forEach(item => {
      const product = productFromCatalog(item.slug);
      if (!product || product.is_coming_soon) return;
      const normalized = getSelectedCurrentOptions(product, item.selections);
      const note = String(item.note || '').slice(0, 400);
      const line = { slug: product.slug, quantity: Math.max(1, Math.min(99, Number(item.quantity || 1))), selections: normalized.selections, note, needsReview: normalized.needsReview };
      line.key = lineKey(line.slug, line.selections, line.note);
      if (item.promo && upsellRule(item.promo)) { line.promo = String(item.promo); line.key += `::promo:${line.promo}`; }
      const existing = result.find(c => c.key === line.key);
      if (existing) existing.quantity = Math.min(99, existing.quantity + line.quantity); else result.push(line);
    });
    return result;
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart.map(({ slug, quantity, selections, note, promo }) => ({ slug, quantity, selections, note, promo })))); } catch { /* el carrito sigue funcionando en memoria */ }
  }
  function loadCart() {
    try { cart = hydrateCart(JSON.parse(localStorage.getItem(CART_KEY) || '[]')); }
    catch { cart = []; }
    saveCart();
  }
  function choiceCurrent(product, selection) {
    const group = (product.options || []).find(g => g.id === selection.groupId);
    return group?.choices?.find(c => c.id === selection.choiceId);
  }
  function lineUnitPrice(line) {
    if (line.promo) { const rule = upsellRule(line.promo); if (rule) return promoPrice(rule); }
    const product = productFromCatalog(line.slug);
    if (!product) return 0;
    let total = Number(product.price_usd || 0);
    (line.selections || []).forEach(sel => {
      const choice = choiceCurrent(product, sel);
      if (choice) total += Number(choice.price_usd || 0) * (Number(sel.quantity || 1));
    });
    return total;
  }
  function cartProductTotal() {
    return cart.reduce((sum, line) => sum + lineUnitPrice(line) * line.quantity, 0);
  }
  function cartFee(mode = getSelectedMode()) {
    if (mode !== 'delivery' || config.deliveryFeeUSD === null || config.deliveryFeeUSD === undefined || config.deliveryFeeUSD === '') return null;
    const num = Number(config.deliveryFeeUSD);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }
  function cartGrandTotal(mode = getSelectedMode()) {
    const fee = cartFee(mode);
    return cartProductTotal() + (fee === null ? 0 : fee);
  }
  function renderCart() {
    if (normalizePromos()) saveCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    $$('[data-cart-count]').forEach(el => { el.textContent = String(count); el.setAttribute('aria-label', `${count} unidades en el pedido`); });
    $('#mobileOrderBar')?.classList.toggle('is-visible', count > 0);
    const mobileTotal = $('#mobileOrderBar [data-mobile-total]');
    if (mobileTotal) mobileTotal.textContent = currencyUSD(cartProductTotal());
    const empty = cart.length === 0;
    renderCartUpsells();
    $('#cartEmpty').hidden = !empty;
    $('#cartLines').hidden = empty;
    $('#cartBottom').hidden = empty;
    $('#startCheckout').disabled = empty || !isOrderDay();
    if (empty) {
      $('#cartLines').innerHTML = '';
      $('#cartSubtotalUsd').textContent = currencyUSD(0);
      $('#cartSubtotalVes').textContent = '—';
      $('#cartRateNote').textContent = rateLabel();
      return;
    }
    $('#cartLines').innerHTML = cart.map(line => {
      const product = productFromCatalog(line.slug);
      if (!product) return '';
      const optionText = line.selections.map(s => `${escapeHtml(s.groupName)}: ${escapeHtml(s.choiceLabel)}${s.quantity > 1 ? ` x${s.quantity}` : ''}`).join(' · ');
      const detailParts = [];
      if (optionText) detailParts.push(optionText);
      if (line.note) detailParts.push(`Nota: ${escapeHtml(line.note)}`);
      if (line.promo) { const promoRule = upsellRule(line.promo); if (promoRule && promoSaving(promoRule) > 0) detailParts.push(`Promo con tu pedido: ahorras ${currencyUSD(promoSaving(promoRule))} c/u`); }
      if (line.needsReview) detailParts.push('<strong style="color:#b30e08">Revisa las opciones antes de continuar.</strong>');
      return `<article class="cart-line" data-cart-line="${escapeHtml(line.key)}"><div><div class="cart-line__name">${escapeHtml(product.name)}${line.promo ? '<span class="promo-tag">PROMO</span>' : ''}</div>${detailParts.length ? `<div class="cart-line__details">${detailParts.join('<br>')}</div>` : ''}<div class="cart-line__actions"><div class="qty-stepper"><button type="button" data-line-qty="-1" data-line-key="${escapeHtml(line.key)}" aria-label="Disminuir cantidad">−</button><span>${line.quantity}</span><button type="button" data-line-qty="1" data-line-key="${escapeHtml(line.key)}" aria-label="Aumentar cantidad">+</button></div><span class="cart-line__unit">${currencyUSD(lineUnitPrice(line))} c/u</span>${line.promo ? '' : `<button type="button" class="line-edit" data-edit-line="${escapeHtml(line.key)}">Editar</button>`}</div><button type="button" class="cart-line__remove" data-remove-line="${escapeHtml(line.key)}">Eliminar</button></div><div class="cart-line__total">${currencyUSD(lineUnitPrice(line) * line.quantity)}</div></article>`;
    }).join('');
    const total = cartProductTotal();
    $('#cartSubtotalUsd').textContent = currencyUSD(total);
    const ves = getConvertedPrice(total);
    $('#cartSubtotalVes').textContent = ves === null ? 'No disponible' : currencyVES(ves);
    $('#cartSubtotalVesRow').hidden = ves === null;
    $('#cartRateNote').textContent = rateLabel();
    if (ves !== null && rateIsStale(rate)) $('#cartRateNote').textContent += ' Verifica la tasa antes de confirmar el pedido.';
    const invalid = cart.some(line => line.needsReview || !productAvailability(productFromCatalog(line.slug) || {}).canOrder);
    $('#startCheckout').disabled = invalid || !isOrderDay();
    $('#startCheckout').title = invalid ? 'Revisa las opciones o disponibilidad de los productos.' : '';
    if ($('#checkoutView').hidden === false) renderCheckoutSummary();
  }
  function addProductToCart(product, selections, note, quantity, promoRuleToAdd = null) {
    const state = productAvailability(product);
    if (!state.canOrder) { showToast(state.reason || 'Este producto no está disponible.', false); return; }
    const normalized = getSelectedCurrentOptions(product, selections);
    if (normalized.needsReview) { showToast('Completa las opciones obligatorias para continuar.', false); return; }
    const line = { slug: product.slug, quantity: Math.max(1, Math.min(99, Number(quantity || 1))), selections: normalized.selections, note: String(note || '').trim().slice(0, 400), needsReview: false };
    line.key = lineKey(line.slug, line.selections, line.note);
    const existing = cart.find(item => item.key === line.key);
    if (existing) existing.quantity = Math.min(99, existing.quantity + line.quantity); else cart.push(line);
    const fromRect = $('#saveProductToCart')?.getBoundingClientRect();
    if (promoRuleToAdd) addPromoUnits(promoRuleToAdd, line.quantity);
    saveCart(); renderCart(); closeProductDialog(); flyToCart(fromRect);
    showToast(promoRuleToAdd ? `${product.name} y ${productFromCatalog(promoRuleToAdd.add_slug)?.name || 'tu promo'} añadidos al pedido.` : `${product.name} añadido al pedido.`);
  }
  function changeCartQuantity(key, delta) {
    const line = cart.find(item => item.key === key);
    if (!line) return;
    line.quantity += delta;
    if (line.quantity <= 0) cart = cart.filter(item => item.key !== key);
    else line.quantity = Math.min(99, line.quantity);
    saveCart(); renderCart();
  }
  function removeCartLine(key) {
    cart = cart.filter(line => line.key !== key);
    saveCart(); renderCart(); showToast('Producto eliminado del pedido.');
  }

  function openProductDialog(slug, editKey = null) {
    const product = productFromCatalog(slug);
    if (!product) return;
    const availability = productAvailability(product);
    if (!availability.canOrder) { showToast(availability.reason || 'Este producto aún no se puede pedir.', false); return; }
    modalProduct = product;
    editingCartKey = editKey;
    productDialogLastFocus = document.activeElement;
    const line = editKey ? cart.find(item => item.key === editKey) : null;
    modalQuantity = line?.quantity || 1;
    const imgPath = safeAssetPath(product.image);
    const visual = imgPath
      ? `<div class="product-dialog__visual"><img src="${escapeHtml(imgPath)}" alt="${escapeHtml(`Fotografía promocional de ${product.name}`)}" width="720" height="580"></div>`
      : `<div class="product-dialog__visual product-dialog__visual--empty">${defaultGraphic(product, true)}</div>`;
    let groupsHtml = '';
    (product.options || []).forEach(group => {
      const savedGroup = (line?.selections || []).filter(s => s.groupId === group.id);
      const type = group.type === 'multiple' ? 'multiple' : 'single';
      const minimum = Number(group.min ?? (group.required ? 1 : 0));
      const maximum = Number(group.max ?? (type === 'single' ? 1 : 99));
      groupsHtml += `<fieldset class="option-group" data-option-group-block="${escapeHtml(group.id)}"><div class="option-group__head"><strong>${escapeHtml(group.name)}</strong><span>${group.required ? 'OBLIGATORIO' : 'OPCIONAL'}${maximum < 99 ? ` · máx. ${maximum}` : ''}</span></div>`;
      if (!Array.isArray(group.choices) || !group.choices.length) groupsHtml += '<p class="cart-line__details">Opciones por configurar.</p>';
      (group.choices || []).forEach((choice, index) => {
        const saved = savedGroup.find(s => s.choiceId === choice.id);
        const checked = Boolean(saved);
        const choicePrice = Number(choice.price_usd || 0);
        if (type === 'single') {
          groupsHtml += `<label class="option-choice"><input type="radio" name="opt-${escapeHtml(group.id)}" value="${escapeHtml(choice.id)}" data-option-group="${escapeHtml(group.id)}" data-option-choice="${escapeHtml(choice.id)}" ${checked ? 'checked' : ''}><span class="option-choice__text">${escapeHtml(choice.label)}</span>${choicePrice ? `<span class="option-choice__price">+${currencyUSD(choicePrice)}</span>` : ''}</label>`;
        } else {
          const qty = checked ? Number(saved.quantity || 1) : 0;
          groupsHtml += `<div class="option-choice"><input type="checkbox" aria-label="Seleccionar ${escapeHtml(choice.label)}" data-option-multi="true" data-option-group="${escapeHtml(group.id)}" data-option-choice="${escapeHtml(choice.id)}" ${checked ? 'checked' : ''}><span class="option-choice__text">${escapeHtml(choice.label)}${choicePrice ? `<small class="option-choice__price"> +${currencyUSD(choicePrice)}</small>` : ''}</span><div class="option-choice__qty"><button type="button" data-option-qty-step="-1" data-option-group="${escapeHtml(group.id)}" data-option-choice="${escapeHtml(choice.id)}" aria-label="Disminuir ${escapeHtml(choice.label)}">−</button><span data-option-qty-current="${escapeHtml(group.id)}:${escapeHtml(choice.id)}">${qty}</span><button type="button" data-option-qty-step="1" data-option-group="${escapeHtml(group.id)}" data-option-choice="${escapeHtml(choice.id)}" aria-label="Aumentar ${escapeHtml(choice.label)}">+</button></div></div>`;
        }
      });
      groupsHtml += `<input type="hidden" data-option-min="${escapeHtml(group.id)}" value="${minimum}"><input type="hidden" data-option-max="${escapeHtml(group.id)}" value="${maximum}"></fieldset>`;
    });
    const rule = !editKey ? ruleForProduct(product) : null;
    const upProduct = rule ? productFromCatalog(rule.add_slug) : null;
    const upsellBlock = rule && upProduct && productAvailability(upProduct).canOrder
      ? `<label class="upsell-card"><input type="checkbox" id="upsellCheck" data-upsell-rule="${escapeHtml(rule.id)}"><span class="upsell-card__img">${upsellThumb(upProduct)}</span><span class="upsell-card__copy"><strong>${escapeHtml(rule.title)}</strong><small>${escapeHtml(upProduct.name)} por ${currencyUSD(promoPrice(rule))}${promoSaving(rule) > 0 ? ` <s>${currencyUSD(upProduct.price_usd)}</s>` : ''}</small></span>${promoSaving(rule) > 0 ? `<span class="upsell-card__save">Ahorras ${currencyUSD(promoSaving(rule))}</span>` : ''}<span class="upsell-card__tick"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span></label>` : '';
    const ves = getConvertedPrice(product.price_usd);
    $('#productDialogContent').innerHTML = `<div class="product-dialog-content">${visual}<div class="product-dialog__copy"><p class="product-card__category">${escapeHtml(product.category)}</p><h2 id="productDialogTitle">${escapeHtml(product.name)}</h2><p>${escapeHtml(product.description)}</p><div class="product-dialog__price"><strong>${currencyUSD(product.price_usd)}</strong><small>${ves === null ? 'Conversión a Bs. no disponible' : currencyVES(ves) + (rateIsStale(rate) ? ' · tasa anterior' : '')}</small></div><div id="productDialogOptionGroups">${groupsHtml}</div>${upsellBlock}<label class="product-dialog__note"><span>Observaciones de este producto <small>(opcional)</small></span><textarea id="productNote" maxlength="400" rows="3" placeholder="Ej. detalles para preparar este producto">${escapeHtml(line?.note || '')}</textarea></label><p class="product-dialog__error" id="productDialogError" hidden></p><div class="product-dialog__foot"><div class="product-dialog__quantity"><button type="button" id="modalQtyMinus" aria-label="Disminuir cantidad">−</button><output id="modalQtyValue">${modalQuantity}</output><button type="button" id="modalQtyPlus" aria-label="Aumentar cantidad">+</button></div><button type="button" class="button button--red" id="saveProductToCart">${editKey ? 'Guardar cambios' : 'Añadir al pedido'} <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></button></div></div></div>`;
    const dialog = $('#productDialog');
    if (!dialog.open) dialog.showModal();
    $('#modalQtyMinus').addEventListener('click', () => { modalQuantity = Math.max(1, modalQuantity - 1); $('#modalQtyValue').textContent = modalQuantity; });
    $('#modalQtyPlus').addEventListener('click', () => { modalQuantity = Math.min(99, modalQuantity + 1); $('#modalQtyValue').textContent = modalQuantity; });
    $('#saveProductToCart').addEventListener('click', saveModalProduct);
    $('#productDialogContent').addEventListener('click', optionQuantityClick);
    $('#productDialogContent').addEventListener('change', optionInputChange);
    lockScroll();
  }
  function optionInputChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.id === 'upsellCheck') { input.closest('.upsell-card')?.classList.toggle('is-on', input.checked); return; }
    if (input.dataset.optionMulti) {
      const key = `${input.dataset.optionGroup}:${input.dataset.optionChoice}`;
      const qty = $(`[data-option-qty-current="${CSS.escape(key)}"]`, $('#productDialogContent'));
      if (qty) qty.textContent = input.checked ? String(Math.max(1, Number(qty.textContent || 0))) : '0';
    }
  }
  function optionQuantityClick(event) {
    const button = event.target.closest('[data-option-qty-step]');
    if (!button) return;
    const group = button.dataset.optionGroup;
    const choice = button.dataset.optionChoice;
    const key = `${group}:${choice}`;
    const output = $(`[data-option-qty-current="${CSS.escape(key)}"]`, $('#productDialogContent'));
    const checkbox = $(`[data-option-multi][data-option-group="${CSS.escape(group)}"][data-option-choice="${CSS.escape(choice)}"]`, $('#productDialogContent'));
    if (!output || !checkbox) return;
    let qty = Math.max(0, Math.min(99, Number(output.textContent || 0) + Number(button.dataset.optionQtyStep)));
    output.textContent = String(qty);
    checkbox.checked = qty > 0;
  }
  function selectionsFromModal() {
    const selections = [];
    let error = '';
    for (const group of (modalProduct.options || [])) {
      const block = $(`[data-option-group-block="${CSS.escape(group.id)}"]`, $('#productDialogContent'));
      if (!block) continue;
      const groupMin = Number($(`[data-option-min="${CSS.escape(group.id)}"]`, block)?.value ?? (group.required ? 1 : 0));
      const groupMax = Number($(`[data-option-max="${CSS.escape(group.id)}"]`, block)?.value ?? (group.type === 'single' ? 1 : 99));
      const selected = [];
      if (group.type === 'multiple') {
        $$(`[data-option-multi][data-option-group="${CSS.escape(group.id)}"]:checked`, block).forEach(input => {
          const choice = (group.choices || []).find(c => c.id === input.dataset.optionChoice);
          if (!choice) return;
          const key = `${group.id}:${choice.id}`;
          const qty = Number($(`[data-option-qty-current="${CSS.escape(key)}"]`, block)?.textContent || 1);
          if (qty > 0) selected.push({ groupId: group.id, groupName: group.name, choiceId: choice.id, choiceLabel: choice.label, price_usd: Number(choice.price_usd || 0), quantity: qty });
        });
      } else {
        const input = $(`[data-option-group="${CSS.escape(group.id)}"]:checked`, block);
        if (input) {
          const choice = (group.choices || []).find(c => c.id === input.dataset.optionChoice);
          if (choice) selected.push({ groupId: group.id, groupName: group.name, choiceId: choice.id, choiceLabel: choice.label, price_usd: Number(choice.price_usd || 0), quantity: 1 });
        }
      }
      const selectedChoiceCount = selected.length;
      if (selectedChoiceCount < groupMin) error = `Selecciona al menos ${groupMin} opción${groupMin === 1 ? '' : 'es'} en “${group.name}”.`;
      else if (selectedChoiceCount > groupMax) error = `Selecciona como máximo ${groupMax} opción${groupMax === 1 ? '' : 'es'} en “${group.name}”.`;
      selections.push(...selected);
    }
    return { selections, error };
  }
  function saveModalProduct() {
    const { selections, error } = selectionsFromModal();
    const errorNode = $('#productDialogError');
    if (error) { errorNode.textContent = error; errorNode.hidden = false; return; }
    errorNode.hidden = true;
    const note = $('#productNote')?.value || '';
    const product = modalProduct;
    if (editingCartKey) {
      const oldLine = cart.find(item => item.key === editingCartKey);
      if (oldLine) cart = cart.filter(item => item.key !== editingCartKey);
      const newLine = { slug: product.slug, quantity: modalQuantity, selections, note: note.trim().slice(0,400), needsReview: false };
      newLine.key = lineKey(newLine.slug, newLine.selections, newLine.note);
      const duplicate = cart.find(item => item.key === newLine.key);
      if (duplicate) duplicate.quantity = Math.min(99, duplicate.quantity + newLine.quantity); else cart.push(newLine);
      saveCart(); renderCart(); closeProductDialog(); showToast('Cambios guardados en tu pedido.');
    } else { const upsellInput = $('#upsellCheck'); addProductToCart(product, selections, note, modalQuantity, upsellInput?.checked ? upsellRule(upsellInput.dataset.upsellRule) : null); }
  }
  function closeProductDialog() {
    const dialog = $('#productDialog');
    if (dialog.open) dialog.close();
    modalProduct = null; editingCartKey = null;
    if (!$('#cartDrawer').classList.contains('is-open')) unlockScroll();
    if (productDialogLastFocus?.focus) productDialogLastFocus.focus();
  }

  function openCart() {
    cartPreviousFocus = document.activeElement;
    $('#cartDrawer').inert = false;
    const backdrop = $('#cartBackdrop');
    const drawer = $('#cartDrawer');
    backdrop.hidden = false;
    requestAnimationFrame(() => { backdrop.classList.add('is-open'); drawer.classList.add('is-open'); drawer.setAttribute('aria-hidden','false'); $('#closeCart').focus({ preventScroll: true }); });
    lockScroll();
    $('#cartView').hidden = false; $('#checkoutView').hidden = true;
    renderCart(); $('#closeCart').focus({ preventScroll: true });
  }
  function closeCart() {
    const backdrop = $('#cartBackdrop');
    const drawer = $('#cartDrawer');
    backdrop.classList.remove('is-open'); drawer.classList.remove('is-open'); drawer.inert = true; drawer.setAttribute('aria-hidden','true');
    window.setTimeout(() => { if (!drawer.classList.contains('is-open')) backdrop.hidden = true; }, reducedMotion ? 10 : 420);
    if (!$('#productDialog').open) unlockScroll();
    if (cartPreviousFocus?.focus) cartPreviousFocus.focus({ preventScroll: true });
  }
  function getSelectedMode() {
    return $('input[name="orderMode"]:checked', $('#checkoutForm'))?.value || (config.orderModes.includes('delivery') ? 'delivery' : config.orderModes[0] || 'delivery');
  }
  function renderModes() {
    const target = $('#modeOptions');
    const modes = Array.isArray(config.orderModes) && config.orderModes.length ? config.orderModes : ['delivery','pickup'];
    const icons = {
      delivery: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/></svg>',
      pickup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16l-1.4 10H5.4L4 10ZM3 10l2-6h14l2 6M9 10V4m6 6V4"/></svg>'
    };
    target.innerHTML = modes.map((mode, index) => `<label class="mode-option"><input type="radio" name="orderMode" value="${escapeHtml(mode)}" ${index === 0 ? 'checked' : ''}><span>${icons[mode] || ''}${mode === 'delivery' ? 'Entrega a domicilio' : mode === 'pickup' ? 'Retiro' : escapeHtml(mode)}</span></label>`).join('');
    updateDeliveryFields();
  }
  function updateDeliveryFields() {
    const mode = getSelectedMode();
    $('#deliveryFields').hidden = mode !== 'delivery';
    const address = $('[name="address"]', $('#checkoutForm'));
    const sector = $('[name="sector"]', $('#checkoutForm'));
    address.required = mode === 'delivery'; sector.required = mode === 'delivery';
    if (mode !== 'delivery') {
      address.removeAttribute('aria-invalid'); sector.removeAttribute('aria-invalid');
    }
  }
  function renderCheckoutSummary() {
    const subtotal = cartProductTotal();
    const mode = getSelectedMode();
    const fee = cartFee(mode);
    const grand = cartGrandTotal(mode);
    const vesSubtotal = getConvertedPrice(subtotal);
    const vesTotal = getConvertedPrice(grand);
    let rows = `<div class="checkout-summary__row"><span>Productos (${cart.reduce((a,b)=>a+b.quantity,0)} uds.)</span><strong>${currencyUSD(subtotal)}</strong></div>`;
    if (mode === 'delivery') {
      if (fee === null) rows += '<div class="checkout-summary__row"><span>Entrega</span><strong>Por confirmar</strong></div>';
      else rows += `<div class="checkout-summary__row"><span>Entrega</span><strong>${currencyUSD(fee)}</strong></div>`;
    }
    rows += `<div class="checkout-summary__row checkout-summary__total"><span>${fee === null && mode === 'delivery' ? 'Estimado de productos*' : 'Estimado del pedido'}</span><strong>${currencyUSD(grand)}</strong></div>`;
    if (vesTotal !== null) rows += `<div class="checkout-summary__row"><span>Estimado en Bs.</span><strong>${currencyVES(vesTotal)}</strong></div>`;
    if (fee === null && mode === 'delivery') rows += '<p class="rate-footnote">*Es una referencia, no el monto final. Cochi confirmará el total y la entrega por WhatsApp.</p>';
    else rows += '<p class="rate-footnote">El monto definitivo se confirma por WhatsApp antes de pagar.</p>'; 
    if (vesSubtotal !== null && rateIsStale(rate)) rows += '<p class="rate-footnote">Aviso: se está usando una tasa BCV anterior. Verifica el importe en bolívares antes de enviar.</p>';
    $('#checkoutSummary').innerHTML = rows;
  }
  function validateCheckout(form) {
    if (!isOrderDay()) return { ok:false, message:orderScheduleMessage() };
    const data = new FormData(form);
    const name = String(data.get('customerName') || '').trim();
    const mode = String(data.get('orderMode') || getSelectedMode());
    const address = String(data.get('address') || '').trim();
    const sector = String(data.get('sector') || '').trim();
    const error = $('#checkoutError');
    const invalidFields = [];
    if (!name) invalidFields.push(['customerName','Escribe tu nombre y apellido.']);
    if (!cart.length) return { ok:false, message:'Tu carrito está vacío. Añade algún producto antes de continuar.' };
    if (mode === 'delivery' && !address) invalidFields.push(['address','Escribe la dirección donde se entregará el pedido.']);
    if (mode === 'delivery' && !sector) invalidFields.push(['sector','Escribe el sector o la urbanización.']);
    const unavailable = cart.find(line => {
      const product = productFromCatalog(line.slug);
      return !product || line.needsReview || !productAvailability(product).canOrder;
    });
    if (unavailable) return { ok:false, message:'Hay un producto agotado, fuera de su día de disponibilidad o con opciones por revisar. Edita el carrito antes de continuar.' };
    if (invalidFields.length) {
      invalidFields.forEach(([name, message]) => {
        const field = $(`[name="${name}"]`, form);
        field?.setAttribute('aria-invalid','true');
      });
      const first = $(`[name="${invalidFields[0][0]}"]`, form);
      first?.focus();
      return { ok:false, message:invalidFields[0][1] };
    }
    $$('input,textarea', form).forEach(el => el.removeAttribute('aria-invalid'));
    error.hidden = true;
    return { ok:true, data };
  }
  function buildWhatsAppMessage(data) {
    const fullName = String(data.get('customerName') || '').trim();
    const phone = String(data.get('customerPhone') || '').trim();
    const mode = String(data.get('orderMode') || getSelectedMode());
    const address = String(data.get('address') || '').trim();
    const sector = String(data.get('sector') || '').trim();
    const reference = String(data.get('reference') || '').trim();
    const orderNotes = String(data.get('orderNotes') || '').trim();
    const modeLabel = mode === 'delivery' ? 'Entrega a domicilio' : mode === 'pickup' ? 'Retiro' : mode;
    const rows = ['¡Hola, Cochi! Quiero consultar y coordinar este pedido.', '', '*DATOS DEL CLIENTE*', `Nombre: ${fullName}`];
    if (phone) rows.push(`Teléfono: ${phone}`);
    rows.push(`Modalidad: ${modeLabel}`);
    if (mode === 'delivery') {
      if (address) rows.push(`Dirección: ${address}`);
      if (sector) rows.push(`Sector / urbanización: ${sector}`);
      if (reference) rows.push(`Referencia: ${reference}`);
    }
    rows.push('', '*MI PEDIDO*');
    cart.forEach((line, index) => {
      const product = productFromCatalog(line.slug);
      if (!product) return;
      rows.push(`${index + 1}. ${product.name}`);
      rows.push(`   Cantidad: ${line.quantity}`);
      if (line.promo) { const promoRule = upsellRule(line.promo); if (promoRule) rows.push(`   Promo: ${promoRule.title}`); }
      const options = line.selections.map(selection => `${selection.groupName}: ${selection.choiceLabel}${selection.quantity > 1 ? ` x${selection.quantity}` : ''}`);
      if (options.length) rows.push(`   Opciones: ${options.join('; ')}`);
      if (line.note.trim()) rows.push(`   Observaciones: ${line.note.trim()}`);
      rows.push('');
    });
    rows.push('*CONFIRMACIÓN Y PAGO*', 'El monto final, la disponibilidad, el costo de entrega y los datos de pago se confirman directamente por este chat.', 'La preparación del pedido comienza únicamente después de que Cochi reciba el depósito acordado.');
    if (orderNotes) rows.push('', '*NOTAS ADICIONALES*', orderNotes);
    rows.push('', 'Cochi recibe pedidos únicamente de viernes a domingo.', '¡Gracias!');
    return rows.join('\n');
  }
  function handleCheckoutSubmit(event) {
    event.preventDefault();
    const validation = validateCheckout(event.currentTarget);
    if (!validation.ok) {
      $('#checkoutError').textContent = validation.message;
      $('#checkoutError').hidden = false;
      return;
    }
    const number = String(config.whatsappNumber || defaultConfig.whatsappNumber).replace(/\D/g,'');
    if (number.length < 10) {
      $('#checkoutError').textContent = 'El contacto de WhatsApp no parece estar configurado correctamente. Avísanos por otro canal para poder ayudarte.';
      $('#checkoutError').hidden = false;
      return;
    }
    const message = buildWhatsAppMessage(validation.data);
    const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
    let newWindow = null;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches;
    if (isMobile) { window.location.assign(url); return; }
    try { newWindow = window.open(url, '_blank'); if (newWindow) newWindow.opener = null; } catch { newWindow = null; }
    if (!newWindow) window.location.assign(url);
  }

  function showToast(message, positive = true) {
    const region = $('#toastRegion');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast__tick" aria-hidden="true">${positive ? '<svg class="ico" aria-hidden="true"><use href="#i-check"/></svg>' : '!'}</span><span>${escapeHtml(message)}</span>`;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3400);
  }
  function readJSONResponse(response) {
    return response.json().then(data => {
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data;
    });
  }
  async function loadConfig() {
    try {
      const settings = contentApi?.settings || await fetch('/data/settings.json', { cache: 'no-store' }).then(readJSONResponse);
      config = { ...defaultConfig, ...settings };
    } catch {
      config = { ...defaultConfig };
    }
    if (!Array.isArray(config.orderModes) || !config.orderModes.length) config.orderModes = ['delivery', 'pickup'];
    const usdVES = Number(config.usdToVes);
    const effectiveDate = String(config.exchangeRateDate || '');
    rate = Number.isFinite(usdVES) && usdVES > 0 && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
      ? { usdVES, effectiveDate, source: config.exchangeRateName || 'Tasa manual de Cochi', stale: false, manual: true }
      : null;
  }
  async function loadProducts() {
    let localProducts = [];
    try { localProducts = contentApi?.products || await fetch('/data/products.json', { cache: 'no-store' }).then(readJSONResponse); }
    catch { localProducts = []; }
    products = (Array.isArray(localProducts) ? localProducts : [])
      .map(normalizeProduct)
      .filter(product => product.slug && product.name)
      .sort((a,b) => a.sort_order - b.sort_order);
  }

  /* ---------- Sugerencias al pedir (promos) ---------- */
  function upsellRules() { return (extras.upsells || []).filter(rule => rule && rule.active !== false && productFromCatalog(rule.add_slug)); }
  function upsellRule(id) { return (extras.upsells || []).find(rule => rule && rule.id === id); }
  function promoPrice(rule) { const product = productFromCatalog(rule.add_slug); return product ? Math.min(Number(rule.price_usd), Number(product.price_usd)) : 0; }
  function promoSaving(rule) { const product = productFromCatalog(rule.add_slug); return product ? Math.max(0, Number(product.price_usd) - promoPrice(rule)) : 0; }
  function ruleForProduct(product) { return upsellRules().find(rule => (rule.when_categories || []).includes(product.category) && rule.add_slug !== product.slug); }
  function promoUnits(rule) { return cart.filter(line => line.promo === rule.id).reduce((sum, line) => sum + line.quantity, 0); }
  function promoAllowed(rule) {
    const units = cart.filter(line => !line.promo).reduce((sum, line) => { const product = productFromCatalog(line.slug); return sum + (product && (rule.when_categories || []).includes(product.category) ? line.quantity : 0); }, 0);
    return units * Math.max(1, Number(rule.max_per_item || 1));
  }
  function addPromoUnits(rule, quantity) {
    const product = productFromCatalog(rule.add_slug);
    if (!product || quantity < 1 || !productAvailability(product).canOrder) return false;
    const key = `${lineKey(product.slug, [], '')}::promo:${rule.id}`;
    const existing = cart.find(line => line.key === key);
    if (existing) existing.quantity = Math.min(99, existing.quantity + quantity);
    else cart.push({ slug: product.slug, quantity: Math.min(99, quantity), selections: [], note: '', needsReview: false, promo: rule.id, key });
    return true;
  }
  // Mantiene el carrito coherente: la promo solo vale mientras haya productos que la activen.
  function normalizePromos() {
    let changed = false;
    cart.filter(line => line.promo).forEach(line => {
      const rule = upsellRule(line.promo);
      if (!rule || rule.active === false || rule.add_slug !== line.slug) { delete line.promo; line.key = lineKey(line.slug, line.selections, line.note); changed = true; }
    });
    const merged = [];
    cart.forEach(line => { const same = merged.find(item => item.key === line.key); if (same) { same.quantity = Math.min(99, same.quantity + line.quantity); changed = true; } else merged.push(line); });
    cart = merged;
    upsellRules().forEach(rule => {
      let excess = promoUnits(rule) - promoAllowed(rule);
      if (excess <= 0) return;
      changed = true;
      for (let i = cart.length - 1; i >= 0 && excess > 0; i--) {
        if (cart[i].promo !== rule.id) continue;
        const cut = Math.min(excess, cart[i].quantity); cart[i].quantity -= cut; excess -= cut;
        if (cart[i].quantity <= 0) cart.splice(i, 1);
      }
    });
    return changed;
  }
  function upsellThumb(product) {
    const img = safeAssetPath(product.image);
    return img ? `<img src="${escapeHtml(img)}" alt="" width="52" height="52" loading="lazy">` : '<img src="/assets/brand/cochi-isotipo-red.png" alt="" width="34" height="36">';
  }
  function renderCartUpsells() {
    const box = $('#cartUpsells');
    if (!box) return;
    const items = upsellRules().map(rule => ({ rule, product: productFromCatalog(rule.add_slug), remaining: promoAllowed(rule) - promoUnits(rule) }))
      .filter(item => item.remaining > 0 && productAvailability(item.product).canOrder);
    box.hidden = !items.length;
    box.innerHTML = items.map(({ rule, product, remaining }) => `<div class="upsell-strip"><span class="upsell-card__img">${upsellThumb(product)}</span><div class="upsell-card__copy"><strong>${escapeHtml(rule.title)}</strong><small>${escapeHtml(product.name)} a ${currencyUSD(promoPrice(rule))}${promoSaving(rule) > 0 ? ` <s>${currencyUSD(product.price_usd)}</s> · ahorras ${currencyUSD(promoSaving(rule))} c/u` : ''}</small></div><button type="button" class="upsell-add" data-upsell-add="${escapeHtml(rule.id)}">Agregar${remaining > 1 ? ` ${remaining}` : ''}</button></div>`).join('');
  }

  /* ---------- Contenido editable desde el panel admin ---------- */
  async function loadContent() {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4500);
      const data = await fetch('/api/content', { cache: 'no-store', signal: controller.signal }).then(readJSONResponse).finally(() => window.clearTimeout(timer));
      contentApi = data && Array.isArray(data.products) && data.products.length ? data : null;
    } catch { contentApi = null; }
    let fallback = {};
    try { fallback = await fetch('/data/extras.json', { cache: 'no-store' }).then(readJSONResponse); } catch { fallback = {}; }
    const pick = key => Array.isArray(contentApi?.[key]) ? contentApi[key] : (Array.isArray(fallback[key]) ? fallback[key] : []);
    extras = { announcements: pick('announcements'), upsells: pick('upsells'), flyers: pick('flyers'), testimonials: pick('testimonials') };
  }
  function flyerLink(link) {
    const value = String(link || '');
    if (value.startsWith('product:')) return { type: 'product', value: value.slice(8) };
    if (value.startsWith('https://')) return { type: 'url', value };
    return { type: 'anchor', value };
  }
  function renderFlyers() {
    const section = $('#flyers'), track = $('#flyersTrack');
    const items = (extras.flyers || []).filter(f => f && f.active !== false && safeAssetPath(f.image));
    section.hidden = !items.length;
    $$('[data-flyers-nav]').forEach(link => { link.hidden = !items.length; });
    if (!items.length) { track.innerHTML = ''; return; }
    track.innerHTML = items.map((flyer, index) => {
      const target = flyerLink(flyer.link);
      const label = escapeHtml(flyer.linkLabel || 'Ver más');
      const cta = !flyer.link ? '' : target.type === 'product'
        ? `<button type="button" class="flyer-card__cta" data-product-slug="${escapeHtml(target.value)}">${label} <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></button>`
        : `<a class="flyer-card__cta" href="${escapeHtml(target.value)}"${target.type === 'url' ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label} <svg class="ico" aria-hidden="true"><use href="#i-arrow"/></svg></a>`;
      return `<article class="flyer-card" role="listitem" style="--tilt:${index % 2 ? 1.2 : -1.2}deg"><div class="flyer-card__media"><img src="${escapeHtml(safeAssetPath(flyer.image))}" alt="${escapeHtml(flyer.title || 'Flyer de Cochi')}" width="720" height="900" loading="lazy">${flyer.badge ? `<span class="flyer-card__badge">${escapeHtml(flyer.badge)}</span>` : ''}</div><div class="flyer-card__body">${flyer.title ? `<h3>${escapeHtml(flyer.title)}</h3>` : ''}${flyer.text ? `<p>${escapeHtml(flyer.text)}</p>` : ''}${cta}</div></article>`;
    }).join('');
    prepReveal($$('.flyer-card', track));
  }
  function renderTestimonials() {
    const section = $('#comentarios'), grid = $('#testimonialsGrid');
    const items = (extras.testimonials || []).filter(t => t && t.active !== false && t.text);
    section.hidden = !items.length;
    if (!items.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = items.map(t => `<figure class="quote-card"><blockquote>${escapeHtml(t.text)}</blockquote>${t.name ? `<figcaption>${escapeHtml(t.name)}</figcaption>` : ''}</figure>`).join('');
    prepReveal($$('.quote-card', grid));
  }
  function renderAnnouncements() {
    const list = (extras.announcements || []).map(a => String(a).trim()).filter(Boolean);
    const track = $('.announcement__track');
    if (!list.length || !track) return;
    const items = Array.from({ length: Math.ceil(10 / list.length) }, () => list).flat();
    const dot = '<span class="announcement__dot"></span>';
    const set = `<div class="announcement__set">${items.map(a => `<span>${escapeHtml(a)}</span>`).join(dot)}${dot}</div>`;
    track.innerHTML = set + set;
    const reader = $('.announcement .sr-only'); if (reader) reader.textContent = list.join(' · ');
  }
  function setupIntro() {
    const intro = $('#intro');
    return new Promise(resolve => {
      const finish = () => { document.body.classList.add('is-ready'); resolve(); };
      let seen = false;
      try { seen = sessionStorage.getItem(INTRO_KEY) === '1'; } catch { /* storage blocked */ }
      if (!intro || seen) { intro?.remove(); finish(); return; }
      document.documentElement.classList.add('is-intro');
      let done = false;
      const dismiss = () => {
        if (done) return; done = true;
        intro.classList.add('is-hidden');
        document.documentElement.classList.remove('is-intro');
        try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* no storage */ }
        window.setTimeout(finish, reducedMotion ? 0 : 450);
        window.setTimeout(() => intro.remove(), reducedMotion ? 5 : 1000);
      };
      window.setTimeout(dismiss, reducedMotion ? 180 : 4900);
      intro.addEventListener('click', dismiss, { once: true });
    });
  }
  let revealObserver = null, revealReady = false, lockedY = 0;
  function prepReveal(nodes) {
    nodes.forEach((node, i) => {
      node.classList.add('reveal', 'reveal--pop'); node.style.setProperty('--i', i % 6);
      if (revealReady) revealObserver ? revealObserver.observe(node) : node.classList.add('is-revealed');
    });
  }
  function setupReveal() {
    revealReady = true;
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window) || reducedMotion) { items.forEach(item => item.classList.add('is-revealed')); return; }
    revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target; el.classList.add('is-revealed'); revealObserver.unobserve(el);
      window.setTimeout(() => el.classList.add('is-done'), 1500);
    }), { threshold: 0.12, rootMargin: '0px 0px -25px 0px' });
    items.forEach(item => revealObserver.observe(item));
  }
  function lockScroll() {
    if (document.body.classList.contains('locked')) return;
    lockedY = window.scrollY; document.body.style.top = `-${lockedY}px`; document.body.classList.add('locked');
  }
  function unlockScroll() {
    if (!document.body.classList.contains('locked')) return;
    document.body.classList.remove('locked'); document.body.style.top = '';
    window.scrollTo({ top: lockedY, behavior: 'instant' });
  }
  function splitWords(root, counter = { n: 0 }) {
    Array.from(root.childNodes).forEach(node => {
      if (node.nodeType === 3) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach(token => {
          if (!token) return;
          if (/^\s+$/.test(token)) { frag.appendChild(document.createTextNode(token)); return; }
          const wrap = document.createElement('span'), inner = document.createElement('span');
          wrap.className = 'w'; inner.textContent = token; inner.style.setProperty('--i', counter.n++); wrap.appendChild(inner); frag.appendChild(wrap);
        });
        node.replaceWith(frag);
      } else if (node.nodeType === 1 && node.tagName !== 'BR') splitWords(node, counter);
    });
  }
  function splitHeadings() {
    $$('.hero h1, .section-heading h2, .menu-title-row h2, .dulce-copy h2, .sunday-copy h2, .attitude-copy h2').forEach(el => splitWords(el));
  }
  function bump(el) { if (!el) return; el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump'); }
  function flyToCart(from) {
    const bar = $('#mobileOrderBar button');
    const target = bar && bar.offsetParent !== null ? bar : $('.cart-trigger');
    bump(target);
    if (reducedMotion || !from || !target.animate) return;
    const to = target.getBoundingClientRect();
    const x0 = from.left + from.width / 2 - 22, y0 = from.top + from.height / 2 - 23;
    const x1 = to.left + to.width / 2 - 22, y1 = to.top + to.height / 2 - 23;
    const dot = document.createElement('img');
    dot.src = '/assets/brand/cochi-isotipo-red.png'; dot.alt = ''; dot.className = 'fly-dot';
    document.body.appendChild(dot);
    dot.animate([
      { transform: `translate(${x0}px,${y0}px) scale(.6) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 110}px) scale(1.3) rotate(170deg)`, opacity: 1, offset: .5 },
      { transform: `translate(${x1}px,${y1}px) scale(.3) rotate(340deg)`, opacity: .9 }
    ], { duration: 780, easing: 'cubic-bezier(.45,0,.25,1)' }).onfinish = () => dot.remove();
  }
  function setupScrollFx() {
    let ticking = false;
    const update = () => {
      ticking = false;
      if (document.body.classList.contains('locked')) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      document.documentElement.style.setProperty('--sp', max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : 0);
      $('#top')?.classList.toggle('is-scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
  function setupEvents() {
    document.addEventListener('click', event => {
      const openButton = event.target.closest('[data-open-cart]');
      if (openButton) { event.preventDefault(); closeMobileNav(); openCart(); return; }
      const productButton = event.target.closest('[data-product-slug],[data-add-product]');
      if (productButton && !productButton.disabled) {
        event.preventDefault();
        const slug = productButton.dataset.productSlug || productButton.dataset.addProduct;
        openProductDialog(slug);
        return;
      }
      const catButton = event.target.closest('[data-category]');
      if (catButton) {
        activeCategory = catButton.dataset.category || 'Todo';
        renderProducts();
        return;
      }
      const filterButton = event.target.closest('[data-filter-category]');
      if (filterButton) {
        event.preventDefault();
        activeCategory = filterButton.dataset.filterCategory || 'Todo';
        activeSearch = '';
        $('#menuSearch').value = '';
        renderProducts();
        $('#menu').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
        return;
      }
      const qtyButton = event.target.closest('[data-line-qty]');
      if (qtyButton) { changeCartQuantity(qtyButton.dataset.lineKey, Number(qtyButton.dataset.lineQty)); return; }
      const removeButton = event.target.closest('[data-remove-line]');
      if (removeButton) { removeCartLine(removeButton.dataset.removeLine); return; }
      const upsellAdd = event.target.closest('[data-upsell-add]');
      if (upsellAdd) {
        const rule = upsellRule(upsellAdd.dataset.upsellAdd);
        if (rule && addPromoUnits(rule, promoAllowed(rule) - promoUnits(rule))) { saveCart(); renderCart(); showToast(`${productFromCatalog(rule.add_slug).name} agregado con promo.`); }
        return;
      }
      const editButton = event.target.closest('[data-edit-line]');
      if (editButton) {
        const line = cart.find(item => item.key === editButton.dataset.editLine);
        if (line) openProductDialog(line.slug, line.key);
        return;
      }
    });
    $('#closeCart').addEventListener('click', closeCart);
    $('#cartBackdrop').addEventListener('click', closeCart);
    $('#exploreFromCart').addEventListener('click', () => { closeCart(); $('#menu').scrollIntoView({ behavior:reducedMotion?'auto':'smooth' }); });
    $('#startCheckout').addEventListener('click', () => {
      if (!isOrderDay()) { showToast(orderScheduleMessage(), false); return; }
      if (!cart.length) return;
      if (cart.some(line => line.needsReview || !productAvailability(productFromCatalog(line.slug) || {}).canOrder)) {
        showToast('Edita los productos marcados y verifica su disponibilidad.', false); return;
      }
      $('#cartView').hidden = true; $('#checkoutView').hidden = false;
      renderModes(); renderCheckoutSummary(); $('#checkoutError').hidden = true;
      $('#checkoutView').scrollTop = 0;
      $('[name="customerName"]', $('#checkoutForm')).focus({ preventScroll:true });
    });
    $('#backToCart').addEventListener('click', () => { $('#checkoutView').hidden = true; $('#cartView').hidden = false; });
    $('#checkoutForm').addEventListener('submit', handleCheckoutSubmit);
    $('#checkoutForm').addEventListener('change', event => {
      if (event.target.name === 'orderMode') { updateDeliveryFields(); renderCheckoutSummary(); }
    });
    $('#menuSearch').addEventListener('input', event => { activeSearch = event.target.value.trim(); renderProducts(); });
    $('#mobileMenuToggle').addEventListener('click', () => {
      const nav = $('#mobileNav'); const expanded = $('#mobileMenuToggle').getAttribute('aria-expanded') === 'true';
      $('#mobileMenuToggle').setAttribute('aria-expanded', String(!expanded));
      nav.hidden = expanded;
    });
    $$('#mobileNav a').forEach(link => link.addEventListener('click', closeMobileNav));
    $('#productDialog').addEventListener('click', event => {
      if (event.target === $('#productDialog')) closeProductDialog();
    });
    $('#productDialog').addEventListener('close', () => {
      modalProduct = null; editingCartKey = null;
      if (!$('#cartDrawer').classList.contains('is-open')) unlockScroll();
    });
    $('.dialog-close-form').addEventListener('submit', event => { event.preventDefault(); closeProductDialog(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if ($('#cartDrawer').classList.contains('is-open')) closeCart();
        if ($('#productDialog').open) closeProductDialog();
        closeMobileNav();
      }
    });
    setupScrollFx();
    $('#currentYear').textContent = new Date().getFullYear();
  }
  function closeMobileNav() {
    const nav = $('#mobileNav');
    if (!nav) return;
    nav.hidden = true; $('#mobileMenuToggle').setAttribute('aria-expanded','false');
  }

  async function boot() {
    const introDone = setupIntro();
    splitHeadings();
    setupEvents();
    updateScheduleNotice();
    await loadContent();
    await loadConfig();
    await loadProducts();
    loadCart();
    renderFeatured(); renderProducts(); renderDulceFeatured(); renderCart(); renderModes();
    renderFlyers(); renderTestimonials(); renderAnnouncements();
    $$('[data-price-of]').forEach(el => { const p = productFromCatalog(el.dataset.priceOf); if (p) el.textContent = currencyUSD(p.price_usd).replace('.00', ''); });
    updateScheduleNotice();
    await introDone;
    setupReveal();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      // Offline-first/PWA no se registra aún: se evita cachear precios o catálogo antiguos.
    }
    // Sincroniza el carrito entre pestañas del mismo navegador.
    window.addEventListener('storage', event => {
      if (event.key === CART_KEY) { try { cart = hydrateCart(JSON.parse(event.newValue || '[]')); renderCart(); } catch {} }
    });
  }

  document.addEventListener('DOMContentLoaded', () => { boot().catch(error => { console.error('Cochi boot:', error); showToast('No se pudo cargar parte del menú. Actualiza la página e inténtalo otra vez.', false); }); });
})();
