'use strict';
// Ruta explícita de Vercel para administrar cupones.
// Mantiene la misma lógica, autenticación y almacenamiento que el manejador general.
let handler = null;
let loadError = null;
try {
  ({ handle: handler } = require('../../lib/api'));
} catch (error) {
  loadError = error;
  console.error('No se pudo cargar la API de cupones:', error);
}

module.exports = (req, res) => {
  if (loadError || !handler) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: `La API de cupones no pudo iniciar: ${loadError?.message || 'manejador no disponible'}` }));
  }
  return handler(req, res);
};
