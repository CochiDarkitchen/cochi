'use strict';
// Almacenamiento: Upstash Redis (producción en Vercel) o carpeta local "storage/" (desarrollo).
const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DIR = process.env.COCHI_STORAGE_DIR || path.join(__dirname, '..', 'storage');
// 'kv' = base de datos conectada, 'file' = carpeta local, 'none' = en Vercel sin base de datos (solo lectura)
const mode = KV_URL && KV_TOKEN ? 'kv' : (process.env.VERCEL ? 'none' : 'file');

async function kv(command) {
  const response = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `La base de datos respondió ${response.status}`);
  return data.result;
}
const fileFor = key => path.join(DIR, key.replace(/[^a-zA-Z0-9_-]/g, '_'));

async function get(key) {
  if (mode === 'kv') return kv(['GET', key]);
  if (mode === 'file') { try { return fs.readFileSync(fileFor(key), 'utf8'); } catch { return null; } }
  return null;
}
async function set(key, value) {
  if (mode === 'kv') { await kv(['SET', key, value]); return; }
  if (mode === 'file') { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(fileFor(key), value); return; }
  throw Object.assign(new Error('La base de datos no está conectada. Revisa el paso 3 del README.'), { status: 503 });
}
module.exports = { mode, get, set };
