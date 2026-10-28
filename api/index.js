// Punto de entrada de Vercel: todas las rutas /api/* usan el mismo manejador que el servidor local.
let handler = null;
let loadError = null;
try { ({ handle: handler } = require('../lib/api')); } catch (error) { loadError = error; console.error('No se pudo cargar la API:', error); }

module.exports = (req, res) => {
  if (loadError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: `La API no pudo iniciar: ${loadError.message}` }));
  }
  return handler(req, res);
};
