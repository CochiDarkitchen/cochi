'use strict';
// Adaptador compartido para las rutas explícitas de Vercel.
// Cada archivo de api/ delega en el mismo manejador para conservar
// autenticación, validaciones y almacenamiento en un solo lugar.
let handler = null;
let loadError = null;
try {
  ({ handle: handler } = require('./api'));
} catch (error) {
  loadError = error;
  console.error('No se pudo cargar el manejador de Cochi:', error);
}

function vercelHandler(label = 'API') {
  return (req, res) => {
    if (loadError || !handler) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        error: `${label}: no se pudo iniciar el servicio.`,
        detail: loadError?.message || 'Manejador no disponible.'
      }));
    }
    return handler(req, res);
  };
}

module.exports = { vercelHandler };
