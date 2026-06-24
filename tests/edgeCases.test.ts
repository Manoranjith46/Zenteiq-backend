// Tests for Edge Case Handling
// Component 10: Edge Case Hardening

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { multiplexer } from '../src/logs/multiplexer';
import { readTail } from '../src/logs/backwardsReader';

const testDir = path.join(process.cwd(), '.test-edge-cases');

const mockConfig = {
  PORT: 3000,
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
  JWT_EXPIRES_IN: '24h',
  POLL_INTERVAL_MS: 100,
  TAIL_CHUNK_SIZE: 4096,
  LOGS_DIR: testDir,
  ALLOWED_EXTENSIONS: ['.log', '.txt'],
};

describe('Edge Case Hardening', () => {
  beforeEach(async () => {
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch {
      // Directory may exist
    }
  });

  afterEach(async () => {
    try {
      await multiplexer.closeAll();

      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch {
      // Cleanup error
    }
  });

  describe('Edge Case 1: Partial Writes (Line Buffering)', () => {
    test('should buffer incomplete lines until newline arrives', async () => {
      const filePath = path.join(testDir, 'partial.log');
      await fs.writeFile(filePath, 'line1\n');

      const watcher = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);

      // Simulate partial write (no newline)
      await fs.appendFile(filePath, 'incomplete');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Incomplete line should be in buffer, not yet broadcast
      assert.strictEqual(watcher.lineBuffer, 'incomplete');

      // Complete the line
      await fs.appendFile(filePath, ' line\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now it should be cleared (sent to clients)
      assert.strictEqual(watcher.lineBuffer, '');
    });

    test('should handle multiple partial writes', async () => {
      const filePath = path.join(testDir, 'multi_partial.log');
      await fs.writeFile(filePath, 'start\n');

      const watcher = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);

      // Write in fragments
      await fs.appendFile(filePath, 'part');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(watcher.lineBuffer, 'part');

      await fs.appendFile(filePath, '1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(watcher.lineBuffer, 'part1');

      await fs.appendFile(filePath, ' complete\n');
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.strictEqual(watcher.lineBuffer, '');
    });
  });

  describe('Edge Case 2: File Truncation', () => {
    test('should detect truncation and reset offset', async () => {
      const filePath = path.join(testDir, 'trunc.log');
      const content = 'line1\nline2\nline3\nline4\nline5\n';
      await fs.writeFile(filePath, content);

      const watcher = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);
      const initialOffset = watcher.offset;

      // Simulate having read the file
      watcher.offset = content.length;

      // Truncate file
      await fs.truncate(filePath, 0);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Offset should be reset to 0
      assert.strictEqual(watcher.offset, 0, 'offset should reset after truncation');
    });

    test('should stream new lines correctly after truncation', async () => {
      const filePath = path.join(testDir, 'trunc_stream.log');
      await fs.writeFile(filePath, 'old1\nold2\n');

      const watcher = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);

      // Move offset to end of file
      const stat = await fs.stat(filePath);
      watcher.offset = stat.size;

      // Truncate
      await fs.truncate(filePath, 0);
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Write new lines
      await fs.writeFile(filePath, 'new1\nnew2\nnew3\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify by reading tail - should get new lines
      const result = await readTail(filePath, 10, mockConfig.TAIL_CHUNK_SIZE);
      assert(result.lines.includes('new1'));
      assert(result.lines.includes('new2'));
      assert(result.lines.includes('new3'));
      assert(!result.lines.includes('old1'));
    });
  });

  describe('Edge Case 3: File Rotation', () => {
    test('should detect file rotation via inode change', async () => {
      const filePath = path.join(testDir, 'rotate.log');
      const backupPath = path.join(testDir, 'rotate.log.1');

      await fs.writeFile(filePath, 'original\n');

      const watcher = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);
      const originalInode = watcher.inode;

      // Simulate rotation: move old file, create new one
      await fs.rename(filePath, backupPath);
      await fs.writeFile(filePath, 'rotated\n');

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Inode should have changed (if not on Windows where inode=0)
      if (originalInode !== 0) {
        assert.notStrictEqual(watcher.inode, originalInode, 'inode should change after rotation');
      }

      // Offset should be reset
      assert.strictEqual(watcher.offset, 0, 'offset should reset after rotation');
    });

    test('should stream new file content after rotation', async () => {
      const filePath = path.join(testDir, 'rotate_stream.log');
      const backupPath = path.join(testDir, 'rotate_stream.log.1');

      await fs.writeFile(filePath, 'original_line\n');

      await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);

      // Rotate
      await fs.rename(filePath, backupPath);
      await fs.writeFile(filePath, 'new_line_1\nnew_line_2\n');

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify new content is available
      const result = await readTail(filePath, 10, mockConfig.TAIL_CHUNK_SIZE);
      assert(result.lines.includes('new_line_1'));
      assert(result.lines.includes('new_line_2'));
      assert(!result.lines.includes('original_line'));
    });
  });

  describe('Edge Case 4: Simultaneous Multiple Clients', () => {
    test('should maintain single watcher for multiple clients', async () => {
      const filePath = path.join(testDir, 'multi_client.log');
      await fs.writeFile(filePath, 'test\n');

      // Mock multiple clients
      const mockClients = [];
      for (let i = 0; i < 5; i++) {
        const client = { readyState: 1, send: () => {}, close: () => {} } as any;
        mockClients.push(client);
      }

      // Get watcher multiple times (simulating multiple client connections)
      const watcher1 = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);
      const watcher2 = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);
      const watcher3 = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);

      // Should all be the same watcher instance
      assert.strictEqual(watcher1, watcher2);
      assert.strictEqual(watcher2, watcher3);

      // Add all clients
      for (const client of mockClients) {
        multiplexer.addClient(filePath, client);
      }

      // Should have exactly 1 watcher with 5 clients
      assert.strictEqual(multiplexer.getWatcherCount(), 1);
      assert.strictEqual(multiplexer.getTotalClients(), 5);
    });

    test('should cleanup watcher only when last client disconnects', async () => {
      const filePath = path.join(testDir, 'cleanup_test.log');
      await fs.writeFile(filePath, 'test\n');

      const mockClients = [];
      for (let i = 0; i < 3; i++) {
        const client = { readyState: 1, send: () => {}, close: () => {} } as any;
        mockClients.push(client);
      }

      const watcher = await multiplexer.getWatcher(filePath, mockConfig.POLL_INTERVAL_MS);

      for (const client of mockClients) {
        multiplexer.addClient(filePath, client);
      }

      assert.strictEqual(multiplexer.getWatcherCount(), 1);

      // Remove first client
      await multiplexer.removeClient(filePath, mockClients[0]);
      assert.strictEqual(multiplexer.getWatcherCount(), 1, 'watcher should still exist');

      // Remove second client
      await multiplexer.removeClient(filePath, mockClients[1]);
      assert.strictEqual(multiplexer.getWatcherCount(), 1, 'watcher should still exist');

      // Remove last client
      await multiplexer.removeClient(filePath, mockClients[2]);
      assert.strictEqual(multiplexer.getWatcherCount(), 0, 'watcher should be removed');
    });
  });

  describe('Edge Case 5: Empty and Very Small Files', () => {
    test('should handle empty file correctly', async () => {
      const filePath = path.join(testDir, 'empty.log');
      await fs.writeFile(filePath, '');

      const result = await readTail(filePath, 10, mockConfig.TAIL_CHUNK_SIZE);

      assert.strictEqual(result.lines.length, 0);
      assert.strictEqual(result.endOffset, 0);
    });

    test('should handle file with single line', async () => {
      const filePath = path.join(testDir, 'single.log');
      await fs.writeFile(filePath, 'only line\n');

      const result = await readTail(filePath, 10, mockConfig.TAIL_CHUNK_SIZE);

      assert.strictEqual(result.lines.length, 1);
      assert.strictEqual(result.lines[0], 'only line');
    });

    test('should handle file with no trailing newline', async () => {
      const filePath = path.join(testDir, 'no_newline.log');
      await fs.writeFile(filePath, 'line without newline');

      const result = await readTail(filePath, 10, mockConfig.TAIL_CHUNK_SIZE);

      assert.strictEqual(result.lines.length, 1);
      assert.strictEqual(result.lines[0], 'line without newline');
    });
  });

  describe('Edge Case 6: Unicode and Special Characters', () => {
    test('should handle UTF-8 characters correctly', async () => {
      const filePath = path.join(testDir, 'unicode.log');
      const content = 'ASCII line\nUnicode: 你好\nEmoji: 🎉\nRussian: Привет\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 10, mockConfig.TAIL_CHUNK_SIZE);

      assert(result.lines.some((l) => l.includes('你好')));
      assert(result.lines.some((l) => l.includes('🎉')));
      assert(result.lines.some((l) => l.includes('Привет')));
    });
  });

  describe('Edge Case 7: Very Large Line Counts', () => {
    test('should handle file with many lines efficiently', async () => {
      const filePath = path.join(testDir, 'many_lines.log');
      const lines = [];
      for (let i = 0; i < 1000; i++) {
        lines.push(`line ${i}`);
      }
      await fs.writeFile(filePath, lines.join('\n') + '\n');

      const result = await readTail(filePath, 50, mockConfig.TAIL_CHUNK_SIZE);

      assert.strictEqual(result.lines.length, 50);
      assert(result.lines[0].includes('950'));
      assert(result.lines[49].includes('999'));
    });
  });
});
