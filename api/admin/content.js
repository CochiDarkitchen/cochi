'use strict';
// Ruta explícita de Vercel: delega la lógica a un único controlador compartido.
const { handle } = require('../../lib/api');

module.exports = (req, res) => handle(req, res);
