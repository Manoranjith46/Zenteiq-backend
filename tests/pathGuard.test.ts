// Tests for Path Guard — Security Module
// Component 3: Path Guard
// Tests security controls against directory traversal and injection attacks

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { resolveAndGuard, validateFilename, SecurityError, extractFilename } from '../src/utils/pathGuard';

// Create a mock config for testing
const mockConfig = {
  PORT: 3000,
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '24h',
  POLL_INTERVAL_MS: 250,
  TAIL_CHUNK_SIZE: 4096,
  LOGS_DIR: './logs',
  ALLOWED_EXTENSIONS: ['.log', '.txt'],
};

describe('Path Guard Security Module', () => {
  describe('validateFilename - Valid cases', () => {
    test('should accept valid log filename', () => {
      assert.doesNotThrow(() => {
        validateFilename('app.log', mockConfig.ALLOWED_EXTENSIONS);
      });
    });

    test('should accept filename with dashes', () => {
      assert.doesNotThrow(() => {
        validateFilename('app-logs.log', mockConfig.ALLOWED_EXTENSIONS);
      });
    });

    test('should accept filename with underscores', () => {
      assert.doesNotThrow(() => {
        validateFilename('app_error.log', mockConfig.ALLOWED_EXTENSIONS);
      });
    });

    test('should accept filename with multiple dots', () => {
      assert.doesNotThrow(() => {
        validateFilename('app.2024.06.24.log', mockConfig.ALLOWED_EXTENSIONS);
      });
    });

    test('should accept .txt extension', () => {
      assert.doesNotThrow(() => {
        validateFilename('readme.txt', mockConfig.ALLOWED_EXTENSIONS);
      });
    });
  });

  describe('validateFilename - Invalid cases', () => {
    test('should reject empty filename', () => {
      assert.throws(
        () => {
          validateFilename('', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('empty'),
      );
    });

    test('should reject hidden files (start with dot)', () => {
      assert.throws(
        () => {
          validateFilename('.env.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('start with dot'),
      );
    });

    test('should reject hidden files (.ssh)', () => {
      assert.throws(
        () => {
          validateFilename('.ssh', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should reject invalid extension', () => {
      assert.throws(
        () => {
          validateFilename('app.exe', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('not allowed'),
      );
    });

    test('should reject filename with forward slashes', () => {
      assert.throws(
        () => {
          validateFilename('app/error.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('invalid characters'),
      );
    });

    test('should reject filename with backslashes', () => {
      assert.throws(
        () => {
          validateFilename('app\\error.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('invalid characters'),
      );
    });

    test('should reject filename with spaces', () => {
      assert.throws(
        () => {
          validateFilename('app error.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('invalid characters'),
      );
    });

    test('should reject filename with special characters', () => {
      assert.throws(
        () => {
          validateFilename('app@error.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError && err.message.includes('invalid characters'),
      );
    });

    test('should reject filename with semicolon (injection)', () => {
      assert.throws(
        () => {
          validateFilename('app;rm rf.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should reject filename with pipe character', () => {
      assert.throws(
        () => {
          validateFilename('app|cat.log', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });
  });

  describe('resolveAndGuard - Directory traversal attacks', () => {
    test('should reject parent directory traversal (..)', () => {
      assert.throws(
        () => {
          resolveAndGuard('../../../etc/passwd', mockConfig);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should normalize parent directory traversal by extracting basename', () => {
      // path.basename('../app.log') = 'app.log', which is valid
      // This is secure because we only use the filename part
      assert.doesNotThrow(() => {
        const resolved = resolveAndGuard('../app.log', mockConfig);
        assert(resolved.includes('app.log'));
      });
    });

    test('should reject URL-encoded traversal (%2F%2E%2E = /../)', () => {
      assert.throws(
        () => {
          resolveAndGuard('%2F%2E%2E%2Fetc%2Fpasswd', mockConfig);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should reject double-encoded traversal (%252F = %/)', () => {
      assert.throws(
        () => {
          resolveAndGuard('%252E%252E%252Fetc%252Fpasswd', mockConfig);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should reject absolute path traversal (/etc/passwd)', () => {
      assert.throws(
        () => {
          resolveAndGuard('/etc/passwd', mockConfig);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should reject backslash traversal on Windows (..\\..)', () => {
      assert.throws(
        () => {
          resolveAndGuard('..\\..\\windows\\system32', mockConfig);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });

    test('should reject null byte injection', () => {
      assert.throws(
        () => {
          validateFilename('app.log\x00.txt', mockConfig.ALLOWED_EXTENSIONS);
        },
        (err: Error) => err instanceof SecurityError,
      );
    });
  });

  describe('resolveAndGuard - Valid cases', () => {
    test('should accept valid filename', () => {
      assert.doesNotThrow(() => {
        const resolved = resolveAndGuard('app.log', mockConfig);
        assert(resolved.includes('logs'), 'resolved path should contain logs directory');
        assert(resolved.endsWith('app.log'), 'resolved path should end with filename');
      });
    });

    test('should accept filename with date pattern', () => {
      assert.doesNotThrow(() => {
        const resolved = resolveAndGuard('app.2024.06.24.log', mockConfig);
        assert(resolved.includes('app.2024.06.24.log'));
      });
    });

    test('should accept filename with dashes in URL-encoded form', () => {
      assert.doesNotThrow(() => {
        // %2D is URL-encoded dash, which decodes to '-' (valid character)
        const resolved = resolveAndGuard('app%2Dtest.log', mockConfig);
        assert(resolved.includes('app-test.log'));
      });
    });
  });

  describe('extractFilename utility', () => {
    test('should extract filename from full path', () => {
      const filename = extractFilename('/some/path/logs/app.log');
      assert.strictEqual(filename, 'app.log');
    });

    test('should extract filename from Windows path', () => {
      const filename = extractFilename('C:\\logs\\error.log');
      assert.strictEqual(filename, 'error.log');
    });
  });

  describe('SecurityError class', () => {
    test('should create SecurityError with message', () => {
      const err = new SecurityError('Test error');
      assert.strictEqual(err.name, 'SecurityError');
      assert.strictEqual(err.message, 'Test error');
      assert(err instanceof Error);
    });
  });
});
