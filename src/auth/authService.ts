// Auth Service — JWT and Password Operations
// Component 4: Auth Service - authService
// Per Agent_Prompt.md SECTION 4G: JWT payload { sub, email, iat, exp }

import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Config } from '../config';
import { User, userStore } from './userStore';

/**
 * JWT token payload structure
 */
export interface TokenPayload {
  sub: string; // user ID
  email: string;
  iat: number; // issued at (seconds)
  exp: number; // expiration (seconds)
}

/**
 * Registration response
 */
export interface RegisterResponse {
  token: string;
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
}

/**
 * Login response
 */
export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
}

/**
 * Current user response (from /auth/me)
 */
export interface MeResponse {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * Hashes a password using bcryptjs (SALT_ROUNDS = 10)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Compares a plain password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Signs a JWT token for a user
 * Expiry: parsed from config.JWT_EXPIRES_IN (e.g., "24h", "7d", "1h")
 */
export function signToken(user: User, config: Config): string {
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as any);
}

/**
 * Verifies a JWT token and returns the payload
 * Throws if token is invalid or expired
 */
export function verifyToken(token: string, config: Config): TokenPayload {
  return jwt.verify(token, config.JWT_SECRET) as TokenPayload;
}

/**
 * Registers a new user
 * Throws error if email already exists or validation fails
 */
export async function registerUser(email: string, password: string, config: Config): Promise<RegisterResponse> {
  // Validate inputs
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }

  const trimmedEmail = email.toLowerCase().trim();
  const trimmedPassword = password.trim();

  // Validate email format (basic check)
  if (!trimmedEmail.includes('@')) {
    throw new Error('Invalid email format');
  }

  // Validate password length (at least 8 characters)
  if (trimmedPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  // Check if user already exists
  const existing = userStore.getUserByEmail(trimmedEmail);
  if (existing) {
    throw new Error(`User with email ${trimmedEmail} already exists`);
  }

  // Hash password and create user
  const passwordHash = await hashPassword(trimmedPassword);
  const user = userStore.createUser(trimmedEmail, passwordHash);

  // Generate JWT
  const token = signToken(user, config);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
  };
}

/**
 * Logs in a user (validates email and password)
 * Throws error if credentials are invalid
 */
export async function loginUser(email: string, password: string, config: Config): Promise<LoginResponse> {
  // Validate inputs
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }

  const trimmedEmail = email.toLowerCase().trim();

  // Find user by email
  const user = userStore.getUserByEmail(trimmedEmail);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Verify password
  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    throw new Error('Invalid email or password');
  }

  // Generate JWT
  const token = signToken(user, config);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    },
  };
}

/**
 * Gets current user info from token
 */
export function getCurrentUser(payload: TokenPayload): MeResponse {
  const user = userStore.getUserById(payload.sub);
  if (!user) {
    throw new Error('User not found');
  }

  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
  };
}
