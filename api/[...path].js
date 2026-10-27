// Punto de entrada de Vercel: todas las rutas /api/* usan el mismo manejador que el servidor local.
const { handle } = require('../lib/api');
module.exports = (req, res) => handle(req, res);
