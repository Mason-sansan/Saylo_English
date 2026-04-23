import bcrypt from 'bcryptjs';
import session from 'express-session';
import sessionFileStoreFactory from 'session-file-store';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openUserDb, userDbMethods } from './userDb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BCRYPT_ROUNDS = 10;

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function emailValid(email) {
  const e = normalizeEmail(email);
  if (e.length < 5 || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Mount session + /api/auth/* + /api/me/* on `app`. Returns the session middleware
 * (for WebSocket upgrade requests).
 * @param {import('express').Express} app
 */
export function mountServerAuth(app) {
  const dbPath = process.env.USER_DB_PATH || join(__dirname, 'data', 'users.sqlite');
  const db = openUserDb(dbPath);
  const users = userDbMethods(db);

  const secret =
    process.env.SESSION_SECRET || 'dev-insecure-change-me-set-SESSION_SECRET';
  if (secret === 'dev-insecure-change-me-set-SESSION_SECRET') {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] SESSION_SECRET is unset — using dev default. Set SESSION_SECRET in production.',
    );
  }

  const cookieSecure = String(process.env.COOKIE_SECURE ?? '0') === '1';
  const FileStore = sessionFileStoreFactory(session);
  const sessionDir = process.env.SESSION_FILES_DIR || join(__dirname, 'data', 'sessions');

  /** @type {import('express-session').SessionOptions} */
  const sessionOptions = {
    name: 'saylo.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: sessionDir,
      ttl: 60 * 60 * 24 * 30,
      retries: 1,
    }),
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  };

  const sessionMiddleware = session(sessionOptions);
  app.use(sessionMiddleware);

  function requireUserSession(req, res, next) {
    const uid = req.session?.userId;
    if (uid == null || typeof uid !== 'number') {
      return res.status(401).json({ error: 'Not signed in.' });
    }
    next();
  }

  app.get('/api/auth/me', (req, res) => {
    const uid = req.session?.userId;
    const em = req.session?.email;
    if (uid == null || typeof em !== 'string') {
      return res.json({ user: null });
    }
    return res.json({ user: { email: em } });
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email ?? '');
      const password = String(req.body?.password ?? '');
      if (!emailValid(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      if (users.findByEmail(email)) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const row = users.createUser(email, hash);
      req.session.userId = row.id;
      req.session.email = row.email;
      return res.status(201).json({ ok: true, user: { email: row.email } });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth] register', e);
      return res.status(500).json({ error: 'Registration failed.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email ?? '');
      const password = String(req.body?.password ?? '');
      if (!emailValid(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.' });
      }
      const row = users.findByEmail(email);
      if (!row) {
        return res.status(401).json({ error: 'No account found for this email.' });
      }
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      req.session.userId = row.id;
      req.session.email = row.email;
      return res.json({ ok: true, user: { email: row.email } });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth] login', e);
      return res.status(500).json({ error: 'Login failed.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[auth] logout', err);
        return res.status(500).json({ error: 'Logout failed.' });
      }
      res.clearCookie('saylo.sid');
      return res.json({ ok: true });
    });
  });

  /**
   * Same limitation as the old local-only flow: no email proof. Prefer disabling this
   * route in production until you add SMTP / magic links.
   */
  app.post('/api/auth/forgot', async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email ?? '');
      const newPassword = String(req.body?.newPassword ?? '');
      if (!emailValid(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      const row = users.findByEmail(email);
      if (!row) {
        return res.status(404).json({ error: 'No account for this email. Create an account first.' });
      }
      const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      users.updatePasswordHash(row.id, hash);
      req.session.userId = row.id;
      req.session.email = row.email;
      return res.json({ ok: true, user: { email: row.email } });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth] forgot', e);
      return res.status(500).json({ error: 'Could not reset password.' });
    }
  });

  app.post('/api/auth/password', requireUserSession, async (req, res) => {
    try {
      const newPassword = String(req.body?.newPassword ?? '');
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      const uid = req.session.userId;
      const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      users.updatePasswordHash(uid, hash);
      return res.json({ ok: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth] password', e);
      return res.status(500).json({ error: 'Could not update password.' });
    }
  });

  app.get('/api/me/state', requireUserSession, (req, res) => {
    try {
      const row = users.getAppState(req.session.userId);
      let growth = null;
      let lastSession = null;
      if (row?.growth_json) {
        try {
          growth = JSON.parse(row.growth_json);
        } catch {
          growth = null;
        }
      }
      if (row?.last_session_json) {
        try {
          lastSession = JSON.parse(row.last_session_json);
        } catch {
          lastSession = null;
        }
      }
      return res.json({ growth, lastSession });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[me] get state', e);
      return res.status(500).json({ error: 'Could not load saved state.' });
    }
  });

  app.put('/api/me/state', requireUserSession, (req, res) => {
    try {
      const growth = req.body?.growth;
      const lastSession = req.body?.lastSession;
      if (growth === undefined) {
        return res.status(400).json({ error: 'Missing growth payload.' });
      }
      const growthJson = JSON.stringify(growth);
      const lastJson =
        lastSession === null || lastSession === undefined ? null : JSON.stringify(lastSession);
      users.setAppState(req.session.userId, growthJson, lastJson);
      return res.json({ ok: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[me] put state', e);
      return res.status(500).json({ error: 'Could not save state.' });
    }
  });

  // eslint-disable-next-line no-console
  console.log(`[auth] SERVER_AUTH on — user DB: ${dbPath}`);

  return sessionMiddleware;
}
