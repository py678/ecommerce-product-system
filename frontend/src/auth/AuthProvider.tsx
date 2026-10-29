import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorMessage, isCanceled } from '../api/client';
import type { AuthResponse, User } from '../api/types';
import { AuthContext } from './auth-context';
import { sessionToken, SESSION_EXPIRED_EVENT } from './session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!sessionToken.get());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    function expire() {
      setUser(null);
      setError(null);
      setNotice('登录已过期，请重新登录。');
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    if (sessionToken.get()) {
      api.auth
        .me(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setUser(result);
        })
        .catch((cause: unknown) => {
          if (
            !controller.signal.aborted &&
            !isCanceled(cause) &&
            sessionToken.get()
          )
            setError(errorMessage(cause));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
    };
  }, []);

  function signIn(response: AuthResponse) {
    sessionToken.set(response.accessToken);
    setUser(response.user);
    setError(null);
    setNotice(null);
  }

  function signOut() {
    sessionToken.set(null);
    setUser(null);
    setError(null);
    setNotice(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, error, notice, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
