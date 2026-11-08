'use strict';
// Ruta explícita de Vercel: /api/admin/orders/:orderId
const { vercelHandler } = require('../../../lib/vercel-handler');
module.exports = vercelHandler('Comandas');
