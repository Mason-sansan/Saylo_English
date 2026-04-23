import type { AuthResult, AuthUser } from './auth';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function readError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: string };
    if (j && typeof j.error === 'string') return j.error;
  } catch {
    /* ignore */
  }
  return 'Request failed.';
}

export async function serverGetMe(): Promise<AuthUser | null> {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  const j = (await r.json().catch(() => ({}))) as { user?: { email?: string } };
  const em = j?.user?.email;
  if (typeof em === 'string' && em.trim()) return { email: em.trim().toLowerCase() };
  return null;
}

export async function serverLogin(email: string, password: string): Promise<AuthResult> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const j = (await r.json().catch(() => ({}))) as { user?: { email?: string } };
  const em = j?.user?.email;
  if (typeof em !== 'string' || !em.trim()) return { ok: false, error: 'Invalid response.' };
  return { ok: true, user: { email: em.trim().toLowerCase() } };
}

export async function serverRegister(email: string, password: string): Promise<AuthResult> {
  const r = await fetch('/api/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const j = (await r.json().catch(() => ({}))) as { user?: { email?: string } };
  const em = j?.user?.email;
  if (typeof em !== 'string' || !em.trim()) return { ok: false, error: 'Invalid response.' };
  return { ok: true, user: { email: em.trim().toLowerCase() } };
}

export async function serverForgotPassword(email: string, newPassword: string): Promise<AuthResult> {
  const r = await fetch('/api/auth/forgot', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ email, newPassword }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  const j = (await r.json().catch(() => ({}))) as { user?: { email?: string } };
  const em = j?.user?.email;
  if (typeof em !== 'string' || !em.trim()) return { ok: false, error: 'Invalid response.' };
  return { ok: true, user: { email: em.trim().toLowerCase() } };
}

export async function serverChangePassword(newPassword: string): Promise<AuthResult> {
  const r = await fetch('/api/auth/password', {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ newPassword }),
  });
  if (!r.ok) return { ok: false, error: await readError(r) };
  return { ok: true };
}

export async function serverLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}
