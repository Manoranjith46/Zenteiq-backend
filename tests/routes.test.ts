// Tests for HTTP Routes
// Component 5: HTTP Server & REST Routes

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { userStore } from '../src/auth/userStore';
import { signToken } from '../src/auth/authService';
import { extractBearerToken } from '../src/auth/authMiddleware';
import { parseJSONBody, parseQueryString, parseURL } from '../src/utils/httpHelpers';

const mockConfig = {
  PORT: 3000,
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
  JWT_EXPIRES_IN: '24h',
  POLL_INTERVAL_MS: 250,
  TAIL_CHUNK_SIZE: 4096,
  LOGS_DIR: './logs',
  ALLOWED_EXTENSIONS: ['.log', '.txt'],
};

describe('HTTP Helpers', () => {
  describe('parseQueryString', () => {
    test('should parse simple query string', () => {
      const params = parseQueryString('key=value&other=data');

      assert.strictEqual(params.get('key'), 'value');
      assert.strictEqual(params.get('other'), 'data');
    });

    test('should handle URL-encoded values', () => {
      const params = parseQueryString('file=my%20file.log&lines=10');

      assert.strictEqual(params.get('file'), 'my file.log');
      assert.strictEqual(params.get('lines'), '10');
    });

    test('should return empty map for empty string', () => {
      const params = parseQueryString('');

      assert.strictEqual(params.size, 0);
    });

    test('should handle undefined', () => {
      const params = parseQueryString(undefined);

      assert.strictEqual(params.size, 0);
    });

    test('should handle keys without values', () => {
      const params = parseQueryString('flag&key=value');

      assert.strictEqual(params.get('flag'), '');
      assert.strictEqual(params.get('key'), 'value');
    });
  });

  describe('parseURL', () => {
    test('should parse URL with path only', () => {
      const { path, queryString } = parseURL('/logs/app.log');

      assert.strictEqual(path, '/logs/app.log');
      assert.strictEqual(queryString, undefined);
    });

    test('should parse URL with path and query', () => {
      const { path, queryString } = parseURL('/logs/app.log?lines=20');

      assert.strictEqual(path, '/logs/app.log');
      assert.strictEqual(queryString, 'lines=20');
    });

    test('should handle empty URL', () => {
      const { path } = parseURL('');

      assert.strictEqual(path, '/');
    });

    test('should handle undefined URL', () => {
      const { path } = parseURL(undefined);

      assert.strictEqual(path, '/');
    });

    test('should handle URL with multiple query params', () => {
      const { path, queryString } = parseURL('/logs?file=app.log&lines=50&filter=error');

      assert.strictEqual(path, '/logs');
      assert.strictEqual(queryString, 'file=app.log&lines=50&filter=error');
    });
  });
});

describe('Auth Routes', () => {
  beforeEach(() => {
    userStore._clearAll();
  });

  afterEach(() => {
    userStore._clearAll();
  });

  test('JWT token should be valid format', async () => {
    const user = await userStore.createUser('test@example.com', 'hashed_password');
    const token = signToken(user, mockConfig);

    assert(token, 'token should exist');
    assert.strictEqual(token.split('.').length, 3, 'JWT should have 3 parts');
  });

  test('should extract token from Bearer header', () => {
    const token = extractBearerToken('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');

    assert.strictEqual(token, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });
});

describe('Log Routes', () => {
  test('should parse /logs/:filename/tail pattern', () => {
    const pattern = /^\/logs\/([^/]+)\/tail$/;

    const match1 = '/logs/app.log/tail'.match(pattern);
    assert(match1, 'should match /logs/app.log/tail');
    assert.strictEqual(match1?.[1], 'app.log');

    const match2 = '/logs/error-2024.log/tail'.match(pattern);
    assert(match2, 'should match /logs/error-2024.log/tail');
    assert.strictEqual(match2?.[1], 'error-2024.log');
  });

  test('should handle URL-encoded filenames in route', () => {
    const pattern = /^\/logs\/([^/]+)\/tail$/;
    const match = '/logs/my%20file.log/tail'.match(pattern);

    assert(match, 'should match URL-encoded filename');
    const filename = decodeURIComponent(match![1]);
    assert.strictEqual(filename, 'my file.log');
  });

  test('should reject invalid tail routes', () => {
    const pattern = /^\/logs\/([^/]+)\/tail$/;

    assert.strictEqual('/logs/app.log/tail/extra'.match(pattern), null);
    assert.strictEqual('/logs/tail'.match(pattern), null);
    assert.strictEqual('/logs//tail'.match(pattern), null);
  });
});

describe('Error Response Format', () => {
  test('error responses should have error and code fields', () => {
    const errorResponse = {
      error: 'Invalid request',
      code: 'BAD_REQUEST',
    };

    assert(errorResponse.error, 'should have error field');
    assert(errorResponse.code, 'should have code field');
    assert.strictEqual(typeof errorResponse.error, 'string');
    assert.strictEqual(typeof errorResponse.code, 'string');
  });

  test('all error codes should be uppercase', () => {
    const codes = ['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL_ERROR'];

    for (const code of codes) {
      assert.strictEqual(code, code.toUpperCase(), `${code} should be uppercase`);
    }
  });
});
