// Tests for Poll Engine — File Monitoring
// Component 7: Poll Engine

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { createWatcher, closeWatcher, pollFile, startPolling, stopPolling } from '../src/logs/pollEngine';
import { WebSocket } from 'ws';

const testDir = path.join(process.cwd(), '.test-watcher');

// Mock WebSocket for testing
class MockWebSocket {
  readyState: number = 1; // OPEN
  messagesSent: string[] = [];

  send(data: string): void {
    this.messagesSent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }
}

describe('Poll Engine — File Monitoring', () => {
  beforeEach(async () => {
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch {
      // Directory may exist
    }
  });

  afterEach(async () => {
    try {
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch {
      // Directory cleanup error
    }
  });

  describe('createWatcher', () => {
    test('should create watcher with correct initial state', async () => {
      const filePath = path.join(testDir, 'test.log');
      await fs.writeFile(filePath, 'line1\nline2\nline3\n');

      const watcher = await createWatcher(filePath);

      try {
        assert(watcher.fd, 'fd should be open');
        assert.strictEqual(watcher.absPath, filePath);
        assert.strictEqual(watcher.offset, 0);
        assert.strictEqual(watcher.size, 18); // 'line1\nline2\nline3\n' = 18 bytes
        assert.strictEqual(watcher.lineBuffer, '');
        assert.strictEqual(watcher.clients.size, 0);
        assert.strictEqual(watcher.pollTimer, null);
      } finally {
        await closeWatcher(watcher);
      }
    });

    test('should throw on non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.log');

      assert.rejects(() => createWatcher(filePath), (err: Error) =>
        err.message.includes('Failed to create watcher'),
      );
    });
  });

  describe('closeWatcher', () => {
    test('should close file descriptor', async () => {
      const filePath = path.join(testDir, 'test.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await createWatcher(filePath);

      await closeWatcher(watcher);

      assert.strictEqual(watcher.fd, null);
      assert.strictEqual(watcher.clients.size, 0);
    });

    test('should clear poll timer', async () => {
      const filePath = path.join(testDir, 'test.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await createWatcher(filePath);
      startPolling(watcher, 'test.log', 100);

      assert(watcher.pollTimer, 'pollTimer should be set');

      await closeWatcher(watcher);

      assert.strictEqual(watcher.pollTimer, null);
    });
  });

  describe('pollFile - Append Detection', () => {
    test('should detect file append', async () => {
      const filePath = path.join(testDir, 'append.log');
      await fs.writeFile(filePath, 'line1\nline2\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        // Append new content
        await fs.appendFile(filePath, 'line3\nline4\n');

        await pollFile(watcher, 'append.log');

        assert(mockClient.messagesSent.length > 0, 'should broadcast to client');
        const message = JSON.parse(mockClient.messagesSent[0]);
        assert.strictEqual(message.type, 'append');
        assert(Array.isArray(message.lines), 'should have lines array');
        assert(message.lines.length >= 2);
      } finally {
        await closeWatcher(watcher);
      }
    });

    test('should handle partial line correctly', async () => {
      const filePath = path.join(testDir, 'partial.log');
      await fs.writeFile(filePath, 'line1\nline2\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        // Simulate that we've already consumed the initial content
        watcher.offset = 12; // Size of 'line1\nline2\n'

        // Append incomplete line (no newline)
        await fs.appendFile(filePath, 'incomplete');

        await pollFile(watcher, 'partial.log');

        // Should not broadcast incomplete line
        assert.strictEqual(mockClient.messagesSent.length, 0, 'should not broadcast incomplete line');
        assert.strictEqual(watcher.lineBuffer, 'incomplete', 'incomplete line should be in buffer');

        // Now complete the line
        mockClient.messagesSent = [];
        await fs.appendFile(filePath, 'line\n');

        await pollFile(watcher, 'partial.log');

        assert(mockClient.messagesSent.length > 0, 'should broadcast when line completes');
        const message = JSON.parse(mockClient.messagesSent[0]);
        assert(message.lines.some((l: string) => l === 'incompleteline'));
      } finally {
        await closeWatcher(watcher);
      }
    });

    test('should skip empty lines when appending', async () => {
      const filePath = path.join(testDir, 'empty_lines.log');
      await fs.writeFile(filePath, 'start\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        // Simulate that we've already consumed the initial 'start\n'
        watcher.offset = 6; // Size of 'start\n'

        // Append content with blank lines
        await fs.appendFile(filePath, '\nline\n\nline2\n');

        await pollFile(watcher, 'empty_lines.log');

        const message = JSON.parse(mockClient.messagesSent[0]);
        // Empty lines should be filtered out, leaving just 'line' and 'line2'
        assert.strictEqual(message.lines.length, 2);
        assert(message.lines.includes('line'));
        assert(message.lines.includes('line2'));
      } finally {
        await closeWatcher(watcher);
      }
    });
  });

  describe('pollFile - Truncation Detection', () => {
    test('should detect file truncation', async () => {
      const filePath = path.join(testDir, 'trunc.log');
      await fs.writeFile(filePath, 'line1\nline2\nline3\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        // Simulate reading past first line
        watcher.offset = 18; // Total size, simulating we've read everything

        // Truncate file
        await fs.truncate(filePath, 5);

        await pollFile(watcher, 'trunc.log');

        assert(mockClient.messagesSent.length > 0, 'should broadcast truncation');
        const message = JSON.parse(mockClient.messagesSent[0]);
        assert.strictEqual(message.type, 'truncated');
        assert.strictEqual(watcher.offset, 0, 'offset should reset to 0');
        assert.strictEqual(watcher.lineBuffer, '', 'lineBuffer should clear');
      } finally {
        await closeWatcher(watcher);
      }
    });
  });

  describe('pollFile - Rotation Detection', () => {
    test('should detect file rotation via inode change', async () => {
      const filePath = path.join(testDir, 'rotate.log');
      await fs.writeFile(filePath, 'original\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);
      const originalInode = watcher.inode;

      try {
        // Simulate file rotation: rename and create new file
        const backupPath = path.join(testDir, 'rotate.log.1');
        await fs.rename(filePath, backupPath);
        await fs.writeFile(filePath, 'rotated\n');

        await pollFile(watcher, 'rotate.log');

        assert(mockClient.messagesSent.length > 0, 'should broadcast rotation');
        const message = JSON.parse(mockClient.messagesSent[0]);
        assert.strictEqual(message.type, 'rotated');
        assert.notStrictEqual(watcher.inode, originalInode, 'inode should update');
        assert.strictEqual(watcher.offset, 0, 'offset should reset');
        assert.strictEqual(watcher.size, 8); // 'rotated\n'
      } finally {
        await closeWatcher(watcher);
      }
    });
  });

  describe('startPolling and stopPolling', () => {
    test('should start and stop polling loop', async () => {
      const filePath = path.join(testDir, 'poll.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await createWatcher(filePath);

      try {
        startPolling(watcher, 'poll.log', 50);
        assert(watcher.pollTimer, 'should set pollTimer');

        stopPolling(watcher);
        assert.strictEqual(watcher.pollTimer, null);
      } finally {
        await closeWatcher(watcher);
      }
    });

    test('should poll periodically', async () => {
      const filePath = path.join(testDir, 'periodic.log');
      await fs.writeFile(filePath, 'initial\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        startPolling(watcher, 'periodic.log', 50);

        // Wait for at least one poll cycle
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Append data
        await fs.appendFile(filePath, 'new\n');

        // Wait for poll to detect append
        await new Promise((resolve) => setTimeout(resolve, 150));

        assert(mockClient.messagesSent.length > 0, 'should detect appends via polling');

        stopPolling(watcher);
      } finally {
        await closeWatcher(watcher);
      }
    });
  });

  describe('Message Broadcasting', () => {
    test('should not send to closed WebSocket', async () => {
      const filePath = path.join(testDir, 'ws.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      mockClient.readyState = 3; // CLOSED
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        await fs.appendFile(filePath, 'new\n');
        await pollFile(watcher, 'ws.log');

        // Should not have sent to closed client
        assert.strictEqual(mockClient.messagesSent.length, 0);
      } finally {
        await closeWatcher(watcher);
      }
    });
  });

  describe('No Change Detection', () => {
    test('should not broadcast when file size unchanged', async () => {
      const filePath = path.join(testDir, 'unchanged.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await createWatcher(filePath);
      const mockClient = new MockWebSocket();
      watcher.clients.add(mockClient as unknown as WebSocket);

      try {
        // Poll without any changes
        await pollFile(watcher, 'unchanged.log');

        assert.strictEqual(mockClient.messagesSent.length, 0, 'should not broadcast on no change');
      } finally {
        await closeWatcher(watcher);
      }
    });
  });
});
