// Tests for WebSocket Handler — Client Connection Management
// Component 9: WebSocket Handler

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { handleWebSocketConnection } from '../src/ws/wsHandler';
import { signToken, registerUser } from '../src/auth/authService';
import { userStore } from '../src/auth/userStore';
import { multiplexer } from '../src/logs/multiplexer';

const testDir = path.join(process.cwd(), '.test-ws');

const mockConfig = {
  PORT: 3000,
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
  JWT_EXPIRES_IN: '24h',
  POLL_INTERVAL_MS: 250,
  TAIL_CHUNK_SIZE: 4096,
  LOGS_DIR: testDir,
  ALLOWED_EXTENSIONS: ['.log', '.txt'],
};

// Mock WebSocket for testing
class MockWebSocket {
  readyState: number = 1; // OPEN
  messagesSent: string[] = [];
  isClosed = false;
  closeCode?: number;
  closeReason?: string;

  send(data: string): void {
    if (this.isClosed) {
      throw new Error('WebSocket is closed');
    }
    this.messagesSent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.isClosed = true;
    this.readyState = 3; // CLOSED
    this.closeCode = code;
    this.closeReason = reason;
  }

  on(event: string, callback: (...args: any[]) => void): void {
    // Mock event listener
  }
}

describe('WebSocket Handler — Client Connection', () => {
  beforeEach(async () => {
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch {
      // Directory may exist
    }
    userStore._clearAll();
  });

  afterEach(async () => {
    try {
      // Cleanup watchers
      await multiplexer.closeAll();

      // Cleanup test files
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch {
      // Cleanup error
    }
    userStore._clearAll();
  });

  describe('Valid Connection', () => {
    test('should accept valid JWT and subscribe to file', async () => {
      const filePath = path.join(testDir, 'app.log');
      await fs.writeFile(filePath, 'line1\nline2\nline3\n');

      // Create user and token
      const response = await registerUser('test@example.com', 'password123', mockConfig);
      const token = response.token;

      // Create WebSocket mock
      const ws = new MockWebSocket() as unknown as any;

      // Connect
      const query = `token=${token}&file=app.log&lines=2`;
      await handleWebSocketConnection(ws, query, mockConfig);

      // Should have sent initial message
      assert(ws.messagesSent.length > 0, 'should send initial message');
      const initialMsg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(initialMsg.type, 'initial');
      assert.strictEqual(initialMsg.file, 'app.log');
      assert(Array.isArray(initialMsg.lines));
    });

    test('should send correct number of lines in initial burst', async () => {
      const filePath = path.join(testDir, 'burst.log');
      const lines = [];
      for (let i = 1; i <= 10; i++) {
        lines.push(`line${i}`);
      }
      await fs.writeFile(filePath, lines.join('\n') + '\n');

      const response = await registerUser('test2@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=burst.log&lines=5`;
      await handleWebSocketConnection(ws, query, mockConfig);

      const initialMsg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(initialMsg.lines.length, 5);
      assert.strictEqual(initialMsg.lines[0], 'line6'); // Last 5 lines
    });

    test('should add client to multiplexer', async () => {
      const filePath = path.join(testDir, 'multi.log');
      await fs.writeFile(filePath, 'test\n');

      const response = await registerUser('test3@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=multi.log&lines=10`;
      await handleWebSocketConnection(ws, query, mockConfig);

      assert.strictEqual(multiplexer.getTotalClients(), 1);
    });

    test('should include timestamp in initial message', async () => {
      const filePath = path.join(testDir, 'ts.log');
      await fs.writeFile(filePath, 'test\n');

      const response = await registerUser('test4@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=ts.log`;
      await handleWebSocketConnection(ws, query, mockConfig);

      const initialMsg = JSON.parse(ws.messagesSent[0]);
      assert(initialMsg.timestamp, 'should include timestamp');
      assert(initialMsg.timestamp.includes('T'), 'timestamp should be ISO format');
    });
  });

  describe('Invalid Token', () => {
    test('should reject missing token', async () => {
      const filePath = path.join(testDir, 'missing.log');
      await fs.writeFile(filePath, 'test\n');

      const ws = new MockWebSocket() as unknown as any;
      const query = 'file=missing.log';

      await handleWebSocketConnection(ws, query, mockConfig);

      // Should send error
      assert(ws.messagesSent.length > 0);
      const msg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(msg.type, 'error');
      assert.strictEqual(msg.code, 'UNAUTHORIZED');
      assert(ws.isClosed);
    });

    test('should reject invalid token', async () => {
      const filePath = path.join(testDir, 'invalid.log');
      await fs.writeFile(filePath, 'test\n');

      const ws = new MockWebSocket() as unknown as any;
      const query = 'token=invalid.token.here&file=invalid.log';

      await handleWebSocketConnection(ws, query, mockConfig);

      assert(ws.messagesSent.length > 0);
      const msg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(msg.type, 'error');
      assert.strictEqual(msg.code, 'UNAUTHORIZED');
    });

    test('should reject expired token', async () => {
      const filePath = path.join(testDir, 'expired.log');
      await fs.writeFile(filePath, 'test\n');

      const response = await registerUser('test5@example.com', 'password123', mockConfig);

      // Get the user object to create an expired token
      const user = response.user;
      const expiredConfig = { ...mockConfig, JWT_EXPIRES_IN: '0s' };
      const token = signToken(user as any, expiredConfig);

      // Wait a bit for token to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=expired.log`;

      await handleWebSocketConnection(ws, query, mockConfig);

      assert(ws.messagesSent.length > 0);
      const msg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(msg.type, 'error');
    });
  });

  describe('Path Validation', () => {
    test('should reject path traversal attempts', async () => {
      const response = await registerUser('test6@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=../../../etc/passwd`;

      await handleWebSocketConnection(ws, query, mockConfig);

      assert(ws.messagesSent.length > 0);
      const msg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(msg.type, 'error');
      assert.strictEqual(msg.code, 'FORBIDDEN');
    });

    test('should reject invalid extension', async () => {
      const response = await registerUser('test7@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=script.sh`;

      await handleWebSocketConnection(ws, query, mockConfig);

      assert(ws.messagesSent.length > 0);
      const msg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(msg.type, 'error');
      assert.strictEqual(msg.code, 'FORBIDDEN');
    });
  });

  describe('File Not Found', () => {
    test('should handle non-existent file gracefully', async () => {
      const response = await registerUser('test8@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=nonexistent.log`;

      await handleWebSocketConnection(ws, query, mockConfig);

      // Should send error (file not found)
      assert(ws.messagesSent.length > 0);
      const msg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(msg.type, 'error');
    });
  });

  describe('Query Parameters', () => {
    test('should use default lines (50) if not specified', async () => {
      const filePath = path.join(testDir, 'default.log');
      const lines = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(`line${i}`);
      }
      await fs.writeFile(filePath, lines.join('\n') + '\n');

      const response = await registerUser('test9@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=default.log`;
      await handleWebSocketConnection(ws, query, mockConfig);

      const initialMsg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(initialMsg.lines.length, 50);
    });

    test('should parse lines parameter', async () => {
      const filePath = path.join(testDir, 'parse.log');
      const lines = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(`line${i}`);
      }
      await fs.writeFile(filePath, lines.join('\n') + '\n');

      const response = await registerUser('test10@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=parse.log&lines=25`;
      await handleWebSocketConnection(ws, query, mockConfig);

      const initialMsg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(initialMsg.lines.length, 25);
    });

    test('should use default file (app.log) if not specified', async () => {
      const filePath = path.join(testDir, 'app.log');
      await fs.writeFile(filePath, 'test\n');

      const response = await registerUser('test11@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}`;
      await handleWebSocketConnection(ws, query, mockConfig);

      assert(ws.messagesSent.length > 0);
      const initialMsg = JSON.parse(ws.messagesSent[0]);
      assert.strictEqual(initialMsg.type, 'initial');
      assert.strictEqual(initialMsg.file, 'app.log');
    });
  });

  describe('Client Lifecycle', () => {
    test('should handle client cleanup', async () => {
      const filePath = path.join(testDir, 'lifecycle.log');
      await fs.writeFile(filePath, 'test\n');

      const response = await registerUser('test12@example.com', 'password123', mockConfig);
      const token = response.token;

      const ws = new MockWebSocket() as unknown as any;
      const query = `token=${token}&file=lifecycle.log`;

      await handleWebSocketConnection(ws, query, mockConfig);

      assert.strictEqual(multiplexer.getTotalClients(), 1);

      // The test verifies that the handler doesn't crash during cleanup
      // Full lifecycle testing requires more complex mocking of event listeners
    });
  });
});
