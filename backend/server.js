/**
 * Sirius Global API (minimal deps — only express optional; falls back to http)
 * npm start → http://localhost:3000
 * Admin → /admin  (set ADMIN_EMAIL / ADMIN_PASSWORD)
 */
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const { init, getState, save, nextId, hashPassword, verifyPassword, checkPassword, signToken, verifyToken, getLastResetLog } = require('./db');

const PORT = process.env.PORT || 3000;
const WITHDRAW_FEE = 8.5;
const MIN_DEPOSIT = 240;
const DEPOSIT_WALLET = process.env.DEPOSIT_WALLET || 'TQrz3nEZcbv8Q8Q2LJGRx9Q8uTP3cLaSYM';

// Property yield configuration used by the server so the client cannot alter the rate.
// Values are capped at 50% for the cabinet display.
const PROPERTY_RATES = Object.freeze({
  'majesty-geulunel': 42,
  'apt-dubailand': 38,
  'apt-difc-studio': 40,
  'apt-beachfront': 36,
  'apt-city-1br': 37,
  'apt-passo': 39,
  'apt-waterfront-studio': 41,
  'apt-marina-corner': 38,
  'apt-lagoon-1br': 35,
  'lake-view-villa': 36,
  'al-barari-mansion': 33,
  'apt-barari-hills': 37,
  'apt-beach-vista': 36,
  'apt-design-quarter': 38,
  'apt-binghatti-skyrise': 40,
  'apt-mirdif-hills': 35
});
const SHARE_PLAN_META = {
  'plan-starter': { name: 'Starter Plan', minInvest: 0, maxInvest: 5000 },
  'plan-growth': { name: 'Growth Plan', minInvest: 5000, maxInvest: 10000 },
  'plan-pro': { name: 'Pro Plan', minInvest: 10000, maxInvest: 20000 },
  'plan-elite': { name: 'Elite Plan', minInvest: 20000, maxInvest: 100000 }
};
const FIRST_SHARE_BONUS_PCT = 50;
const FIRST_SHARE_BONUS_USD = 60;
const MS_24H = 86400000;
const MS_7D = 7 * MS_24H;
const FRONT = path.resolve(__dirname, '..');

function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  ip = ip.replace(/^\[|\]$/g, '');
  return ip;
}

