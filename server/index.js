// Servidor HTTP do Agenda Expert (sem dependências externas)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { db, seed } from './db.js';
import { getSessionUser, upsertUser, verifyPassword, COOKIE } from './auth.js';
import { matchRoute, HttpError } from './api.js';
import { startBackups } from './backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');
loadEnv(path.resolve(__dirname, '..', '.env'));
const PORT = Number(process.env.PORT || 5173);
const SECURE = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
// atrás de um proxy (Fly.io, Render…) o IP real vem em cabeçalhos
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production';
// identificador da versão publicada: muda sempre que um arquivo do app muda,
// e faz os aparelhos baixarem a atualização (service worker)
const BUILD_ID = buildId(PUBLIC);

seed();
syncUser();
startBackups();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; frame-ancestors 'none'",
  ...(SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Erro interno.' });
  }
});

async function handleApi(req, res, url) {
  const r = matchRoute(req.method, url.pathname);
  if (!r) return send(res, 404, { error: 'Rota não encontrada.' });
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE];
  const user = getSessionUser(token);
  if (r.auth && !user) return send(res, 401, { error: 'Sessão expirada. Entre novamente.' });

  // proteção CSRF básica: requisições de escrita precisam vir da mesma origem
  if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
    return send(res, 403, { error: 'Origem não permitida.' });

  let body = {};
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const raw = await readBody(req);
    if (raw) {
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'JSON inválido.' }); }
    }
  }
  const cookiesOut = [];
  const ctx = {
    params: r.params, query: Object.fromEntries(url.searchParams), body, user, token,
    ip: clientIp(req),
    setCookie: (name, value, maxAge) =>
      cookiesOut.push(`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`),
  };
  try {
    const result = await r.handler(ctx);
    if (cookiesOut.length) res.setHeader('Set-Cookie', cookiesOut);
    if (result && result.__raw != null) {
      res.writeHead(200, {
        ...SECURITY_HEADERS, 'Content-Type': result.__type, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${result.__filename}"`,
      });
      return res.end(result.__raw);
    }
    send(res, 200, result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
    throw e;
  }
}

function send(res, status, data) {
  const json = JSON.stringify(data);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/sw.js') {
    const js = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*'/, `const VERSION = 'ae-${BUILD_ID}'`);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
    return res.end(js);
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Proibido' });
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(PUBLIC, 'index.html');
    const ext = path.extname(target);
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // código do app sempre revalidado (atualizações chegam na hora); ícones podem ficar em cache
      'Cache-Control': ['.png', '.svg', '.ico', '.woff2'].includes(ext) ? 'public, max-age=86400' : 'no-cache',
      'Last-Modified': st?.mtime?.toUTCString?.() || new Date().toUTCString(),
    };
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && ['.html', '.js', '.css', '.svg', '.json', '.webmanifest'].includes(ext);
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    const stream = fs.createReadStream(target);
    (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('Body muito grande')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(h = '') {
  return Object.fromEntries(
    h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const h = req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket.remoteAddress;
}

function buildId(dir) {
  const h = crypto.createHash('sha1');
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name !== 'sw.js') h.update(f.name).update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 10);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// O acesso (e-mail e senha) vem das variáveis de ambiente ADMIN_EMAIL e ADMIN_PASSWORD.
// Para trocar, basta mudar as variáveis e reiniciar: as sessões abertas são encerradas.
function syncUser() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = String(process.env.ADMIN_PASSWORD || '');
  const prod = process.env.NODE_ENV === 'production';
  const fail = (msg) => {
    console.error(`
✖  ${msg}
`);
    if (prod) process.exit(1);
  };
  if (!email || !pw) return fail('Defina ADMIN_EMAIL e ADMIN_PASSWORD (arquivo .env ou variáveis do servidor).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.includes('coloque-o-email')) return fail('ADMIN_EMAIL inválido.');
  if (pw.length < 8 || pw.includes('coloque-a-senha')) return fail('ADMIN_PASSWORD precisa ter pelo menos 8 caracteres.');
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  if (!user) {
    upsertUser(email, pw, process.env.ADMIN_NAME);
    console.log(`✓ Acesso criado para ${email}`);
  } else if (user.email !== email || !verifyPassword(pw, user.password_hash) || (process.env.ADMIN_NAME && process.env.ADMIN_NAME !== user.name)) {
    upsertUser(email, pw, process.env.ADMIN_NAME);
    console.log(`✓ Acesso atualizado pelas variáveis de ambiente (${email}). Sessões anteriores encerradas.`);
  }
}

server.listen(PORT, () => console.log(`Agenda Expert rodando em http://localhost:${PORT} (versão ${BUILD_ID})`));

// encerramento limpo: grava o banco antes de desligar (deploys/reinícios)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
    process.exit(0);
  });
}
