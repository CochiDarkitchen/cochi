module.exports = function configHandler(req, res) {
  const whatsapp = String(process.env.COCHI_WHATSAPP_NUMBER || '584242246392').replace(/\D/g, '');
  const modes = String(process.env.COCHI_ORDER_MODES || 'delivery,pickup').split(',').map(x => x.trim()).filter(x => ['delivery', 'pickup'].includes(x));
  const feeEnv = process.env.DELIVERY_FEE_USD;
  const fee = feeEnv === undefined || feeEnv === '' ? null : Number(feeEnv);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 200;
  res.end(JSON.stringify({
    whatsappNumber: whatsapp,
    whatsappNumberConfirmed: String(process.env.COCHI_WHATSAPP_CONFIRMED || '').toLowerCase() === 'true',
    orderModes: modes.length ? modes : ['delivery', 'pickup'],
    orderModesConfirmed: String(process.env.COCHI_ORDER_MODES_CONFIRMED || '').toLowerCase() === 'true',
    supabaseUrl: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'cochi-products',
    deliveryFeeUSD: Number.isFinite(fee) && fee >= 0 ? fee : null
  }));
};
