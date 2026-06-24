"use strict";
// Tests for Path Guard — Security Module
// Component 3: Path Guard
// Tests security controls against directory traversal and injection attacks
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = __importDefault(require("node:assert"));
const pathGuard_1 = require("../dist/utils/pathGuard");
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
(0, node_test_1.describe)('Path Guard Security Module', () => {
    (0, node_test_1.describe)('validateFilename - Valid cases', () => {
        (0, node_test_1.test)('should accept valid log filename', () => {
            node_assert_1.default.doesNotThrow(() => {
                (0, pathGuard_1.validateFilename)('app.log', mockConfig.ALLOWED_EXTENSIONS);
            });
        });
        (0, node_test_1.test)('should accept filename with dashes', () => {
            node_assert_1.default.doesNotThrow(() => {
                (0, pathGuard_1.validateFilename)('app-logs.log', mockConfig.ALLOWED_EXTENSIONS);
            });
        });
        (0, node_test_1.test)('should accept filename with underscores', () => {
            node_assert_1.default.doesNotThrow(() => {
                (0, pathGuard_1.validateFilename)('app_error.log', mockConfig.ALLOWED_EXTENSIONS);
            });
        });
        (0, node_test_1.test)('should accept filename with multiple dots', () => {
            node_assert_1.default.doesNotThrow(() => {
                (0, pathGuard_1.validateFilename)('app.2024.06.24.log', mockConfig.ALLOWED_EXTENSIONS);
            });
        });
        (0, node_test_1.test)('should accept .txt extension', () => {
            node_assert_1.default.doesNotThrow(() => {
                (0, pathGuard_1.validateFilename)('readme.txt', mockConfig.ALLOWED_EXTENSIONS);
            });
        });
    });
    (0, node_test_1.describe)('validateFilename - Invalid cases', () => {
        (0, node_test_1.test)('should reject empty filename', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('empty'));
        });
        (0, node_test_1.test)('should reject hidden files (start with dot)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('.env.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('start with dot'));
        });
        (0, node_test_1.test)('should reject hidden files (.ssh)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('.ssh', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject invalid extension', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app.exe', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('not allowed'));
        });
        (0, node_test_1.test)('should reject filename with forward slashes', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app/error.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('invalid characters'));
        });
        (0, node_test_1.test)('should reject filename with backslashes', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app\\error.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('invalid characters'));
        });
        (0, node_test_1.test)('should reject filename with spaces', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app error.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('invalid characters'));
        });
        (0, node_test_1.test)('should reject filename with special characters', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app@error.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError && err.message.includes('invalid characters'));
        });
        (0, node_test_1.test)('should reject filename with semicolon (injection)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app;rm rf.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject filename with pipe character', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app|cat.log', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
    });
    (0, node_test_1.describe)('resolveAndGuard - Directory traversal attacks', () => {
        (0, node_test_1.test)('should reject parent directory traversal (..)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.resolveAndGuard)('../../../etc/passwd', mockConfig);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject parent directory traversal (.. with extension)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.resolveAndGuard)('../app.log', mockConfig);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject URL-encoded traversal (%2F%2E%2E = /../)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.resolveAndGuard)('%2F%2E%2E%2Fetc%2Fpasswd', mockConfig);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject double-encoded traversal (%252F = %/)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.resolveAndGuard)('%252E%252E%252Fetc%252Fpasswd', mockConfig);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject absolute path traversal (/etc/passwd)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.resolveAndGuard)('/etc/passwd', mockConfig);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject backslash traversal on Windows (..\\..)', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.resolveAndGuard)('..\\..\\windows\\system32', mockConfig);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
        (0, node_test_1.test)('should reject null byte injection', () => {
            node_assert_1.default.throws(() => {
                (0, pathGuard_1.validateFilename)('app.log\x00.txt', mockConfig.ALLOWED_EXTENSIONS);
            }, (err) => err instanceof pathGuard_1.SecurityError);
        });
    });
    (0, node_test_1.describe)('resolveAndGuard - Valid cases', () => {
        (0, node_test_1.test)('should accept valid filename', () => {
            node_assert_1.default.doesNotThrow(() => {
                const resolved = (0, pathGuard_1.resolveAndGuard)('app.log', mockConfig);
                (0, node_assert_1.default)(resolved.includes('logs'), 'resolved path should contain logs directory');
                (0, node_assert_1.default)(resolved.endsWith('app.log'), 'resolved path should end with filename');
            });
        });
        (0, node_test_1.test)('should accept filename with date pattern', () => {
            node_assert_1.default.doesNotThrow(() => {
                const resolved = (0, pathGuard_1.resolveAndGuard)('app.2024.06.24.log', mockConfig);
                (0, node_assert_1.default)(resolved.includes('app.2024.06.24.log'));
            });
        });
        (0, node_test_1.test)('should handle URL-encoded valid filenames', () => {
            node_assert_1.default.doesNotThrow(() => {
                const resolved = (0, pathGuard_1.resolveAndGuard)('app%20test.log', mockConfig);
                (0, node_assert_1.default)(resolved, 'should return a resolved path');
            });
        });
    });
    (0, node_test_1.describe)('extractFilename utility', () => {
        (0, node_test_1.test)('should extract filename from full path', () => {
            const filename = (0, pathGuard_1.extractFilename)('/some/path/logs/app.log');
            node_assert_1.default.strictEqual(filename, 'app.log');
        });
        (0, node_test_1.test)('should extract filename from Windows path', () => {
            const filename = (0, pathGuard_1.extractFilename)('C:\\logs\\error.log');
            node_assert_1.default.strictEqual(filename, 'error.log');
        });
    });
    (0, node_test_1.describe)('SecurityError class', () => {
        (0, node_test_1.test)('should create SecurityError with message', () => {
            const err = new pathGuard_1.SecurityError('Test error');
            node_assert_1.default.strictEqual(err.name, 'SecurityError');
            node_assert_1.default.strictEqual(err.message, 'Test error');
            (0, node_assert_1.default)(err instanceof Error);
        });
    });
});
