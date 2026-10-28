function dateInCaracas() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function businessDaysElapsed(fromDate, toDate = dateInCaracas()) {
  if (!fromDate || fromDate >= toDate) return 0;
  const from = new Date(`${fromDate}T12:00:00Z`);
  const to = new Date(`${toDate}T12:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 99;
  let count = 0;
  const cursor = new Date(from);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= to && count < 50) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
module.exports = async function bcvHandler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  const provider = process.env.BCV_API_URL || 'https://bcv.today/api/v1/rate.json';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    let response;
    try {
      response = await fetch(provider, { headers: { Accept: 'application/json', 'User-Agent': 'CochiMenu/1.0 (+BCV rate display)' }, signal: controller.signal, cache: 'no-store' });
    } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error(`Proveedor BCV respondió HTTP ${response.status}`);
    const payload = await response.json();
    const usdVES = Number(payload.USD ?? payload.usd ?? payload.rate?.USD);
    const effectiveDate = String(payload.effective_date || payload.effectiveDate || payload.date || '').slice(0, 10);
    if (!Number.isFinite(usdVES) || usdVES <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('La respuesta de la tasa no tiene USD o fecha válida.');
    const daysOld = businessDaysElapsed(effectiveDate);
    res.statusCode = 200;
    return res.end(JSON.stringify({
      usdVES,
      effectiveDate,
      capturedAt: payload.updated_at || payload.captured_at || new Date().toISOString(),
      source: 'BCV (vía API comunitaria bcv.today)',
      sourceUrl: 'https://bcv.today/api/v1/rate.json',
      stale: daysOld > 0,
      businessDaysElapsed: daysOld
    }));
  } catch (error) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.end(JSON.stringify({ error: 'No se pudo actualizar la tasa BCV. La web puede usar la última tasa válida guardada en este dispositivo.', detail: process.env.NODE_ENV === 'development' ? String(error.message || error) : undefined }));
  }
};
