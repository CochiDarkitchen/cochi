'use strict';
// Ruta explícita de Vercel: /api/admin/logout
const { vercelHandler } = require('../../lib/vercel-handler');
module.exports = vercelHandler('Panel administrativo');
