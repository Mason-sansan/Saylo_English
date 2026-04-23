import { useState, type FormEvent } from 'react';
import { useAuth } from './auth/AuthContext';

export function AccountView() {
  const { user, logout, changePassword } = useAuth();
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openPw, setOpenPw] = useState(false);

  if (!user) return null;

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (newPw !== confirmPw) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const r = await changePassword(newPw);
      if (r.ok) {
        setMsg('Password updated.');
        setNewPw('');
        setConfirmPw('');
        setOpenPw(false);
      } else {
        setErr(r.error);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page account-page">
      <div className="account-header">
        <h1 className="account-title">Account</h1>
        <p className="account-sub">Sign-in and security for this device.</p>
      </div>

      <section className="account-block" aria-labelledby="account-email-h">
        <h2 id="account-email-h" className="account-section-title">
          Email
        </h2>
        <p className="account-email" title={user.email}>
          {user.email}
        </p>
      </section>

      <section className="account-block" aria-labelledby="account-pw-h">
        <div className="account-row">
          <h2 id="account-pw-h" className="account-section-title">
            Password
          </h2>
          <button
            type="button"
            className="account-text-btn"
            onClick={() => {
              setOpenPw((o) => !o);
              setMsg(null);
              setErr(null);
            }}
            aria-expanded={openPw}
          >
            {openPw ? 'Cancel' : 'Change'}
          </button>
        </div>

        {openPw && (
          <form className="account-pw-form" onSubmit={onChangePassword}>
            <label className="auth-label" htmlFor="new-pw">
              New password
            </label>
            <input
              id="new-pw"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={8}
              disabled={busy}
            />
            <label className="auth-label" htmlFor="cf-pw">
              Confirm new password
            </label>
            <input
              id="cf-pw"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              minLength={8}
              disabled={busy}
            />
            {err && <div className="auth-error">{err}</div>}
            {msg && <div className="auth-success">{msg}</div>}
            <button type="submit" className="auth-submit" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </section>

      <div className="account-footer">
        <button
          type="button"
          className="account-signout"
          onClick={() => {
            if (window.confirm('Sign out of this account on this device?')) logout();
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
