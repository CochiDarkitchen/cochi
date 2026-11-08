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
const need = () => { if (mode === 'none') throw Object.assign(new Error('La base de datos en la nube no está conectada. En Vercel revisa Storage > Upstash y confirma que existan KV_REST_API_URL y KV_REST_API_TOKEN; después vuelve a desplegar.'), { status: 503 }); };
const readSet = async key => { try { return JSON.parse((await get(key)) || '[]'); } catch { return []; } };
async function incr(key, by = 1) { need(); if (mode === 'kv') return kv([by > 0 ? 'INCR' : 'DECR', key]); const n = Number((await get(key)) || 0) + by; await set(key, String(n)); return n; }
async function sadd(key, member) { need(); if (mode === 'kv') return kv(['SADD', key, member]); const a = await readSet(key); if (a.includes(member)) return 0; a.push(member); await set(key, JSON.stringify(a)); return 1; }
async function srem(key, member) { need(); if (mode === 'kv') return kv(['SREM', key, member]); await set(key, JSON.stringify((await readSet(key)).filter(x => x !== member))); return 1; }
async function sismember(key, member) { need(); if (mode === 'kv') return kv(['SISMEMBER', key, member]); return (await readSet(key)).includes(member) ? 1 : 0; }
module.exports = { mode, get, set, ensureAvailable: need, incr, sadd, srem, sismember };
