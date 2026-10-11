// User & Auth types
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  mfaRequired: true;
  csrfToken: string;
}

export interface FactorCredentials {
  kind: 'totp' | 'recovery';
  code: string;
}

export interface FullAuthResponse {
  user: User;
  csrfToken: string;
}

// API response types
export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}
