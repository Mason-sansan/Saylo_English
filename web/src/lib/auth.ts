/**
 * Local-first account store (no server). Passwords are SHA-256 hashes with per-user salt.
 * Replace with API-backed auth when a backend is available.
 */

const USERS_KEY = 'englearn_users_v1';
const SESSION_KEY = 'englearn_session_v1';

export type AuthUser = {
  email: string;
};

type StoredUserRecord = {
  salt: string;
  passwordHash: string;
};

type UserStore = Record<string, StoredUserRecord>;

function loadStore(): UserStore {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object') return {};
    return p as UserStore;
  } catch {
    return {};
  }
}

function saveStore(store: UserStore) {
  localStorage.setItem(USERS_KEY, JSON.stringify(store));
}

/** Local account emails (for per-user data scoping, migration). */
export function listLocalAccountEmails(): string[] {
  return Object.keys(loadStore());
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function randomSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${password}`);
}

function emailValid(email: string): boolean {
  const e = normalizeEmail(email);
  if (e.length < 5 || e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function getSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { email?: string };
    const email = typeof p?.email === 'string' ? normalizeEmail(p.email) : '';
    if (!email || !emailValid(email)) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    const store = loadStore();
    if (!store[email]) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { email };
  } catch {
    return null;
  }
}

function setSession(user: AuthUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email: user.email }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export type AuthResult =
  | { ok: true; user?: AuthUser }
  | { ok: false; error: string };

export async function registerAccount(email: string, password: string): Promise<AuthResult> {
  const e = normalizeEmail(email);
  if (!emailValid(e)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  const store = loadStore();
  if (store[e]) {
    return { ok: false, error: 'An account with this email already exists.' };
  }
  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  store[e] = { salt, passwordHash };
  saveStore(store);
  setSession({ email: e });
  return { ok: true };
}

export async function loginAccount(email: string, password: string): Promise<AuthResult> {
  const e = normalizeEmail(email);
  if (!emailValid(e)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const store = loadStore();
  const rec = store[e];
  if (!rec) {
    return { ok: false, error: 'No account found for this email.' };
  }
  const h = await hashPassword(password, rec.salt);
  if (h !== rec.passwordHash) {
    return { ok: false, error: 'Incorrect password.' };
  }
  setSession({ email: e });
  return { ok: true };
}

export function logoutAccount() {
  clearSession();
}

/**
 * Set a new password for an existing account (no old password; local store only).
 * Does not start a session — use when already signed in.
 */
export async function setPasswordForEmail(email: string, newPassword: string): Promise<AuthResult> {
  const e = normalizeEmail(email);
  if (!emailValid(e)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  const store = loadStore();
  if (!store[e]) {
    return { ok: false, error: 'Account not found.' };
  }
  const salt = randomSalt();
  const passwordHash = await hashPassword(newPassword, salt);
  store[e] = { salt, passwordHash };
  saveStore(store);
  return { ok: true };
}

/**
 * Same as updating the password hash, then signs in (for "Forgot password" on the login screen).
 */
export async function resetPasswordAndSignIn(email: string, newPassword: string): Promise<AuthResult> {
  const e = normalizeEmail(email);
  if (!emailValid(e)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  const store = loadStore();
  if (!store[e]) {
    return { ok: false, error: 'No account for this email. Create an account first.' };
  }
  const salt = randomSalt();
  const passwordHash = await hashPassword(newPassword, salt);
  store[e] = { salt, passwordHash };
  saveStore(store);
  setSession({ email: e });
  return { ok: true };
}