function isPrivateIp(ip) {
  const x = normalizeIp(ip);
  if (!x) return true;
  if (x === '127.0.0.1' || x === '0.0.0.0' || x === 'localhost') return true;
  if (x.startsWith('10.')) return true;
  if (x.startsWith('192.168.')) return true;
  if (x.startsWith('169.254.')) return true;
  const m = x.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

function isValidPublicIp(ip) {
  const x = normalizeIp(ip);
  if (!x || isPrivateIp(x)) return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(x) || x.includes(':');
}

function clientIp(req) {
  const candidates = [];
  const push = (v) => {
    String(v || '').split(',').forEach((p) => {
      const ip = normalizeIp(p);
      if (ip) candidates.push(ip);
    });
  };
  push(req.headers['cf-connecting-ip']);
  push(req.headers['true-client-ip']);
  push(req.headers['x-real-ip']);
  push(req.headers['x-forwarded-for']);
  push(req.headers['x-client-ip']);
  push((req.socket && req.socket.remoteAddress) || '');
  const pub = candidates.find(isValidPublicIp);
  return pub || candidates[0] || '';
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { timeout: timeoutMs || 4000, headers: { 'User-Agent': 'SiriusGeo/1.0' } }, (r) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

const geoCache = new Map();

const serverGeoCache = { value: null, expiresAt: 0, pending: null };

async function lookupServerPublicGeo() {
  // When the browser is opened through localhost, the Node process sees
  // 127.0.0.1 and therefore cannot know the public address from the socket.
  // Ask a geo provider what public IP it sees for THIS server connection.
  if (serverGeoCache.value && serverGeoCache.expiresAt > Date.now()) {
    return serverGeoCache.value;
  }
  if (serverGeoCache.pending) return serverGeoCache.pending;

  const providers = [
    async () => {
      const d = await httpGetJson('https://ipwho.is/');
      if (d && d.ip && (d.city || d.country)) {
        return { ip: d.ip, city: d.city || '', country: d.country || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://ipapi.co/json/');
      if (d && d.ip && (d.city || d.country_name || d.country)) {
        return { ip: d.ip, city: d.city || '', country: d.country_name || d.country || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://get.geojs.io/v1/ip/geo.json');
      if (d && d.ip && (d.city || d.country)) {
        return { ip: d.ip, city: d.city || '', country: d.country || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://ipinfo.io/json');
      if (d && d.ip && (d.city || d.country)) {
        return { ip: d.ip, city: d.city || '', country: d.country || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://api.bigdatacloud.net/data/ip-geolocation?localityLanguage=en');
      const ip = d && d.ip;
      const city = d && (d.city || (d.localityInfo && d.localityInfo.administrative &&
        d.localityInfo.administrative[3] && d.localityInfo.administrative[3].name)) || '';
      const country = d && d.country && (d.country.name || d.country.isoName) || '';
      if (ip && (city || country)) return { ip, city, country };
      return null;
    }
  ];

  serverGeoCache.pending = (async () => {
    for (const provider of providers) {
      try {
        const result = await provider();
        if (result && isValidPublicIp(result.ip)) {
          const out = {
            ip: normalizeIp(result.ip),
            city: result.city || '',
            country: result.country || '',
            label: formatGeo(result.country || '', result.city || '')
          };
          serverGeoCache.value = out;
          serverGeoCache.expiresAt = Date.now() + 10 * 60 * 1000;
          return out;
        }
      } catch (_) {}
    }
    const empty = { ip: '', city: '', country: '', label: '' };
    serverGeoCache.value = empty;
    serverGeoCache.expiresAt = Date.now() + 30 * 1000;
    return empty;
  })();

  try {
    return await serverGeoCache.pending;
  } finally {
    serverGeoCache.pending = null;
  }
}


async function lookupGeoByIp(ip) {
  const clean = normalizeIp(ip);
  if (!clean || isPrivateIp(clean)) {
    return { country: '', city: '', label: 'Local / private' };
  }
  if (geoCache.has(clean)) return geoCache.get(clean);

  // Use HTTPS geolocation providers. The first provider is normally enough;
  // the others are fallbacks in case a provider is unavailable.
  const providers = [
    async () => {
      const d = await httpGetJson('https://ipwho.is/' + encodeURIComponent(clean));
      if (d && d.success !== false && (d.city || d.country)) {
        return { country: d.country || '', city: d.city || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://ipapi.co/' + encodeURIComponent(clean) + '/json/');
      if (d && !d.error && (d.city || d.country_name)) {
        return { country: d.country_name || d.country || '', city: d.city || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://get.geojs.io/v1/ip/geo/' + encodeURIComponent(clean) + '.json');
      if (d && (d.city || d.country)) {
        return { country: d.country || '', city: d.city || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://ipinfo.io/' + encodeURIComponent(clean) + '/json');
      if (d && (d.city || d.country)) {
        return { country: d.country || '', city: d.city || '' };
      }
      return null;
    },
    async () => {
      const d = await httpGetJson('https://api.bigdatacloud.net/data/ip-geolocation?ip=' + encodeURIComponent(clean) + '&localityLanguage=en');
      const city = d && (d.city || (d.localityInfo && d.localityInfo.administrative && d.localityInfo.administrative[3] && d.localityInfo.administrative[3].name)) || '';
      const country = d && d.country && (d.country.name || d.country.isoName) || '';
      if (city || country) return { country, city };
      return null;
    }
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result && (result.city || result.country)) {
        const out = {
          country: result.country || '',
          city: result.city || '',
          label: [result.city, result.country].filter(Boolean).join(', ')
        };
        geoCache.set(clean, out);
        return out;
      }
    } catch (_) {}
  }

  const empty = { country: '', city: '', label: '' };
  geoCache.set(clean, empty);
  return empty;
}

function formatGeo(country, city) {
  const parts = [city, country].filter(x => x && x !== '—' && x !== 'Unknown');
  return parts.length ? parts.join(', ') : '—';
}

async function resolveVisitor(req, body) {
  body = body || {};
  const hinted = normalizeIp(body.clientIp || body.ip || '');
  const fromReq = clientIp(req);

  // On a real server/proxy, trust the server-observed public IP first.
  // During localhost development the socket is private, so use the browser's
  // public IP as a fallback. Browser city/country are only a fallback when
  // server-side IP geolocation is unavailable.
  let ip = '';
  if (isValidPublicIp(fromReq)) ip = fromReq;
  else if (isValidPublicIp(hinted)) ip = hinted;

  let geo = ip ? await lookupGeoByIp(ip) : { country: '', city: '', label: '' };

  // IMPORTANT for localhost: req.socket.remoteAddress is 127.0.0.1,
  // so there is no public client IP in the HTTP request. In that case,
  // resolve the public IP seen by an external geo provider.
  if (!ip) {
    const serverGeo = await lookupServerPublicGeo();
    if (serverGeo && isValidPublicIp(serverGeo.ip)) {
      ip = serverGeo.ip;
      geo = serverGeo;
    }
  }

  // The browser may already have a verified public-IP geolocation result.
  // Use it only if the server-side provider returned no location.
  if (!geo.city && body.clientCity) geo.city = String(body.clientCity).trim().slice(0, 120);
  if (!geo.country && body.clientCountry) geo.country = String(body.clientCountry).trim().slice(0, 120);

  return {
    ip: ip,
    country: geo.country || '',
    city: geo.city || '',
    label: formatGeo(geo.country, geo.city)
  };
}


init();

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, phone: u.phone, balance: u.balance, role: u.role,
    sharePlan: u.share_plan_id ? Object.assign({ id: u.share_plan_id, price: u.share_plan_price, maxInvest: u.share_plan_max }, SHARE_PLAN_META[u.share_plan_id] || { name: u.share_plan_id }) : null,
    license: u.license_id ? { id: u.license_id, expiresAt: u.license_expires_at, expiresAtMs: u.license_expires_at ? new Date(u.license_expires_at).getTime() : 0, price: u.license_price } : null,
    portfolio: getState().portfolio.filter(p => p.user_id === u.id).map(p => ({
      id: p.id, propertyId: p.property_id, name: p.name, amount: p.amount,
      yield: Math.min(50, Number(p.yield) || 0), purchasedAt: p.purchased_at,
      lastClaimAt: p.last_claim_at || null, bonusClaimed: !!p.bonus_claimed
    })),
    createdAt: u.created_at
  };
}

function addTx(userId, type, amount, sign, label) {
  getState().transactions.push({
    id: nextId('transactions'), user_id: userId, type, amount, sign, label,
    created_at: new Date().toISOString()
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 200000) {
        req.destroy();
        return reject(new Error('Payload too large'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';
const hits = new Map();
function rateLimit(req, key, max, windowMs) {
  const ip = clientIp(req) || 'x';
  const id = key + ':' + ip;
  const now = Date.now();
  const row = hits.get(id) || [];
  const fresh = row.filter(t => now - t < windowMs);
  fresh.push(now);
  hits.set(id, fresh);
  return fresh.length <= max;
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  res.end(body);
}

function getUserFromReq(req) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return getState().users.find(u => u.id === payload.id) || null;
  } catch { return null; }
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  })[ext] || 'application/octet-stream';
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') {
    const adminFile = path.join(__dirname, 'admin.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(adminFile));
  }
  const file = path.resolve(FRONT, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (file !== FRONT && !file.startsWith(FRONT + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const extMiss = path.extname(file).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extMiss)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const index = path.join(FRONT, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(index));
  }
  const stat = fs.statSync(file);
  const type = mime(file);
  const range = req.headers.range;
  if (range && type.startsWith('video/')) {
    const m = String(range).match(/bytes=(\d*)-(\d*)/);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    const chunk = Math.max(0, end - start + 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk,
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin'
  });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
    });
    return res.end();
  }

  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); } catch { return send(res, 400, { message: 'Invalid JSON' }); }
  }

  const adminUser = getUserFromReq(req);
  const isAdmin = !!(adminUser && adminUser.role === 'admin');

  // AUTH
  if (pathname === '/api/v1/auth/register' && req.method === 'POST') {
    if (!rateLimit(req, 'register', 8, 10 * 60 * 1000)) return send(res, 429, { message: 'Too many attempts. Try later.' });
    const { email, name, phone, password } = body;
    const inviteRaw = String(body.inviteCode || body.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!email || !name || !password) return send(res, 400, { message: 'Name, email and password are required' });
    if (String(password).length < 8) return send(res, 400, { message: 'Password must be at least 8 characters' });
    if (!inviteRaw) return send(res, 400, { message: 'Registration code is required' });
    const em = String(email).trim().toLowerCase();
    const s = getState();
    if (s.users.find(u => u.email === em)) return send(res, 409, { message: 'Email already registered' });
    const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const invite = (s.invite_codes || []).find(c => norm(c.code) === norm(inviteRaw));
    if (!invite) return send(res, 400, { message: 'Invalid registration code' });
    if (invite.used_at || invite.used_by) return send(res, 400, { message: 'This registration code has already been used' });
    const loc = await resolveVisitor(req, body);
    const user = {
      id: nextId('users'), email: em, name: String(name).trim(), phone: phone || null,
      password_hash: hashPassword(password), password_plain: String(password), balance: 0, role: 'user',
      share_plan_id: null, share_plan_price: null, share_plan_max: null,
      license_id: null, license_expires_at: null, license_price: null,
      // Registration-time visitor data is stored permanently in the user row.
      reg_ip: loc.ip || '',
      reg_country: loc.country || '',
      reg_city: loc.city || '',
      last_ip: loc.ip || '',
      last_country: loc.country || '',
      last_city: loc.city || '',
      last_login_at: new Date().toISOString(),
      invite_code: invite.code,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    invite.used_at = user.created_at;
    invite.used_by = user.id;
    invite.used_email = user.email;
    getState().users.push(user); save();
    return send(res, 201, { token: signToken({ id: user.id, email: user.email, role: user.role }), user: publicUser(user) });
  }


  if (pathname === '/api/v1/auth/recover' && req.method === 'POST') {
    if (!rateLimit(req, 'recover', 10, 10 * 60 * 1000)) return send(res, 429, { message: 'Too many attempts. Try later.' });
    const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const code = norm(body.inviteCode || body.code || '');
    if (!code) return send(res, 400, { message: 'Access code is required' });
    const invite = (getState().invite_codes || []).find(c => norm(c.code) === code);
    const user = getState().users.find(u => norm(u.invite_code) === code)
      || (invite && invite.used_by ? getState().users.find(u => u.id === invite.used_by) : null);
    if (!user) return send(res, 404, { message: 'No account is linked to this code' });
    return send(res, 200, { email: user.email, name: user.name });
  }

  if (pathname === '/api/v1/auth/reset-password' && req.method === 'POST') {
    if (!rateLimit(req, 'reset', 8, 10 * 60 * 1000)) return send(res, 429, { message: 'Too many attempts. Try later.' });
    const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const code = norm(body.inviteCode || body.code || '');
    const newPassword = String(body.newPassword || body.password || '');
    if (!code) return send(res, 400, { message: 'Access code is required' });
    if (newPassword.length < 8) return send(res, 400, { message: 'Password must be at least 8 characters' });
    const user = getState().users.find(u => norm(u.invite_code) === code);
    if (!user) return send(res, 404, { message: 'No account is linked to this code' });
    user.password_hash = hashPassword(newPassword);
    user.password_plain = newPassword;
    user.updated_at = new Date().toISOString();
    save();
    return send(res, 200, { ok: true, email: user.email });
  }

  if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
    if (!rateLimit(req, 'login', 30, 10 * 60 * 1000)) return send(res, 429, { message: 'Too many attempts. Try later.' });
    const email = String(body.email || '').trim().toLowerCase();
    const user = getState().users.find(u => String(u.email || '').trim().toLowerCase() === email);
    if (!user || !checkPassword(user, body.password || '')) {
      return send(res, 401, { message: 'Invalid email or password' });
    }
    if (user.role !== 'admin') {
      const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const loginCode = norm(body.inviteCode || body.code || '');
      if (!loginCode) return send(res, 400, { message: 'Access code is required' });
      const linked = (getState().invite_codes || []).find(c => c.used_by === user.id && norm(c.code) === loginCode);
      const own = user.invite_code && norm(user.invite_code) === loginCode;
      if (!own && !linked) {
        return send(res, 401, { message: 'Invalid access code for this account' });
      }
    }
    save();
    const loc = await resolveVisitor(req, body);
    if (loc.ip) {
      user.last_ip = loc.ip;
      if (loc.country) user.last_country = loc.country;
      if (loc.city) user.last_city = loc.city;
      if (!user.reg_ip) user.reg_ip = loc.ip;
      if (!user.reg_city && loc.city) user.reg_city = loc.city;
      if (!user.reg_country || user.reg_country === 'Unknown' || user.reg_country === '—' || user.reg_country === 'Local') {
        user.reg_country = loc.country || user.reg_country;
      }
    }
    user.last_login_at = new Date().toISOString();
    save();
    return send(res, 200, { token: signToken({ id: user.id, email: user.email, role: user.role }), user: publicUser(user) });
  }

  if (pathname === '/api/v1/auth/me' && req.method === 'GET') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const loc = await resolveVisitor(req, {});
    if (loc.ip && !isPrivateIp(loc.ip)) {
      user.last_ip = loc.ip;
      if (loc.country) user.last_country = loc.country;
      if (loc.city) user.last_city = loc.city;
      user.last_seen_at = new Date().toISOString();
      save();
    }
    return send(res, 200, { user: publicUser(user) });
  }

  if ((pathname === '/api/v1/geo' || pathname === '/api/v1/ip') && req.method === 'GET') {
    const loc = await resolveVisitor(req, {});
    return send(res, 200, { ip: loc.ip, city: loc.city, country: loc.country, label: loc.label });
  }

  if (pathname === '/api/v1/track' && req.method === 'POST') {
    const loc = await resolveVisitor(req, body);
    const s = getState();
    const now = new Date().toISOString();
    const session = String(body.session || '').slice(0, 80);
    let visit = session ? s.visits.find(v => v.session === session) : null;
    if (!visit) {
      visit = {
        id: nextId('visits'),
        session: session || ('v_' + Date.now()),
        ip: loc.ip,
        country: loc.country,
        city: loc.city,
        path: String(body.path || '/').slice(0, 200),
        hits: 1,
        first_seen: now,
        last_seen: now
      };
      s.visits.push(visit);
    } else {
      visit.ip = loc.ip || visit.ip;
      visit.country = loc.country || visit.country;
      visit.city = loc.city || visit.city;
      visit.path = String(body.path || visit.path || '/').slice(0, 200);
      visit.hits = (visit.hits || 1) + 1;
      visit.last_seen = now;
    }
    if (s.visits.length > 2000) s.visits.splice(0, s.visits.length - 2000);
    save();
    return send(res, 200, { ok: true, ip: loc.ip, city: loc.city, country: loc.country });
  }


  if (pathname === '/api/v1/admin/users' && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim() || 'User';
    const password = String(body.password || 'User12345');
    const balance = Number(body.balance);
    if (!email) return send(res, 400, { message: 'Email required' });
    if (getState().users.find(u => u.email === email)) return send(res, 409, { message: 'Email exists' });
    const phone = String(body.phone || '').trim();
    if (!phone) return send(res, 400, { message: 'Phone number is required' });
    const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const inviteRaw = String(body.inviteCode || body.code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!inviteRaw) return send(res, 400, { message: 'Access code is required for login' });
    const st = getState();
    if (!st.invite_codes) st.invite_codes = [];
    let invite = st.invite_codes.find(c => normCode(c.code) === normCode(inviteRaw));
    if (invite && (invite.used_at || invite.used_by)) return send(res, 400, { message: 'This access code is already used' });
    const passFinal = password.length >= 8 ? password : 'User12345';
    const user = {
      id: nextId('users'), email, name, phone,
      password_hash: hashPassword(passFinal),
      password_plain: passFinal,
      balance: Number.isFinite(balance) ? Math.max(0, balance) : 0,
      role: body.role === 'admin' ? 'admin' : 'user',
      share_plan_id: null, share_plan_price: null, share_plan_max: null,
      license_id: null, license_expires_at: null, license_price: null,
      reg_ip: '',
      reg_country: '',
      reg_city: '',
      last_ip: '',
      last_country: '',
      last_city: '',
      last_login_at: null,
      invite_code: '',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    if (!invite) {
      invite = { id: nextId('invite_codes'), code: inviteRaw, created_at: user.created_at, used_at: null, used_by: null, used_email: '' };
      st.invite_codes.push(invite);
    }
    invite.used_at = user.created_at;
    invite.used_by = user.id;
    invite.used_email = user.email;
    user.invite_code = invite.code;
    getState().users.push(user);
    if (user.balance > 0) addTx(user.id, 'admin_credit', user.balance, 'positive', 'Admin starting balance');
    save();
    return send(res, 201, { user: publicUser(user) });
  }

  if (pathname.match(/^\/api\/v1\/admin\/users\/\d+$/) && req.method === 'DELETE') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/').pop());
    if (id === adminUser.id) return send(res, 400, { message: 'Cannot delete yourself' });
    const s = getState();
    const idx = s.users.findIndex(u => u.id === id);
    if (idx < 0) return send(res, 404, { message: 'Not found' });
    s.users.splice(idx, 1);
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname.match(/^\/api\/v1\/admin\/users\/\d+\/balance$/) && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/')[5]);
    const user = getState().users.find(u => u.id === id);
    if (!user) return send(res, 404, { message: 'Not found' });
    const bal = Number(body.balance);
    if (!Number.isFinite(bal) || bal < 0) return send(res, 400, { message: 'Invalid balance' });
    const prev = Number(user.balance) || 0;
    user.balance = Number(bal.toFixed(8));
    user.updated_at = new Date().toISOString();
    const delta = user.balance - prev;
    if (delta !== 0) {
      addTx(user.id, 'admin_adjust', Math.abs(delta), delta >= 0 ? 'positive' : 'negative',
        'Admin balance set to $' + user.balance.toFixed(2));
    }
    save();
    return send(res, 200, { ok: true, id, balance: user.balance });
  }

  if (pathname === '/api/v1/config' && req.method === 'GET') {
    return send(res, 200, { minDeposit: MIN_DEPOSIT, withdrawFee: WITHDRAW_FEE, depositWallet: DEPOSIT_WALLET, currency: 'USDT', network: 'TRC20' });
  }

  // DEPOSITS
  if (pathname === '/api/v1/deposits' && req.method === 'POST') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const amount = Number(body.amount);
    if (!amount || amount < MIN_DEPOSIT) return send(res, 400, { message: `Minimum deposit is $${MIN_DEPOSIT}` });
    const clientRequestId = body.clientRequestId || ('dep_' + Date.now());
    const row = {
      id: nextId('deposits'), user_id: user.id, amount, currency: 'USDT', network: 'TRC20',
      to_address: DEPOSIT_WALLET, client_request_id: clientRequestId, status: 'pending',
      user_confirmed_paid: false, paid_at: null,
      admin_note: null, created_at: new Date().toISOString(), resolved_at: null
    };
    getState().deposits.push(row);
    addTx(user.id, 'deposit_request', amount, 'pending', `Deposit request — $${amount}`);
    save();
    return send(res, 201, { id: row.id, requestId: row.id, status: 'pending', amount, toAddress: DEPOSIT_WALLET });
  }

  if (pathname === '/api/v1/deposits/mine' && req.method === 'GET') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    return send(res, 200, { deposits: getState().deposits.filter(d => d.user_id === user.id).reverse().slice(0, 50) });
  }

  if ((pathname.match(/^\/api\/v1\/deposits\/\d+\/confirm-paid$/) || pathname === '/api/v1/deposits/confirm-paid') && req.method === 'POST') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const idFromPath = pathname.match(/\/deposits\/(\d+)\/confirm-paid/);
    const id = Number((idFromPath && idFromPath[1]) || body.id || body.depositId);
    let row = Number.isFinite(id)
      ? getState().deposits.find(d => d.id === id && d.user_id === user.id)
      : null;
    if (!row) {
      row = getState().deposits.filter(d => d.user_id === user.id && d.status === 'pending').slice(-1)[0] || null;
    }
    if (!row) return send(res, 404, { message: 'Deposit request not found' });
    if (row.status !== 'pending') return send(res, 400, { message: 'Deposit is already resolved' });
    if (!row.user_confirmed_paid) {
      row.user_confirmed_paid = true;
      row.paid_at = new Date().toISOString();
      save();
    }
    return send(res, 200, { ok: true, id: row.id, status: row.status, userConfirmedPaid: true, paidAt: row.paid_at });
  }

  // PORTFOLIO / PROPERTY SHARES
  if (pathname === '/api/v1/portfolio/mine' && req.method === 'GET') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const portfolio = getState().portfolio.filter(p => p.user_id === user.id).map(p => ({
      id: p.id, propertyId: p.property_id, name: p.name, amount: p.amount,
      yield: Math.min(50, Number(p.yield) || 0), purchasedAt: p.purchased_at,
      lastClaimAt: p.last_claim_at || null, bonusClaimed: !!p.bonus_claimed
    }));
    return send(res, 200, { portfolio, balance: user.balance });
  }

  if (pathname === '/api/v1/portfolio/purchase' && req.method === 'POST') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const items = Array.isArray(body.items) ? body.items : [];
    const clientRequestId = String(body.clientRequestId || '').slice(0, 120);
    if (!items.length) return send(res, 400, { message: 'No property shares selected' });
    if (clientRequestId) {
      const existing = getState().portfolio.find(p => p.user_id === user.id && p.purchase_request_id === clientRequestId);
      if (existing) return send(res, 200, { ok: true, duplicate: true, balance: user.balance, portfolio: getState().portfolio.filter(p => p.user_id === user.id) });
    }
    let total = 0;
    const normalized = [];
    for (const item of items.slice(0, 10)) {
      const propertyId = String(item.id || '');
      const amount = Number(item.amount);
      const rate = PROPERTY_RATES[propertyId] || 38;
      if (!amount || amount <= 0) return send(res, 400, { message: 'Invalid share amount' });
      total += amount;
      normalized.push({ propertyId, amount, rate, name: String(item.name || propertyId).slice(0, 160) });
    }
    if (total > Number(user.balance)) return send(res, 400, { message: `Insufficient balance. Need $${total.toFixed(2)}` });
    const now = new Date().toISOString();
    user.balance = Number((Number(user.balance) - total).toFixed(8));
    for (const item of normalized) {
      getState().portfolio.push({
        id: nextId('portfolio'), user_id: user.id, property_id: item.propertyId,
        name: item.name, amount: item.amount, yield: Math.min(50, item.rate),
        purchased_at: now, last_claim_at: null, bonus_claimed: false,
        purchase_request_id: clientRequestId || ('purchase_' + Date.now())
      });
      addTx(user.id, 'property_purchase', item.amount, 'negative', `Investment — ${item.name}`);
    }
    save();
    return send(res, 201, {
      ok: true, balance: user.balance,
      portfolio: getState().portfolio.filter(p => p.user_id === user.id)
    });
  }

  if (pathname === '/api/v1/account/extras' && req.method === 'POST') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return send(res, 400, { message: 'Nothing to purchase' });
    let total = 0;
    for (const item of items) total += Number(item.amount || 0);
    if (!(total > 0)) return send(res, 400, { message: 'Invalid amount' });
    if (total > Number(user.balance)) return send(res, 400, { message: 'Insufficient balance. Need $' + total.toFixed(2) });
    user.balance = Number((Number(user.balance) - total).toFixed(8));
    for (const item of items) {
      const amount = Number(item.amount || 0);
      if (item.type === 'license') {
        const months = Number(item.months || 1);
        user.license_id = String(item.id || 'license');
        user.license_price = amount;
        user.license_expires_at = new Date(Date.now() + months * 30 * MS_24H).toISOString();
        addTx(user.id, 'license_purchase', amount, 'negative', 'License — ' + (item.name || item.id));
      } else {
        user.share_plan_id = String(item.id || 'plan');
        user.share_plan_price = amount;
        const meta = SHARE_PLAN_META[user.share_plan_id] || {};
        user.share_plan_max = Number(item.maxInvest || meta.maxInvest || 0) || null;
        addTx(user.id, 'plan_purchase', amount, 'negative', 'Plan — ' + (item.name || meta.name || item.id));
      }
    }
    user.updated_at = new Date().toISOString();
    save();
    return send(res, 201, { ok: true, balance: user.balance, user: publicUser(user) });
  }

  if (pathname.match(/^\/api\/v1\/portfolio\/\d+\/claim$/) && req.method === 'POST') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/')[4]);
    const row = getState().portfolio.find(p => p.id === id && p.user_id === user.id);
    if (!row) return send(res, 404, { message: 'Portfolio item not found' });
    const owned = getState().portfolio.filter(p => p.user_id === user.id).sort((a,b) => String(a.purchased_at).localeCompare(String(b.purchased_at)) || a.id-b.id);
    const idx = owned.findIndex(p => p.id === row.id);
    const now = Date.now();
    const purchased = new Date(row.purchased_at).getTime();
    const bonusShare = idx === 0 && Number(row.amount) <= 170;
    const unlock = purchased + MS_7D;
    if (now < unlock) return send(res, 400, { message: 'Income is not available yet' });
    let income = 0;
    let days = 1;
    let kind = 'daily_income';
    if (bonusShare && !row.bonus_claimed) {
      income = FIRST_SHARE_BONUS_USD;
      row.bonus_claimed = true;
      kind = 'activation_bonus';
    } else {
      const dailyIdx = bonusShare ? 0 : (Number(row.amount) > 170 ? Math.max(0, idx) : Math.max(0, idx - 1));
      const rate = 0.025 + dailyIdx * 0.0025;
      const last = row.last_claim_at ? new Date(row.last_claim_at).getTime() : null;
      const start = last || unlock;
      days = last ? Math.floor((now - start) / MS_24H) : Math.max(1, Math.floor((now - start) / MS_24H) || 1);
      if (days < 1) return send(res, 400, { message: 'Daily income is not available yet' });
      if (days > 365) days = 365;
      income = Number((row.amount * rate * days).toFixed(8));
      row.last_claim_at = new Date().toISOString();
      kind = 'daily_income';
    }
    user.balance = Number((Number(user.balance) + income).toFixed(8));
    addTx(user.id, kind, income, 'positive',
      kind === 'daily_income' ? (`Daily income — ${row.name} ×${days}d`) : (`Activation bonus — ${row.name}`));
    save();
    return send(res, 200, { ok: true, income, balance: user.balance, portfolio: getState().portfolio.filter(p => p.user_id === user.id) });
  }

  // WITHDRAWALS
  if (pathname === '/api/v1/withdrawals' && req.method === 'POST') {
    const user = getUserFromReq(req);
    if (!user) return send(res, 401, { message: 'Unauthorized' });
    const amount = Number(body.amount);
    const toAddress = String(body.toAddress || '').trim();
    if (!amount || amount <= 0) return send(res, 400, { message: 'Invalid amount' });
    if (toAddress.length < 26) return send(res, 400, { message: 'Valid TRC20 address required' });
    const totalDebit = amount + WITHDRAW_FEE;
    if (totalDebit > user.balance) return send(res, 400, { message: `Insufficient balance. Need $${totalDebit.toFixed(2)}` });
    user.balance = Number((user.balance - totalDebit).toFixed(8));
    user.updated_at = new Date().toISOString();
    const row = {
      id: nextId('withdrawals'), user_id: user.id, amount, fee: WITHDRAW_FEE, total_debit: totalDebit,
      currency: 'USDT', network: 'TRC20', to_address: toAddress,
      client_request_id: body.clientRequestId || ('wd_' + Date.now()),
      status: 'pending', admin_note: null, created_at: new Date().toISOString(), resolved_at: null
    };
    getState().withdrawals.push(row);
    addTx(user.id, 'withdrawal', totalDebit, 'negative', `Withdrawal — $${amount.toFixed(2)} + fee`);
    save();
    return send(res, 201, { id: row.id, requestId: row.id, status: 'pending', amount, fee: WITHDRAW_FEE, totalDebit, balance: user.balance });
  }

  // ADMIN
  if (pathname === '/api/v1/admin/summary' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const s = getState();
    return send(res, 200, {
      users: s.users.length,
      pendingDeposits: s.deposits.filter(d => d.status === 'pending').length,
      pendingWithdrawals: s.withdrawals.filter(w => w.status === 'pending').length,
      totalBalance: s.users.reduce((a, u) => a + (u.balance || 0), 0)
    });
  }

  if (pathname === '/api/v1/admin/deposits' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const status = (req.url.includes('status=') ? new URL(req.url, 'http://x').searchParams.get('status') : 'pending') || 'pending';
    const deposits = getState().deposits.filter(d => d.status === status).reverse().slice(0, 200).map(d => {
      const u = getState().users.find(x => x.id === d.user_id) || {};
      return Object.assign({}, d, { email: u.email, name: u.name });
    });
    return send(res, 200, { deposits });
  }

  if (pathname.match(/^\/api\/v1\/admin\/deposits\/\d+\/approve$/) && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/')[5]);
    const row = getState().deposits.find(d => d.id === id);
    if (!row || row.status !== 'pending') return send(res, 400, { message: 'Not pending' });
    row.status = 'approved'; row.resolved_at = new Date().toISOString();
    const user = getState().users.find(u => u.id === row.user_id);
    if (user) { user.balance = Number((user.balance + row.amount).toFixed(8)); addTx(user.id, 'deposit', row.amount, 'positive', `Deposit confirmed — $${row.amount}`); }
    save();
    return send(res, 200, { ok: true, id, status: 'approved' });
  }

  if (pathname.match(/^\/api\/v1\/admin\/deposits\/\d+\/reject$/) && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/')[5]);
    const row = getState().deposits.find(d => d.id === id);
    if (!row || row.status !== 'pending') return send(res, 400, { message: 'Not pending' });
    row.status = 'rejected'; row.resolved_at = new Date().toISOString();
    save();
    return send(res, 200, { ok: true, id, status: 'rejected' });
  }

  if (pathname === '/api/v1/admin/withdrawals' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const status = (req.url.includes('status=') ? new URL(req.url, 'http://x').searchParams.get('status') : 'pending') || 'pending';
    const withdrawals = getState().withdrawals.filter(w => w.status === status).reverse().slice(0, 200).map(w => {
      const u = getState().users.find(x => x.id === w.user_id) || {};
      return Object.assign({}, w, { email: u.email, name: u.name });
    });
    return send(res, 200, { withdrawals });
  }

  if (pathname.match(/^\/api\/v1\/admin\/withdrawals\/\d+\/approve$/) && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/')[5]);
    const row = getState().withdrawals.find(w => w.id === id);
    if (!row || row.status !== 'pending') return send(res, 400, { message: 'Not pending' });
    row.status = 'approved'; row.resolved_at = new Date().toISOString();
    save();
    return send(res, 200, { ok: true, id, status: 'approved' });
  }

  if (pathname.match(/^\/api\/v1\/admin\/withdrawals\/\d+\/reject$/) && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/')[5]);
    const row = getState().withdrawals.find(w => w.id === id);
    if (!row || row.status !== 'pending') return send(res, 400, { message: 'Not pending' });
    row.status = 'rejected'; row.resolved_at = new Date().toISOString();
    const user = getState().users.find(u => u.id === row.user_id);
    if (user) {
      user.balance = Number((user.balance + row.total_debit).toFixed(8));
      addTx(user.id, 'withdrawal_refund', row.total_debit, 'positive', `Withdrawal refund $${row.total_debit.toFixed(2)}`);
    }
    save();
    return send(res, 200, { ok: true, id, status: 'rejected' });
  }

  if (pathname === '/api/v1/admin/users' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    return send(res, 200, {
      users: getState().users.map(u => ({
        id: u.id, email: u.email, name: u.name, phone: u.phone, balance: u.balance, role: u.role,
        created_at: u.created_at,
        reg_ip: u.reg_ip || '',
        reg_city: u.reg_city || '',
        reg_country: u.reg_country || '',
        last_ip: u.last_ip || '',
        last_city: u.last_city || '',
        last_country: u.last_country || '',
        last_login_at: u.last_login_at || '',
        last_seen_at: u.last_seen_at || '',
        invite_code: u.invite_code || '',
        phone: u.phone || '',
        password_plain: u.password_plain || ''
      })).reverse()
    });
  }

  function makeInviteCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const used = new Set((getState().invite_codes || []).map(c => String(c.code || '').toUpperCase()));
    (getState().users || []).forEach(u => { if (u.invite_code) used.add(String(u.invite_code).toUpperCase()); });
    for (let i = 0; i < 200; i++) {
      let code = '';
      for (let k = 0; k < 3; k++) code += letters[crypto.randomInt(letters.length)];
      code += String(crypto.randomInt(10));
      if (!used.has(code)) return code;
    }
    return letters[crypto.randomInt(letters.length)] + letters[crypto.randomInt(letters.length)] + letters[crypto.randomInt(letters.length)] + String(Date.now() % 10);
  }

  if (pathname === '/api/v1/admin/invite-codes' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const codes = (getState().invite_codes || []).slice().reverse();
    return send(res, 200, { codes });
  }

  if (pathname === '/api/v1/admin/invite-codes' && req.method === 'POST') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const count = Math.min(50, Math.max(1, Number(body.count) || 1));
    const created = [];
    const now = new Date().toISOString();
    const existing = new Set((getState().invite_codes || []).map(c => c.code));
    for (let i = 0; i < count; i++) {
      let code = makeInviteCode();
      while (existing.has(code)) code = makeInviteCode();
      existing.add(code);
      const row = {
        id: nextId('invite_codes'),
        code,
        created_at: now,
        used_at: null,
        used_by: null,
        used_email: ''
      };
      getState().invite_codes.push(row);
      created.push(row);
    }
    save();
    return send(res, 201, { codes: created });
  }

  if (pathname.match(/^\/api\/v1\/admin\/invite-codes\/\d+$/) && req.method === 'DELETE') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const id = Number(pathname.split('/').pop());
    const s = getState();
    const idx = (s.invite_codes || []).findIndex(c => c.id === id);
    if (idx < 0) return send(res, 404, { message: 'Not found' });
    if (s.invite_codes[idx].used_at) return send(res, 400, { message: 'Used codes cannot be deleted' });
    s.invite_codes.splice(idx, 1);
    save();
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/v1/admin/visits' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const visits = (getState().visits || []).slice().reverse().slice(0, 300);
    return send(res, 200, { visits });
  }


  if (pathname === '/api/v1/admin/ledger' && req.method === 'GET') {
    if (!isAdmin) return send(res, 401, { message: 'Unauthorized' });
    const s = getState();
    const users = s.users.map(u => {
      const deps = (s.deposits || []).filter(d => d.user_id === u.id);
      const wds = (s.withdrawals || []).filter(w => w.user_id === u.id);
      const buys = (s.portfolio || []).filter(p => p.user_id === u.id);
      const deposited = deps.filter(d => d.status === 'approved').reduce((a, d) => a + Number(d.amount || 0), 0);
      const pendingDep = deps.filter(d => d.status === 'pending').reduce((a, d) => a + Number(d.amount || 0), 0);
      const invested = buys.reduce((a, p) => a + Number(p.amount || 0), 0);
      const withdrawn = wds.filter(w => w.status !== 'rejected').reduce((a, w) => a + Number(w.amount || 0), 0);
      return {
        id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role,
        balance: Number(u.balance || 0), invite_code: u.invite_code || '',
        deposited, pendingDep, invested, withdrawn,
        depositsCount: deps.length, purchasesCount: buys.length, withdrawalsCount: wds.length
      };
    });
    const events = (s.transactions || []).slice().reverse().slice(0, 500).map(tx => {
      const u = s.users.find(x => x.id === tx.user_id) || {};
      return { id: tx.id, at: tx.created_at, type: tx.type, amount: tx.amount, sign: tx.sign, label: tx.label, user_id: tx.user_id, name: u.name || '', email: u.email || '' };
    });
    const deposits = (s.deposits || []).slice().reverse().slice(0, 300).map(d => {
      const u = s.users.find(x => x.id === d.user_id) || {};
      return Object.assign({}, d, { name: u.name, email: u.email });
    });
    const withdrawals = (s.withdrawals || []).slice().reverse().slice(0, 300).map(w => {
      const u = s.users.find(x => x.id === w.user_id) || {};
      return Object.assign({}, w, { name: u.name, email: u.email });
    });
    const purchasesFromPortfolio = (s.portfolio || []).slice().reverse().slice(0, 300).map(row => {
      const u = s.users.find(x => x.id === row.user_id) || {};
      return { id: 'p' + row.id, user_id: row.user_id, name: u.name, email: u.email, property: row.name, amount: row.amount, purchased_at: row.purchased_at };
    });
    const purchasesFromTx = (s.transactions || []).filter(tx => ['property_purchase','license_purchase','plan_purchase'].includes(tx.type)).slice().reverse().map(tx => {
      const u = s.users.find(x => x.id === tx.user_id) || {};
      return { id: 't' + tx.id, user_id: tx.user_id, name: u.name, email: u.email, property: String(tx.label || tx.type), amount: tx.amount, purchased_at: tx.created_at };
    });
    const seen = new Set(purchasesFromPortfolio.map(r => r.user_id + '|' + r.property + '|' + r.amount));
    const extraPurch = purchasesFromTx.filter(r => !seen.has(r.user_id + '|' + r.property + '|' + r.amount));
    const purchases = purchasesFromPortfolio.concat(extraPurch);
    const claimedIncome = (s.transactions || []).filter(tx => tx.type === 'daily_income' || tx.type === 'activation_bonus');
    users.forEach(u => {
      u.claimedIncome = claimedIncome.filter(tx => tx.user_id === u.id).reduce((a, tx) => a + Number(tx.amount || 0), 0);
    });
    return send(res, 200, { users, events, deposits, withdrawals, purchases, claimedIncome });
  }

  return send(res, 404, { message: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { message: 'Server error' });
  }
});

function startOnPort(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      const next = Number(port) + 1;
      console.log(`Port ${port} is busy, trying ${next}...`);
      startOnPort(next, attemptsLeft - 1);
      return;
    }
    if (err && err.code === 'EADDRINUSE') {
      console.error('Port ' + port + ' is already in use.');
      console.error('Close the old server first, then start again:');
      console.error('  Windows:  netstat -ano | findstr :' + port);
      console.error('            taskkill /F /PID <pid>');
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    console.log(`Sirius Global → http://localhost:${port}`);
    console.log(`Admin → http://localhost:${port}/admin`);
    console.log('[sirius] bind ' + host + ':' + port);
    console.log('[sirius] ' + (typeof getLastResetLog === 'function' ? getLastResetLog() : 'reset log n/a'));
  });
}

startOnPort(Number(PORT) || 3000, 15);
