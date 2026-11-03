import { createContext } from 'react';
import type { AuthResponse, User } from '../api/types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  signIn: (response: AuthResponse) => void;
  signOut: () => void;
  updateUser: (user: User) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
