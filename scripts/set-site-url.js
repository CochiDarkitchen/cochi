// Pone la dirección completa del sitio en las etiquetas para compartir (WhatsApp, redes).
// Se ejecuta solo en Vercel al publicar. Es seguro correrlo varias veces.
const fs = require('node:fs');
const path = require('node:path');

const raw = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
if (!raw) { console.log('SITE_URL no está definido: las etiquetas para compartir quedan con rutas relativas.'); process.exit(0); }
const site = (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '');
const file = path.join(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8').replace(/<(meta|link)\b[^>]*\bdata-abs\b[^>]*>/g, tag =>
  tag.replace(/\b(content|href)="(?:https?:\/\/[^"\/]+)?(\/[^"]*)"/, (_, attr, rest) => `${attr}="${site}${rest}"`));
fs.writeFileSync(file, html);
console.log(`Etiquetas para compartir apuntan a ${site}`);
