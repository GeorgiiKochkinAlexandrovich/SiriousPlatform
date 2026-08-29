const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sirius.json');
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'sirius-dev-secret-change-in-production');
if (!JWT_SECRET) {
  console.error('[sirius] JWT_SECRET is required in production. Set it in the environment.');
  process.exit(1);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash || hash.length % 2) return false;
    const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
    if (h.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(h, 'hex'));
  } catch (e) {
    return false;
  }
}

function checkPassword(user, password) {
  const pass = String(password || '');
  if (!user || !pass) return false;
  if (user.password_hash && verifyPassword(pass, user.password_hash)) return true;
  if (user.password_plain && String(user.password_plain) === pass) {
    try {
      user.password_hash = hashPassword(pass);
    } catch (e) {}
    return true;
  }
  return false;
}

function signToken(payload, days) {
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Date.now() + (days || 7) * 864e5
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) throw new Error('bad token');
  const expect = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) {
    throw new Error('bad sig');
  }
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (data.exp < Date.now()) throw new Error('expired');
  return data;
}

const defaultState = () => ({
  users: [], deposits: [], withdrawals: [], transactions: [], portfolio: [], visits: [], invite_codes: [],
  seq: { users: 1, deposits: 1, withdrawals: 1, transactions: 1, portfolio: 1, visits: 1, invite_codes: 1 }
});

let state = null;

let lastResetLog = 'no reset flag';

function flagNameOk(name) {
  const n = String(name || '').toLowerCase();
  return n === 'reset_on_full_update.flag' || n === 'reset_on_full_update.flag.txt' || n === 'reset_on_full_update';
}

function findResetFlag() {
  const dirs = [
    __dirname
  ];
  const hits = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      if (!flagNameOk(name)) continue;
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isFile()) hits.push(full);
      } catch (e) {}
    }
  }
  return hits;
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const dataFlag = path.join(DATA_DIR, 'RESET_ON_FULL_UPDATE.flag');
  const dataFlagTxt = path.join(DATA_DIR, 'RESET_ON_FULL_UPDATE.flag.txt');
  const flags = findResetFlag().filter(f => {
    const inData = path.normalize(f).startsWith(path.normalize(DATA_DIR) + path.sep);
    return !inData;
  });
  if (fs.existsSync(dataFlag) || fs.existsSync(dataFlagTxt)) {
    lastResetLog = 'RESET_ON_FULL_UPDATE.flag in data/ ignored — keeping ' + DB_PATH;
    console.log('[sirius] ' + lastResetLog);
  }
  if (flags.length) {
    console.log('[sirius] RESET FLAG FOUND:');
    flags.forEach(f => console.log('[sirius]   ' + f));
    state = defaultState();
    save();
    flags.forEach(f => { try { fs.unlinkSync(f); console.log('[sirius] flag deleted: ' + f); } catch (e) { console.log('[sirius] could not delete ' + f + ': ' + e.message); } });
    lastResetLog = 'DATABASE RESET. users=0, saved ' + DB_PATH;
    console.log('[sirius] ' + lastResetLog);
  } else if (fs.existsSync(DB_PATH)) {
    state = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    lastResetLog = 'no reset flag, loaded ' + DB_PATH;
    console.log('[sirius] ' + lastResetLog);
  } else {
    state = defaultState();
    save();
    lastResetLog = 'no db yet, created ' + DB_PATH;
    console.log('[sirius] ' + lastResetLog);
  }
  if (!state.visits) state.visits = [];
  if (!state.withdrawals) state.withdrawals = [];
  if (!state.deposits) state.deposits = [];
  if (!state.portfolio) state.portfolio = [];
  if (!state.transactions) state.transactions = [];
  if (!state.invite_codes) state.invite_codes = [];
  if (!state.seq) state.seq = {};
  if (!state.seq.visits) state.seq.visits = 1;
  if (!state.seq.invite_codes) state.seq.invite_codes = 1;
  return state;
}
function save() { fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2)); }
function getState() { if (!state) load(); return state; }
function nextId(key) {
  const s = getState();
  if (key === 'users' && Array.isArray(s.users) && s.users.length) {
    const max = s.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
    const id = max + 1;
    s.seq.users = id + 1;
    return id;
  }
  const id = s.seq[key] || 1;
  s.seq[key] = id + 1;
  return id;
}

function init() {
  load();
  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@sirius.local').trim().toLowerCase();
  const adminPass = String(process.env.ADMIN_PASSWORD || 'Admin123!');
  let admin = getState().users.find(u => u.role === 'admin') || getState().users.find(u => u.email === adminEmail);
  if (!admin) {
    admin = {
      id: nextId('users'),
      email: adminEmail,
      name: 'Administrator',
      phone: '+971000000000',
      password_hash: hashPassword(adminPass),
      balance: 0,
      role: 'admin',
      share_plan_id: null, share_plan_price: null, share_plan_max: null,
      license_id: null, license_expires_at: null, license_price: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    getState().users.push(admin);
    save();
    console.log('[db] Seeded admin account:', adminEmail, '(change ADMIN_PASSWORD on the server)');
  } else if (process.env.ADMIN_PASSWORD) {
    admin.email = adminEmail;
    admin.password_hash = hashPassword(adminPass);
    admin.updated_at = new Date().toISOString();
    save();
    console.log('[db] Admin credentials updated from environment');
  }
  return getState();
}

module.exports = { init, getState, save, nextId, hashPassword, verifyPassword, checkPassword, signToken, verifyToken, DB_PATH, getLastResetLog: () => lastResetLog };
