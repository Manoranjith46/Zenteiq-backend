// Tests for Auth Service — JWT and Password Operations
// Component 4: Auth Service

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  registerUser,
  loginUser,
  getCurrentUser,
  TokenPayload,
} from '../src/auth/authService';
import { extractBearerToken, extractQueryToken, authenticateRequest, authenticateWebSocket } from '../src/auth/authMiddleware';
import { userStore } from '../src/auth/userStore';

// Mock config
const mockConfig = {
  PORT: 3000,
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
  JWT_EXPIRES_IN: '24h',
  POLL_INTERVAL_MS: 250,
  TAIL_CHUNK_SIZE: 4096,
  LOGS_DIR: './logs',
  ALLOWED_EXTENSIONS: ['.log', '.txt'],
};

describe('Auth Service', () => {
  // Clean up users before and after each test
  beforeEach(() => {
    userStore._clearAll();
  });

  afterEach(() => {
    userStore._clearAll();
  });

  describe('Password Operations', () => {
    test('hashPassword should hash a password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);

      assert(hash, 'hash should not be empty');
      assert.notStrictEqual(hash, password, 'hash should not equal plain password');
      assert(hash.startsWith('$2'), 'bcrypt hash should start with $2');
    });

    test('verifyPassword should verify correct password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);
      const valid = await verifyPassword(password, hash);

      assert.strictEqual(valid, true);
    });

    test('verifyPassword should reject incorrect password', async () => {
      const password = 'test-password-123';
      const hash = await hashPassword(password);
      const valid = await verifyPassword('wrong-password', hash);

      assert.strictEqual(valid, false);
    });
  });

  describe('JWT Operations', () => {
    test('signToken should create a valid JWT', () => {
      const user = {
        id: '123-uuid',
        email: 'test@example.com',
        passwordHash: 'hash',
        createdAt: new Date().toISOString(),
      };

      const token = signToken(user, mockConfig);

      assert(token, 'token should not be empty');
      assert(typeof token === 'string');
      assert(token.split('.').length === 3, 'JWT should have 3 parts (header.payload.signature)');
    });

    test('verifyToken should decode and return payload', () => {
      const user = {
        id: '123-uuid',
        email: 'test@example.com',
        passwordHash: 'hash',
        createdAt: new Date().toISOString(),
      };

      const token = signToken(user, mockConfig);
      const payload = verifyToken(token, mockConfig);

      assert.strictEqual(payload.sub, '123-uuid');
      assert.strictEqual(payload.email, 'test@example.com');
      assert(payload.iat, 'payload should have iat (issued at)');
      assert(payload.exp, 'payload should have exp (expiration)');
    });

    test('verifyToken should throw on invalid token', () => {
      assert.throws(
        () => {
          verifyToken('invalid.token.here', mockConfig);
        },
        (err: Error) => err.message.includes('invalid'),
      );
    });

    test('verifyToken should throw on expired token', () => {
      const user = {
        id: '123-uuid',
        email: 'test@example.com',
        passwordHash: 'hash',
        createdAt: new Date().toISOString(),
      };

      // Sign with very short expiry
      const token = signToken(user, { ...mockConfig, JWT_EXPIRES_IN: '0s' });

      // Wait a moment and try to verify
      setTimeout(() => {
        assert.throws(
          () => {
            verifyToken(token, mockConfig);
          },
          (err: Error) => err.message.includes('expired'),
        );
      }, 100);
    });
  });

  describe('User Registration', () => {
    test('registerUser should create new user with valid credentials', async () => {
      const response = await registerUser('test@example.com', 'password123', mockConfig);

      assert(response.token, 'token should be provided');
      assert.strictEqual(response.user.email, 'test@example.com');
      assert(response.user.id, 'user should have an id');
      assert(response.user.createdAt, 'user should have createdAt');
    });

    test('registerUser should normalize email to lowercase', async () => {
      const response = await registerUser('Test@Example.COM', 'password123', mockConfig);

      assert.strictEqual(response.user.email, 'test@example.com');
    });

    test('registerUser should reject short password (< 8 chars)', async () => {
      assert.rejects(
        () => registerUser('short@example.com', 'pass', mockConfig),
        (err: Error) => err.message.includes('8 characters'),
      );
    });

    test('registerUser should reject invalid email (no @)', async () => {
      assert.rejects(
        () => registerUser('invalid-email', 'password123', mockConfig),
        (err: Error) => err.message.includes('Invalid email'),
      );
    });

    test('registerUser should reject duplicate email', async () => {
      await registerUser('duplicate@example.com', 'password123', mockConfig);

      assert.rejects(
        () => registerUser('duplicate@example.com', 'password456', mockConfig),
        (err: Error) => err.message.includes('already exists'),
      );
    });

    test('registerUser should reject missing email', async () => {
      assert.rejects(
        () => registerUser('', 'password123', mockConfig),
        (err: Error) => err.message.includes('Email is required'),
      );
    });

    test('registerUser should reject missing password', async () => {
      assert.rejects(
        () => registerUser('test@example.com', '', mockConfig),
        (err: Error) => err.message.includes('Password is required'),
      );
    });
  });

  describe('User Login', () => {
    test('loginUser should return token and user for valid credentials', async () => {
      await registerUser('login@example.com', 'password123', mockConfig);

      const response = await loginUser('login@example.com', 'password123', mockConfig);

      assert(response.token, 'token should be provided');
      assert.strictEqual(response.user.email, 'login@example.com');
      assert(response.user.id, 'user should have an id');
    });

    test('loginUser should normalize email to lowercase', async () => {
      await registerUser('case@example.com', 'password123', mockConfig);

      const response = await loginUser('CASE@EXAMPLE.COM', 'password123', mockConfig);

      assert.strictEqual(response.user.email, 'case@example.com');
    });

    test('loginUser should reject wrong password', async () => {
      await registerUser('wrong@example.com', 'password123', mockConfig);

      assert.rejects(
        () => loginUser('wrong@example.com', 'wrong-password', mockConfig),
        (err: Error) => err.message.includes('Invalid email or password'),
      );
    });

    test('loginUser should reject non-existent user', async () => {
      assert.rejects(
        () => loginUser('nonexistent@example.com', 'password123', mockConfig),
        (err: Error) => err.message.includes('Invalid email or password'),
      );
    });

    test('loginUser should reject missing email', async () => {
      assert.rejects(
        () => loginUser('', 'password123', mockConfig),
        (err: Error) => err.message.includes('Email is required'),
      );
    });

    test('loginUser should reject missing password', async () => {
      assert.rejects(
        () => loginUser('test@example.com', '', mockConfig),
        (err: Error) => err.message.includes('Password is required'),
      );
    });
  });

  describe('Get Current User', () => {
    test('getCurrentUser should return user from token payload', async () => {
      const reg = await registerUser('me@example.com', 'password123', mockConfig);
      const payload = verifyToken(reg.token, mockConfig);

      const user = getCurrentUser(payload);

      assert.strictEqual(user.email, 'me@example.com');
      assert.strictEqual(user.id, payload.sub);
      assert(user.createdAt);
    });

    test('getCurrentUser should throw if user not found', () => {
      const fakePayload: TokenPayload = {
        sub: 'fake-id',
        email: 'fake@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      };

      assert.throws(
        () => getCurrentUser(fakePayload),
        (err: Error) => err.message.includes('User not found'),
      );
    });
  });

  describe('Auth Middleware', () => {
    test('extractBearerToken should extract valid token', () => {
      const token = extractBearerToken('Bearer abc123xyz');

      assert.strictEqual(token, 'abc123xyz');
    });

    test('extractBearerToken should return null for missing header', () => {
      const token = extractBearerToken();

      assert.strictEqual(token, null);
    });

    test('extractBearerToken should return null for invalid format', () => {
      const token = extractBearerToken('Bearer');

      assert.strictEqual(token, null);
    });

    test('extractBearerToken should return null if not Bearer', () => {
      const token = extractBearerToken('Basic abc123');

      assert.strictEqual(token, null);
    });

    test('extractQueryToken should extract token from query string', () => {
      const token = extractQueryToken('token=abc123xyz&other=value');

      assert.strictEqual(token, 'abc123xyz');
    });

    test('extractQueryToken should return null for missing token', () => {
      const token = extractQueryToken('other=value');

      assert.strictEqual(token, null);
    });

    test('extractQueryToken should handle empty query string', () => {
      const token = extractQueryToken('');

      assert.strictEqual(token, null);
    });

    test('authenticateRequest should extract and verify token', async () => {
      const reg = await registerUser('auth@example.com', 'password123', mockConfig);

      const payload = authenticateRequest({ authorization: `Bearer ${reg.token}` }, mockConfig);

      assert.strictEqual(payload.email, 'auth@example.com');
    });

    test('authenticateRequest should throw on missing header', () => {
      assert.throws(
        () => authenticateRequest({}, mockConfig),
        (err: Error) => err.message.includes('Missing or invalid'),
      );
    });

    test('authenticateWebSocket should extract and verify token from query', async () => {
      const reg = await registerUser('ws@example.com', 'password123', mockConfig);

      const payload = authenticateWebSocket(`token=${reg.token}`, mockConfig);

      assert.strictEqual(payload.email, 'ws@example.com');
    });

    test('authenticateWebSocket should throw on missing token', () => {
      assert.throws(
        () => authenticateWebSocket('other=value', mockConfig),
        (err: Error) => err.message.includes('Missing token'),
      );
    });
  });
});
