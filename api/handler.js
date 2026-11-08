'use strict';
// Única función de Vercel. vercel.json envía aquí todas las solicitudes /api/*.
// IMPORTANTE: no pongas "_" ni "." al inicio del nombre de este archivo. Vercel ignora esos
// archivos en api/ (no los convierte en función) y todo /api/* respondería 404 NOT_FOUND.
let handler = null;
let loadError = null;
try { ({ handle: handler } = require('../lib/api')); }
catch (error) { loadError = error; console.error('No se pudo cargar la API:', error); }

module.exports = (req, res) => {
  if (loadError || !handler) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: `La API no pudo iniciar: ${loadError?.message || 'Manejador no disponible.'}` }));
  }
  return handler(req, res);
};
