'use strict';
// Ruta explícita de Vercel: /api/admin/customers/:customerId
const { vercelHandler } = require('../../../lib/vercel-handler');
module.exports = vercelHandler('Clientes');
