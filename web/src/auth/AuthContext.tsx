/* eslint-disable react-refresh/only-export-components -- context + useAuth pair */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  type AuthResult,
  type AuthUser,
  getSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  resetPasswordAndSignIn,
  setPasswordForEmail,
} from '../lib/auth';
import {
  serverChangePassword,
  serverForgotPassword,
  serverGetMe,
  serverLogin,
  serverLogout,
  serverRegister,
} from '../lib/authServer';
import { USE_SERVER_AUTH } from '../lib/serverAuthConfig';

type AuthContextValue = {
  user: AuthUser | null;
  /** True only when VITE_USE_SERVER_AUTH: waiting for /api/auth/me. */
  authBooting: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (email: string, password: string) => Promise<AuthResult>;
  /** Login-screen flow: set new password for an existing email and sign in. */
  forgotPassword: (email: string, newPassword: string) => Promise<AuthResult>;
  logout: () => void;
  /** Account tab: new password only (no current password; local store). */
  changePassword: (newPassword: string) => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (USE_SERVER_AUTH ? null : getSession()));
  const [authBooting, setAuthBooting] = useState(USE_SERVER_AUTH);

  useEffect(() => {
    if (!USE_SERVER_AUTH) {
      setAuthBooting(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const u = await serverGetMe();
        if (!cancelled) setUser(u);
      } finally {
        if (!cancelled) setAuthBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (USE_SERVER_AUTH) {
      const r = await serverLogin(email, password);
      if (r.ok && r.user) setUser(r.user);
      return r;
    }
    const r = await loginAccount(email, password);
    if (r.ok) setUser(getSession());
    return r;
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    if (USE_SERVER_AUTH) {
      const r = await serverRegister(email, password);
      if (r.ok && r.user) setUser(r.user);
      return r;
    }
    const r = await registerAccount(email, password);
    if (r.ok) setUser(getSession());
    return r;
  }, []);

  const forgotPassword = useCallback(async (email: string, newPassword: string) => {
    if (USE_SERVER_AUTH) {
      const r = await serverForgotPassword(email, newPassword);
      if (r.ok && r.user) setUser(r.user);
      return r;
    }
    const r = await resetPasswordAndSignIn(email, newPassword);
    if (r.ok) setUser(getSession());
    return r;
  }, []);

  const logout = useCallback(() => {
    if (USE_SERVER_AUTH) {
      void serverLogout();
      setUser(null);
      return;
    }
    logoutAccount();
    setUser(null);
  }, []);

  const changePasswordFn = useCallback(async (newPassword: string) => {
    if (USE_SERVER_AUTH) {
      return serverChangePassword(newPassword);
    }
    const u = user ?? getSession();
    if (!u) return { ok: false as const, error: 'Not signed in.' };
    return setPasswordForEmail(u.email, newPassword);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      authBooting,
      login,
      register,
      forgotPassword,
      logout,
      changePassword: changePasswordFn,
    }),
    [user, authBooting, login, register, forgotPassword, logout, changePasswordFn],
  );

  if (USE_SERVER_AUTH && authBooting) {
    return (
      <div className="shell">
        <div className="auth-screen">
          <p className="account-sub" style={{ textAlign: 'center', marginTop: 48 }}>
            Loading…
          </p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
