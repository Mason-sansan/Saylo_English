import { useState, type FormEvent } from 'react';
import { useAuth } from './auth/AuthContext';
import { SayloMark } from './SayloMark';

/** Product wordmark — keep in sync with index.html & in-app shell. */
const APP_NAME = 'Saylo';

type Mode = 'signin' | 'register' | 'forgot';

export function AuthScreen() {
  const { login, register, forgotPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function goSignIn() {
    setMode('signin');
    setError(null);
    setNewPw('');
    setConfirmPw('');
  }

  function goRegister() {
    setMode('register');
    setError(null);
    setNewPw('');
    setConfirmPw('');
  }

  function goForgot() {
    setMode('forgot');
    setError(null);
    setNewPw('');
    setConfirmPw('');
  }

  async function onSubmitSigninRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = mode === 'signin' ? await login(email, password) : await register(email, password);
      if (!r.ok) setError(r.error);
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPw !== confirmPw) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await forgotPassword(email, newPw);
      if (!r.ok) setError(r.error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-inner">
        <div className="auth-brandlock">
          <SayloMark />
          <div className="auth-wordmark">{APP_NAME}</div>
        </div>

        <div
          key={mode}
          className={`auth-anim-surface auth-anim-surface--${mode}`}
          aria-live="polite"
        >
          {mode === 'forgot' ? (
            <form className="auth-form" onSubmit={onSubmitForgot} noValidate>
              <p className="auth-forgot-lead">Enter the email for your account, then your new password.</p>
              <label className="auth-label" htmlFor="forgot-email">
                Email
              </label>
              <input
                id="forgot-email"
                className="auth-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                required
                disabled={submitting}
              />

              <label className="auth-label" htmlFor="forgot-new">
                New password
              </label>
              <input
                id="forgot-new"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(ev) => setNewPw(ev.target.value)}
                required
                minLength={8}
                disabled={submitting}
              />
              <label className="auth-label" htmlFor="forgot-confirm">
                Confirm new password
              </label>
              <input
                id="forgot-confirm"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                value={confirmPw}
                onChange={(ev) => setConfirmPw(ev.target.value)}
                required
                minLength={8}
                disabled={submitting}
              />
              <p className="auth-hint">At least 8 characters. On this device, reset is local only.</p>

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={submitting}>
                {submitting ? 'Please wait…' : 'Reset password and sign in'}
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={onSubmitSigninRegister} noValidate>
              <label className="auth-label" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                className="auth-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                required
                disabled={submitting}
              />

              <label className="auth-label" htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                className="auth-input"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                required
                minLength={mode === 'register' ? 8 : undefined}
                disabled={submitting}
              />
              {mode === 'register' && <p className="auth-hint">At least 8 characters.</p>}

              {mode === 'signin' && (
                <div className="auth-forgot-row">
                  <a
                    className="auth-link auth-link--subtle"
                    href="#forgot-password"
                    onClick={(e) => {
                      e.preventDefault();
                      goForgot();
                    }}
                  >
                    Forgot password?
                  </a>
                </div>
              )}

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="auth-submit" disabled={submitting}>
                {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          )}

          <div className="auth-switch">
            {mode === 'forgot' ? (
              <>
                <a
                  className="auth-link"
                  href="#sign-in"
                  onClick={(e) => {
                    e.preventDefault();
                    goSignIn();
                  }}
                >
                  Back to sign in
                </a>
              </>
            ) : mode === 'signin' ? (
              <>
                New here?{' '}
                <a
                  className="auth-link"
                  href="#create-account"
                  onClick={(e) => {
                    e.preventDefault();
                    goRegister();
                  }}
                >
                  Create an account
                </a>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <a
                  className="auth-link"
                  href="#sign-in"
                  onClick={(e) => {
                    e.preventDefault();
                    goSignIn();
                  }}
                >
                  Sign in
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
