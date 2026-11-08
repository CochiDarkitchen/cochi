'use strict';
// Ruta explícita de Vercel: /api/admin/coupons
const { vercelHandler } = require('../../lib/vercel-handler');
module.exports = vercelHandler('Cupones');
