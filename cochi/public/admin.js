(() => {
  'use strict';
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => Array.from(root.querySelectorAll(selector));
  const SESSION_KEY = 'cochi-admin-session-v1';
  let config = { supabaseUrl:'', supabaseAnonKey:'', storageBucket:'cochi-products', whatsappNumber:'584242246392', orderModes:['delivery','pickup'] };
  let session = null;
  let adminProducts = [];
  let currentEditing = null;
  let settings = {};
  let optionEditorSerial = 0;
  const newOptionEditorId = prefix => `${prefix}-${Date.now()}-${++optionEditorSerial}`;

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function note(message, type='') {
    const box = $('#adminGlobalNotice');
    box.className = `admin-notice${type ? ' admin-notice--'+type : ''}`;
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
  function clearNote() { $('#adminGlobalNotice').hidden = true; }
  async function responseJson(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message:text }; }
    if (!response.ok) throw new Error(data.message || data.error_description || data.error || `Error HTTP ${response.status}`);
    return data;
  }
  function storageSessionRead() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function storageSessionWrite(value) {
    session = value;
    try { if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); else sessionStorage.removeItem(SESSION_KEY); } catch {}
  }
  async function loadPublicConfig() {
    try { config = { ...config, ...(await fetch('/api/config',{cache:'no-store'}).then(responseJson)) }; } catch {}
    config.supabaseUrl = String(config.supabaseUrl || '').replace(/\/$/,'');
  }
  function authHeaders(token=session?.access_token) {
    const headers = { apikey:config.supabaseAnonKey, 'Content-Type':'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    else headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
    return headers;
  }
  async function refreshSession() {
    if (!session?.refresh_token) return false;
    const result = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method:'POST', headers:authHeaders(null), body:JSON.stringify({ refresh_token:session.refresh_token })
    }).then(responseJson);
    storeAuthResult(result);
    return Boolean(session?.access_token);
  }
  function storeAuthResult(result) {
    session = {
      access_token:result.access_token,
      refresh_token:result.refresh_token,
      expires_at:result.expires_at || (Math.floor(Date.now()/1000) + Number(result.expires_in || 3600)),
      user:result.user || session?.user || null
    };
    storageSessionWrite(session);
  }
  async function authFetch(url, options={}) {
    if (session?.expires_at && session.expires_at < Math.floor(Date.now()/1000) + 20) {
      try { await refreshSession(); } catch { storageSessionWrite(null); }
    }
    const init = { ...options, headers:{ ...authHeaders(), ...(options.headers || {}) } };
    let response = await fetch(url, init);
    if (response.status === 401 && session?.refresh_token) {
      try {
        await refreshSession();
        response = await fetch(url, { ...options, headers:{ ...authHeaders(), ...(options.headers || {}) } });
      } catch { storageSessionWrite(null); }
    }
    return response;
  }
  const restBase = () => `${config.supabaseUrl}/rest/v1`;
  async function rest(path, options={}) {
    const response = await authFetch(`${restBase()}/${path}`, options);
    return responseJson(response);
  }
  function hideAllPanels() {
    $('#configPanel').hidden = true; $('#loginPanel').hidden = true; $('#managementPanel').hidden = true;
  }
  function showConfiguredUnconnected() {
    hideAllPanels(); $('#configPanel').hidden = false;
  }
  function showLogin() {
    hideAllPanels(); $('#loginPanel').hidden = false;
  }
  function showManagement() {
    hideAllPanels(); $('#managementPanel').hidden = false;
  }
  async function signIn(email, password) {
    const result = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method:'POST', headers:authHeaders(null), body:JSON.stringify({ email, password })
    }).then(responseJson);
    storeAuthResult(result);
    await verifyAdminAccess();
  }
  async function verifyAdminAccess() {
    const resp = await authFetch(`${config.supabaseUrl}/auth/v1/user`, { headers:authHeaders() });
    await responseJson(resp);
    // La primera lectura protegida comprueba el permiso de administrador de RLS.
    await loadAdminProducts();
    await loadSettings();
    showManagement();
    renderProducts();
    clearNote();
  }
  async function signOut() {
    try { await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method:'POST', headers:authHeaders() }); } catch {}
    storageSessionWrite(null); adminProducts=[]; currentEditing=null; showLogin(); note('Sesión cerrada.','success');
  }
  async function loadAdminProducts() {
    const rows = await rest('products?select=*&order=sort_order.asc', { method:'GET', headers:{ Prefer:'return=representation' } });
    adminProducts = Array.isArray(rows) ? rows : [];
    $('#adminCatalogStatus').textContent = `${adminProducts.length} productos cargados desde Supabase.`;
  }
  function renderProducts() {
    const container = $('#adminProductList');
    if (!adminProducts.length) {
      container.innerHTML = `<div class="admin-notice">El catálogo de Supabase está vacío. Importa los productos y precios del archivo inicial para comenzar, o crea tu primer producto.</div><button class="admin-small-button" type="button" id="importBaseCatalogButton">Importar catálogo inicial de Cochi</button>`;
      $('#importBaseCatalogButton').addEventListener('click', importBaseCatalog);
      return;
    }
    container.innerHTML = adminProducts.map(product => {
      const state = product.is_coming_soon ? 'Próximamente' : product.available ? (Array.isArray(product.availability_days) && product.availability_days.length ? 'Disponible según día' : 'Disponible') : 'Agotado';
      return `<div class="admin-product-row"><div><strong>${esc(product.name)}</strong><small>${esc(product.category)} · $${Number(product.price_usd || 0).toFixed(2)} · ${esc(state)}${product.is_visible ? '' : ' · Oculto'}</small></div><div class="admin-product-row__actions"><button type="button" class="admin-small-button" data-edit-product="${esc(product.id)}">Editar</button><button type="button" class="admin-small-button admin-small-button--red" data-toggle-product="${esc(product.id)}">${product.is_visible ? 'Ocultar' : 'Mostrar'}</button></div></div>`;
    }).join('');
  }
  async function importBaseCatalog() {
    const button = $('#importBaseCatalogButton');
    if (button) { button.disabled = true; button.textContent = 'Importando…'; }
    try {
      const baseProducts = await fetch('/data/products.json',{cache:'no-store'}).then(responseJson);
      const rows = baseProducts.map(product => ({ ...product, id:String(product.id), slug:String(product.slug) }));
      // Upsert para que repetir una importación no duplique el catálogo.
      const result = await rest('products?on_conflict=slug', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(rows) });
      if (!Array.isArray(result)) throw new Error('Supabase no confirmó el catálogo importado.');
      await loadAdminProducts(); renderProducts(); note(`Catálogo inicial importado: ${result.length} registros respondidos por Supabase. Revisa los precios y las opciones antes de publicar.`, 'success');
    } catch (error) { note(`No se pudo importar el catálogo. Comprueba el esquema SQL, los permisos de administrador y las políticas RLS. Detalle: ${error.message}`, 'error'); if (button) { button.disabled=false; button.textContent='Reintentar importación'; } }
  }
  function slugify(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || `producto-${Date.now()}`;
  }
  function renderOptionsEditor(options=[]) {
    const target = $('#optionsEditor');
    if (!target) return;
    target.innerHTML = options.map((group, groupIndex) => {
      const type = group.type === 'multiple' ? 'multiple' : 'single';
      const required = Boolean(group.required);
      const min = Number(group.min ?? (required ? 1 : 0));
      const max = Number(group.max ?? (type === 'single' ? 1 : 99));
      const choices = Array.isArray(group.choices) ? group.choices : [];
      const choiceHtml = choices.map((choice, choiceIndex) => `<div class="option-editor-choice" data-option-choice-id="${esc(choice.id || `choice-${choiceIndex + 1}`)}"><label>Nombre de la opción<input type="text" data-choice-field="label" value="${esc(choice.label || '')}" maxlength="100" placeholder="Ej. A la BBQ"></label><label>Suplemento (USD)<input type="number" data-choice-field="price_usd" value="${Number(choice.price_usd || 0).toFixed(2)}" min="0" max="9999" step="0.01" inputmode="decimal"></label><button class="admin-small-button admin-small-button--red" type="button" data-remove-option-choice>Quitar</button></div>`).join('');
      return `<section class="option-editor-group" data-option-editor-group data-group-id="${esc(group.id || `group-${groupIndex + 1}`)}"><div class="option-editor-header"><strong>Grupo ${groupIndex + 1}</strong><button class="admin-small-button admin-small-button--red" type="button" data-remove-option-group>Eliminar grupo</button></div><div class="option-editor-fields"><label>Nombre del grupo<input type="text" data-group-field="name" value="${esc(group.name || '')}" maxlength="100" placeholder="Ej. Elige la salsa" required></label><label>Tipo de selección<select data-group-field="type"><option value="single" ${type === 'single' ? 'selected' : ''}>Una opción</option><option value="multiple" ${type === 'multiple' ? 'selected' : ''}>Varias opciones con cantidad</option></select></label><label class="option-editor-required"><input type="checkbox" data-group-field="required" ${required ? 'checked' : ''}> Selección obligatoria</label><label>Mínimo de opciones<input type="number" data-group-field="min" value="${Math.max(0,min)}" min="0" max="99" step="1"></label><label>Máximo de opciones<input type="number" data-group-field="max" value="${Math.max(1,max)}" min="1" max="99" step="1"></label></div><div class="option-editor-choices"><div class="option-editor-choices-head"><strong>Opciones de este grupo</strong><button class="admin-small-button" type="button" data-add-option-choice>+ Añadir opción</button></div>${choiceHtml || '<p class="admin-muted">Todavía no hay opciones. Añade al menos una.</p>'}</div></section>`;
    }).join('') || '<p class="option-editor-empty">Este producto no necesita personalizaciones. Puedes dejarlo así o añadir un grupo si el cliente debe elegir algo.</p>';
  }

  function readOptionsEditor(validate=true) {
    const groups = $$('.option-editor-group', $('#optionsEditor')).map((node, groupIndex) => {
      const name = $('[data-group-field="name"]', node).value.trim();
      const type = $('[data-group-field="type"]', node).value === 'multiple' ? 'multiple' : 'single';
      const required = $('[data-group-field="required"]', node).checked;
      const minInput = $('[data-group-field="min"]', node);
      const maxInput = $('[data-group-field="max"]', node);
      let min = Number(minInput.value === '' ? (required ? 1 : 0) : minInput.value);
      let max = Number(maxInput.value === '' ? (type === 'single' ? 1 : 99) : maxInput.value);
      const rows = $$('.option-editor-choice', node);
      const choices = rows.map((row, choiceIndex) => {
        const label = $('[data-choice-field="label"]', row).value.trim();
        const rawPrice = $('[data-choice-field="price_usd"]', row).value;
        const price = Number(rawPrice === '' ? 0 : rawPrice);
        return { id:row.dataset.optionChoiceId || `choice-${choiceIndex + 1}`, label, price_usd:price };
      });
      if (validate) {
        if (!name) throw new Error(`Escribe un nombre para el grupo de opciones ${groupIndex + 1}.`);
        if (!choices.length || choices.some(choice => !choice.label)) throw new Error(`Completa el nombre de cada opción del grupo “${name}”.`);
        if (choices.some(choice => !Number.isFinite(choice.price_usd) || choice.price_usd < 0)) throw new Error(`Revisa los suplementos del grupo “${name}”; deben ser importes USD no negativos.`);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 1 || min > max) throw new Error(`Revisa el mínimo y el máximo del grupo “${name}”.`);
        if (required && min < 1) min = 1;
        if (type === 'single') max = 1;
        if (min > max) throw new Error(`El mínimo no puede superar el máximo del grupo “${name}”.`);
        if (type === 'single' && choices.length < 1) throw new Error(`Añade una opción al grupo “${name}”.`);
      } else {
        if (!Number.isFinite(min) || min < 0) min = required ? 1 : 0;
        if (!Number.isFinite(max) || max < 1) max = type === 'single' ? 1 : 99;
        if (type === 'single') max = 1;
        if (required && min < 1) min = 1;
        if (min > max) min = max;
      }
      return { id:node.dataset.groupId || `group-${groupIndex + 1}`, name, type, required, min, max, choices };
    });
    const ids = groups.map(group => group.id);
    if (validate && new Set(ids).size !== ids.length) throw new Error('Hay dos grupos con el mismo identificador. Elimina y vuelve a crear uno de ellos.');
    $('#productForm').elements.options_json.value = JSON.stringify(groups);
    return groups;
  }

  function fillProductForm(product=null) {
    currentEditing = product;
    const form = $('#productForm'); form.reset();
    form.elements.id.value = product?.id || '';
    form.elements.name.value = product?.name || '';
    form.elements.category.value = product?.category || '';
    form.elements.price_usd.value = product?.price_usd ?? '';
    form.elements.brand.value = product?.brand || 'cochi';
    form.elements.description.value = product?.description || '';
    form.elements.image.value = product?.image || '';
    form.elements.sort_order.value = product?.sort_order ?? (adminProducts.length + 1) * 10;
    form.elements.available.checked = product?.available !== false;
    form.elements.is_visible.checked = product?.is_visible !== false;
    form.elements.featured.checked = Boolean(product?.featured);
    form.elements.is_coming_soon.checked = Boolean(product?.is_coming_soon);
    form.elements.options_json.value = JSON.stringify(product?.options || []);
    renderOptionsEditor(product?.options || []);
    const days = Array.isArray(product?.availability_days) ? product.availability_days : [];
    const availability = days.length === 0 ? 'all' : (days.length === 1 && days[0] === 0 ? 'sunday' : 'custom');
    form.elements.availability.value = availability;
    form.elements.availability_days_json.value = JSON.stringify(days);
    $$('[data-weekday]', form).forEach(input => { input.checked = days.includes(Number(input.value)); });
    $('#customDaysField').hidden = availability !== 'custom';
    $('#productEditorTitle').textContent = product ? `Editar: ${product.name}` : 'Nuevo producto';
    $('#productEditor').hidden = false;
    $('#productEditor').scrollIntoView({ behavior:'smooth', block:'start' });
    form.elements.name.focus({preventScroll:true});
  }
  function closeProductEditor() { $('#productEditor').hidden = true; currentEditing = null; $('#productForm').reset(); }
  function readProductForm() {
    const form = $('#productForm');
    const name = form.elements.name.value.trim();
    const category = form.elements.category.value.trim();
    const description = form.elements.description.value.trim();
    const price = Number(form.elements.price_usd.value);
    if (!name || !category || !description || !Number.isFinite(price) || price < 0) throw new Error('Completa nombre, categoría, descripción y un precio USD válido (no negativo).');
    if (!form.elements.is_coming_soon.checked && price <= 0) throw new Error('Los productos disponibles deben tener un precio mayor que cero.');
    const options = readOptionsEditor(true);
    let days = [];
    if (form.elements.availability.value === 'sunday') days = [0];
    if (form.elements.availability.value === 'custom') {
      days = [...new Set($$('[data-weekday]:checked', form).map(input => Number(input.value)))];
      if (!days.length) throw new Error('Selecciona al menos un día de disponibilidad.');
    }
    const slug = currentEditing?.slug || slugify(name);
    return {
      id:form.elements.id.value || (crypto.randomUUID ? crypto.randomUUID() : `product-${Date.now()}`),
      slug, name, category, description, price_usd:Number(price.toFixed(2)), image:form.elements.image.value.trim(),
      available:form.elements.available.checked, availability_days:days, is_visible:form.elements.is_visible.checked,
      is_coming_soon:form.elements.is_coming_soon.checked, featured:form.elements.featured.checked,
      brand:form.elements.brand.value === 'dulce' ? 'dulce' : 'cochi', sort_order:Number(form.elements.sort_order.value || 100), options
    };
  }
  async function saveProduct(event) {
    event.preventDefault();
    try {
      const product = readProductForm();
      await rest('products?on_conflict=slug', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(product) });
      await loadAdminProducts(); renderProducts(); closeProductEditor(); note(`“${product.name}” se guardó. Comprueba su presentación en la web pública.`, 'success');
    } catch (error) { note(`No se pudo guardar el producto: ${error.message}. Si es un error de permiso, comprueba la tabla admin_users y las políticas RLS.`, 'error'); }
  }
  async function toggleProduct(id) {
    const product = adminProducts.find(p => String(p.id) === String(id));
    if (!product) return;
    try {
      await rest(`products?id=eq.${encodeURIComponent(product.id)}`, { method:'PATCH', headers:{ Prefer:'return=representation' }, body:JSON.stringify({ is_visible:!product.is_visible, updated_at:new Date().toISOString() }) });
      await loadAdminProducts(); renderProducts(); note(`Producto ${product.is_visible ? 'oculto' : 'visible'} en la web.`, 'success');
    } catch(error) { note(`No se pudo cambiar la visibilidad: ${error.message}`, 'error'); }
  }
  async function loadSettings() {
    const rows = await rest('site_settings?select=key,value', { method:'GET' });
    settings = Object.fromEntries((Array.isArray(rows) ? rows : []).map(row => [row.key, row.value]));
    const form = $('#settingsForm');
    const numberValue = settings.whatsapp_number;
    form.elements.whatsapp_number.value = typeof numberValue === 'string' && numberValue ? numberValue.replace(/\D/g,'') : String(config.whatsappNumber || '584242246392');
    form.elements.whatsapp_number_confirmed.checked = settings.whatsapp_number_confirmed === true || settings.whatsapp_number_confirmed === 'true';
    form.elements.order_modes_confirmed.checked = settings.order_modes_confirmed === true || settings.order_modes_confirmed === 'true';
    const fee = settings.delivery_fee_usd;
    form.elements.delivery_fee_usd.value = fee === null || fee === undefined || fee === '' ? '' : Number(fee);
    let modes = settings.order_modes;
    if (typeof modes === 'string') { try { modes = JSON.parse(modes); } catch { modes=[modes]; } }
    if (!Array.isArray(modes) || !modes.length) modes = config.orderModes || ['delivery','pickup'];
    $$('input[name="order_modes"]', form).forEach(input => { input.checked = modes.includes(input.value); });
  }
  async function saveSettings(event) {
    event.preventDefault();
    const form = $('#settingsForm');
    const phone = form.elements.whatsapp_number.value.replace(/\D/g,'');
    const phoneConfirmed = form.elements.whatsapp_number_confirmed.checked;
    const modesConfirmed = form.elements.order_modes_confirmed.checked;
    const modes = $$('input[name="order_modes"]:checked',form).map(input => input.value);
    const feeText = form.elements.delivery_fee_usd.value.trim();
    const fee = feeText === '' ? null : Number(feeText);
    if (phone.length < 10 || phone.length > 15) { note('Escribe el número internacional sin el +. Venezuela suele comenzar por 58; confirma el número comercial antes de guardarlo.', 'error'); return; }
    if (!modes.length) { note('Selecciona por lo menos una modalidad de pedido.', 'error'); return; }
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) { note('El costo de entrega debe ser un importe USD válido o quedar vacío.', 'error'); return; }
    try {
      const rows = [
        { key:'whatsapp_number', value:phone },
        { key:'whatsapp_number_confirmed', value:phoneConfirmed },
        { key:'delivery_fee_usd', value:fee },
        { key:'order_modes', value:modes },
        { key:'order_modes_confirmed', value:modesConfirmed }
      ];
      await rest('site_settings?on_conflict=key', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' }, body:JSON.stringify(rows) });
      settings = { whatsapp_number:phone, whatsapp_number_confirmed:phoneConfirmed, delivery_fee_usd:fee, order_modes:modes, order_modes_confirmed:modesConfirmed };
      const pending = [!phoneConfirmed ? 'WhatsApp' : '', !modesConfirmed ? 'modalidades/zona' : ''].filter(Boolean).join(' y ');
      note(pending ? `Ajustes guardados; falta confirmar ${pending}. La web mantendrá el aviso correspondiente.` : 'Ajustes guardados y confirmados por el negocio.', 'success');
    } catch(error) { note(`No se pudieron guardar los ajustes: ${error.message}. Comprueba la política RLS de site_settings.`, 'error'); }
  }
  async function uploadImage() {
    const input = $('#productImageFile'); const file = input.files?.[0];
    if (!file) { note('Selecciona primero una foto JPG, PNG o WebP.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { note('La foto supera 5 MB. Optimízala antes de subirla.', 'error'); return; }
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { note('Formato no admitido. Usa JPG, PNG o WebP.', 'error'); return; }
    if (!session?.access_token) { note('Inicia sesión para subir fotografías.', 'error'); return; }
    const button = $('#uploadImageButton'); button.disabled=true; button.textContent='Subiendo…';
    try {
      const bucket = String(config.storageBucket || 'cochi-products').replace(/[^a-zA-Z0-9_-]/g,'');
      const filename = `${Date.now()}-${slugify(file.name.replace(/\.[^.]+$/,''))}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`;
      const response = await authFetch(`${config.supabaseUrl}/storage/v1/object/${bucket}/${filename}`, { method:'POST', headers:{ 'Content-Type':file.type, 'x-upsert':'true' }, body:file });
      await responseJson(response);
      const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
      $('#productForm').elements.image.value = publicUrl;
      note('Fotografía subida. Guarda el producto para conservar la URL.', 'success');
    } catch(error) { note(`No se pudo subir la foto: ${error.message}. Verifica el bucket público y las políticas de Storage descritas en el README.`, 'error'); }
    finally { button.disabled=false; button.textContent='Subir foto seleccionada'; }
  }
  function setTab(name) {
    $$('[data-admin-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.adminTab===name));
    $('#adminProductsTab').hidden = name !== 'products';
    $('#adminSettingsTab').hidden = name !== 'settings';
    $('#productEditor').hidden = true;
  }
  function setupEvents() {
    $('#loginForm').addEventListener('submit', async event => {
      event.preventDefault(); clearNote();
      const form = event.currentTarget; const button = $('button[type="submit"]',form); button.disabled=true;
      try { await signIn(form.elements.email.value.trim(), form.elements.password.value); note('Sesión iniciada.', 'success'); }
      catch(error) { storageSessionWrite(null); showLogin(); note(`No se pudo entrar. Confirma el correo y la contraseña, y que el usuario esté en public.admin_users. Detalle: ${error.message}`, 'error'); }
      finally { button.disabled=false; }
    });
    $('#newProductButton').addEventListener('click', () => fillProductForm(null));
    $('#refreshProductsButton').addEventListener('click', async () => { try { await loadAdminProducts(); renderProducts(); await loadSettings(); note('Datos actualizados desde Supabase.','success'); } catch(error) { note(`No se pudieron actualizar los datos: ${error.message}`, 'error'); } });
    $('#logoutButton').addEventListener('click', signOut);
    $('#productForm').addEventListener('submit', saveProduct);
    $('#cancelProductEdit').addEventListener('click', closeProductEditor);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#uploadImageButton').addEventListener('click', uploadImage);
    $('#productForm').elements.availability.addEventListener('change', event => { $('#customDaysField').hidden = event.target.value !== 'custom'; });
    $('#addOptionGroupButton').addEventListener('click', () => {
      const groups = readOptionsEditor(false);
      const groupId = newOptionEditorId('group');
      const choiceId = newOptionEditorId('choice');
      groups.push({ id:groupId, name:'Nueva personalización', type:'single', required:true, min:1, max:1, choices:[{ id:choiceId, label:'Nueva opción', price_usd:0 }] });
      renderOptionsEditor(groups);
      const name = $('.option-editor-group:last-child [data-group-field="name"]', $('#optionsEditor'));
      name?.focus(); name?.select();
    });
    $('#optionsEditor').addEventListener('click', event => {
      const groupNode = event.target.closest('.option-editor-group');
      if (!groupNode) return;
      const groups = readOptionsEditor(false);
      const groupIndex = $$('.option-editor-group', $('#optionsEditor')).indexOf(groupNode);
      if (groupIndex < 0) return;
      if (event.target.closest('[data-remove-option-group]')) {
        groups.splice(groupIndex, 1); renderOptionsEditor(groups); return;
      }
      if (event.target.closest('[data-add-option-choice]')) {
        groups[groupIndex].choices.push({ id:newOptionEditorId('choice'), label:'Nueva opción', price_usd:0 });
        renderOptionsEditor(groups);
        const group = $$('.option-editor-group', $('#optionsEditor'))[groupIndex];
        const inputs = $$('[data-choice-field="label"]', group); inputs.at(-1)?.focus(); inputs.at(-1)?.select();
        return;
      }
      if (event.target.closest('[data-remove-option-choice]')) {
        const choiceNode = event.target.closest('.option-editor-choice');
        const choiceIndex = $$('.option-editor-choice', groupNode).indexOf(choiceNode);
        if (choiceIndex >= 0) groups[groupIndex].choices.splice(choiceIndex, 1);
        renderOptionsEditor(groups);
      }
    });
    $('#optionsEditor').addEventListener('change', event => {
      const field = event.target.dataset.groupField;
      if (!field) return;
      const group = event.target.closest('.option-editor-group');
      if (!group) return;
      const min = $('[data-group-field="min"]', group);
      const max = $('[data-group-field="max"]', group);
      if (field === 'required' && event.target.checked && Number(min.value) < 1) min.value = '1';
      if (field === 'required' && !event.target.checked) min.value = '0';
      if (field === 'type') {
        if (event.target.value === 'single') { max.value = '1'; if (Number(min.value) > 1) min.value = '1'; }
        else if (Number(max.value) === 1) max.value = '99';
      }
    });
    $$('[data-admin-tab]').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.adminTab)));
    $('#adminProductList').addEventListener('click', event => {
      const edit = event.target.closest('[data-edit-product]');
      const toggle = event.target.closest('[data-toggle-product]');
      if (edit) { const product = adminProducts.find(p => String(p.id) === String(edit.dataset.editProduct)); if (product) fillProductForm(product); }
      if (toggle) toggleProduct(toggle.dataset.toggleProduct);
    });
  }
  async function boot() {
    await loadPublicConfig(); setupEvents(); session = storageSessionRead();
    if (!config.supabaseUrl || !config.supabaseAnonKey) { showConfiguredUnconnected(); return; }
    if (!session?.access_token) { showLogin(); return; }
    try { await verifyAdminAccess(); }
    catch(error) { storageSessionWrite(null); showLogin(); note(`La sesión anterior ya no sirve o el usuario no tiene permiso administrativo. ${error.message}`, 'error'); }
  }
  document.addEventListener('DOMContentLoaded', () => boot().catch(error => { showLogin(); note(`Error al iniciar administración: ${error.message}`, 'error'); }));
})();
