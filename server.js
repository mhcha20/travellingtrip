const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const receipt = require('./receipt');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.TRIP_PASSWORD || '';
// Google login: when GOOGLE_CLIENT_ID is set, only signed-in users on ALLOWED_EMAILS can see the site.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const PUBLIC_FILES = new Set(['/login.html', '/style.css', '/snow.js']);
const PUBLIC = path.join(__dirname, 'public');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS journal  (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
    CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id text PRIMARY KEY, mime text NOT NULL, image bytea NOT NULL, created_at timestamptz DEFAULT now());`);
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 25e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
function makeSession(email) {
  const v = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return v + '.' + sign(v);
}
function sessionEmail(req) {
  const m = /(?:^|;\s*)tt_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [v, sig] = m[1].split('.');
  if (!v || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(v));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(v, 'base64url'));
    return exp > Date.now() && ALLOWED.includes(email) ? email : null;
  } catch { return null; }
}
const cookie = (val, maxAge) => `tt_session=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function verifyGoogle(credential) {
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) return null;
  const t = await r.json();
  if (t.aud !== GOOGLE_CLIENT_ID) return null;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) return null;
  if (t.email_verified !== 'true' && t.email_verified !== true) return null;
  if (Number(t.exp) * 1000 < Date.now()) return null;
  return String(t.email).toLowerCase();
}

const authed = req => {
  if (GOOGLE_CLIENT_ID) return !!sessionEmail(req);
  if (!PASSWORD) return true;
  const a = Buffer.from(req.headers['x-trip-password'] || ''), b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const TABLES = { expenses: 'expenses', journal: 'journal' };

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const [kind, id] = parts;
  if (req.method === 'GET' && kind === 'config') return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null });
  if (req.method === 'POST' && kind === 'login') {
    if (!GOOGLE_CLIENT_ID) return send(res, 400, { error: 'google login not configured' });
    const { credential } = await readBody(req);
    const email = credential && await verifyGoogle(credential);
    if (!email) return send(res, 401, { error: 'invalid token' });
    if (!ALLOWED.includes(email)) return send(res, 403, { error: 'not allowed', email });
    res.setHeader('Set-Cookie', cookie(makeSession(email), SESSION_DAYS * 86400));
    return send(res, 200, { ok: true, email });
  }
  if (req.method === 'POST' && kind === 'logout') { res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true }); }
  if (!authed(req)) return send(res, 401, { error: 'unauthorized', google: !!GOOGLE_CLIENT_ID });
  if (req.method === 'GET' && kind === 'me') return send(res, 200, { email: GOOGLE_CLIENT_ID ? sessionEmail(req) : null });

  if (req.method === 'GET' && kind === 'state') {
    const [e, j, s] = await Promise.all([
      pool.query('SELECT data FROM expenses ORDER BY updated_at'),
      pool.query('SELECT data FROM journal ORDER BY updated_at'),
      pool.query('SELECT key, value FROM settings')]);
    const settings = Object.fromEntries(s.rows.map(r => [r.key, r.value]));
    return send(res, 200, { expenses: e.rows.map(r => r.data), journal: j.rows.map(r => r.data), rate: settings.rate ?? 0.052, seeded: !!settings.seeded });
  }
  if (TABLES[kind] && id) {
    const t = TABLES[kind];
    if (req.method === 'PUT') {
      const data = await readBody(req);
      if (!data || typeof data !== 'object') return send(res, 400, { error: 'bad body' });
      data.id = id;
      await pool.query(`INSERT INTO ${t} (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = now()`, [id, data]);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      const r = await pool.query(`DELETE FROM ${t} WHERE id = $1 RETURNING data->>'receiptId' AS rid`, [id]);
      if (r.rows[0]?.rid) await pool.query('DELETE FROM receipts WHERE id = $1', [r.rows[0].rid]);
      return send(res, 200, { ok: true });
    }
  }
  if (kind === 'receipts') {
    if (req.method === 'POST' && !id) {
      const { image, scan } = await readBody(req);
      const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(image || '');
      if (!m) return send(res, 400, { error: 'bad image' });
      const rid = 'r' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      await pool.query('INSERT INTO receipts (id, mime, image) VALUES ($1, $2, $3)', [rid, m[1], Buffer.from(m[2], 'base64')]);
      let extracted = null, scanError = null;
      if (scan) {
        if (!receipt.enabled()) scanError = 'disabled';
        else {
          try { extracted = await receipt.scanReceipt(image); }
          catch (e) { console.error('receipt scan failed', e); scanError = 'failed'; }
        }
      }
      return send(res, 200, { id: rid, extracted, scanError });
    }
    if (req.method === 'GET' && id) {
      const r = await pool.query('SELECT mime, image FROM receipts WHERE id = $1', [id]);
      if (!r.rows.length) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': r.rows[0].mime, 'Cache-Control': 'private, max-age=86400' });
      return res.end(r.rows[0].image);
    }
    if (req.method === 'DELETE' && id) { await pool.query('DELETE FROM receipts WHERE id = $1', [id]); return send(res, 200, { ok: true }); }
  }
  if (req.method === 'PUT' && kind === 'settings' && id) {
    const { value } = await readBody(req);
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [id, JSON.stringify(value)]);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && kind === 'import') {
    const d = await readBody(req);
    if (!Array.isArray(d.expenses) || !Array.isArray(d.journal)) return send(res, 400, { error: 'bad format' });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM expenses'); await c.query('DELETE FROM journal');
      for (const e of d.expenses) await c.query('INSERT INTO expenses (id, data) VALUES ($1, $2)', [e.id, e]);
      for (const j of d.journal) await c.query('INSERT INTO journal (id, data) VALUES ($1, $2)', [j.id, j]);
      await c.query("INSERT INTO settings (key, value) VALUES ('seeded', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'");
      if (d.rate > 0) await c.query("INSERT INTO settings (key, value) VALUES ('rate', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(d.rate)]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
  // With Google login on, everything except the login page needs a valid session.
  if (GOOGLE_CLIENT_ID && !PUBLIC_FILES.has(p) && !sessionEmail(req)) {
    if (p === '/index.html') { res.writeHead(302, { Location: '/login.html' }); return res.end(); }
    res.writeHead(401); return res.end('Unauthorized');
  }
  if (!GOOGLE_CLIENT_ID && p === '/login.html') { res.writeHead(302, { Location: '/' }); return res.end(); }
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    serveStatic(req, res, url);
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
});

init().then(() => server.listen(PORT, '0.0.0.0', () => console.log('listening on', PORT)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
