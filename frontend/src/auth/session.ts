const KEY = 'silk-shop.access-token';
export const SESSION_EXPIRED_EVENT = 'silk-shop:session-expired';

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let currentToken = readStoredToken();

export const sessionToken = {
  get: () => currentToken,
  set(token: string | null) {
    currentToken = token;
    try {
      if (token) sessionStorage.setItem(KEY, token);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* Memory-only sessions still work when browser storage is disabled. */
    }
  },
};
