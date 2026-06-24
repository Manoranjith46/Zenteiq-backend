// Tests for Multiplexer — WatcherState Management
// Component 8: Multiplexer

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { multiplexer } from '../src/logs/multiplexer';
import { WebSocket } from 'ws';

const testDir = path.join(process.cwd(), '.test-multiplexer');

// Mock WebSocket for testing
class MockWebSocket {
  readyState: number = 1; // OPEN

  send(): void {
    // Mock implementation
  }
}

describe('Multiplexer — WatcherState Management', () => {
  beforeEach(async () => {
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch {
      // Directory may exist
    }
  });

  afterEach(async () => {
    try {
      // Cleanup all watchers
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
  });

  describe('getWatcher', () => {
    test('should create new watcher for new file', async () => {
      const filePath = path.join(testDir, 'test1.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);

      assert(watcher, 'watcher should be created');
      assert.strictEqual(watcher.absPath, filePath);
      assert.strictEqual(multiplexer.getWatcherCount(), 1);
    });

    test('should return same watcher for same file', async () => {
      const filePath = path.join(testDir, 'test2.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher1 = await multiplexer.getWatcher(filePath, 100);
      const watcher2 = await multiplexer.getWatcher(filePath, 100);

      assert.strictEqual(watcher1, watcher2, 'should return same watcher instance');
      assert.strictEqual(multiplexer.getWatcherCount(), 1, 'should have only one watcher');
    });

    test('should create separate watchers for different files', async () => {
      const file1 = path.join(testDir, 'file1.log');
      const file2 = path.join(testDir, 'file2.log');
      await fs.writeFile(file1, 'test1\n');
      await fs.writeFile(file2, 'test2\n');

      const watcher1 = await multiplexer.getWatcher(file1, 100);
      const watcher2 = await multiplexer.getWatcher(file2, 100);

      assert.notStrictEqual(watcher1, watcher2);
      assert.strictEqual(multiplexer.getWatcherCount(), 2);
    });
  });

  describe('addClient', () => {
    test('should add client to watcher', async () => {
      const filePath = path.join(testDir, 'add_client.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const client = new MockWebSocket() as unknown as WebSocket;

      const added = multiplexer.addClient(filePath, client);

      assert.strictEqual(added, true);
      assert.strictEqual(watcher.clients.size, 1);
    });

    test('should not add duplicate client', async () => {
      const filePath = path.join(testDir, 'dup_client.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const client = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(filePath, client);
      const added2 = multiplexer.addClient(filePath, client);

      assert.strictEqual(added2, false, 'should not add duplicate');
      assert.strictEqual(watcher.clients.size, 1, 'should still have only 1 client');
    });

    test('should add multiple different clients', async () => {
      const filePath = path.join(testDir, 'multi_client.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const client1 = new MockWebSocket() as unknown as WebSocket;
      const client2 = new MockWebSocket() as unknown as WebSocket;
      const client3 = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(filePath, client1);
      multiplexer.addClient(filePath, client2);
      multiplexer.addClient(filePath, client3);

      assert.strictEqual(watcher.clients.size, 3);
    });

    test('should return false if file not being watched', async () => {
      const filePath = path.join(testDir, 'not_watched.log');
      const client = new MockWebSocket() as unknown as WebSocket;

      const added = multiplexer.addClient(filePath, client);

      assert.strictEqual(added, false);
    });
  });

  describe('removeClient', () => {
    test('should remove client from watcher', async () => {
      const filePath = path.join(testDir, 'remove_client.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const client = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(filePath, client);
      assert.strictEqual(watcher.clients.size, 1);

      await multiplexer.removeClient(filePath, client);

      assert.strictEqual(watcher.clients.size, 0);
    });

    test('should cleanup watcher when last client removed', async () => {
      const filePath = path.join(testDir, 'cleanup.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const client = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(filePath, client);
      assert.strictEqual(multiplexer.getWatcherCount(), 1);

      await multiplexer.removeClient(filePath, client);

      assert.strictEqual(multiplexer.getWatcherCount(), 0, 'watcher should be removed');
    });

    test('should not cleanup if other clients still connected', async () => {
      const filePath = path.join(testDir, 'keep_watch.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const client1 = new MockWebSocket() as unknown as WebSocket;
      const client2 = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(filePath, client1);
      multiplexer.addClient(filePath, client2);

      await multiplexer.removeClient(filePath, client1);

      assert.strictEqual(multiplexer.getWatcherCount(), 1, 'watcher should still exist');
      assert.strictEqual(watcher.clients.size, 1);
    });

    test('should handle removing non-existent client', async () => {
      const filePath = path.join(testDir, 'remove_none.log');
      await fs.writeFile(filePath, 'test\n');

      const client = new MockWebSocket() as unknown as WebSocket;

      // Should not throw
      await multiplexer.removeClient(filePath, client);
      assert.strictEqual(multiplexer.getWatcherCount(), 0);
    });
  });

  describe('closeWatcher', () => {
    test('should close specific watcher', async () => {
      const filePath = path.join(testDir, 'close_watch.log');
      await fs.writeFile(filePath, 'test\n');

      await multiplexer.getWatcher(filePath, 100);
      assert.strictEqual(multiplexer.getWatcherCount(), 1);

      await multiplexer.closeWatcher(filePath);

      assert.strictEqual(multiplexer.getWatcherCount(), 0);
    });

    test('should not affect other watchers', async () => {
      const file1 = path.join(testDir, 'file1_close.log');
      const file2 = path.join(testDir, 'file2_close.log');
      await fs.writeFile(file1, 'test1\n');
      await fs.writeFile(file2, 'test2\n');

      await multiplexer.getWatcher(file1, 100);
      await multiplexer.getWatcher(file2, 100);

      await multiplexer.closeWatcher(file1);

      assert.strictEqual(multiplexer.getWatcherCount(), 1);
    });
  });

  describe('closeAll', () => {
    test('should close all watchers', async () => {
      const file1 = path.join(testDir, 'all1.log');
      const file2 = path.join(testDir, 'all2.log');
      const file3 = path.join(testDir, 'all3.log');
      await fs.writeFile(file1, 'test\n');
      await fs.writeFile(file2, 'test\n');
      await fs.writeFile(file3, 'test\n');

      await multiplexer.getWatcher(file1, 100);
      await multiplexer.getWatcher(file2, 100);
      await multiplexer.getWatcher(file3, 100);

      assert.strictEqual(multiplexer.getWatcherCount(), 3);

      await multiplexer.closeAll();

      assert.strictEqual(multiplexer.getWatcherCount(), 0);
    });
  });

  describe('Statistics', () => {
    test('getWatcherCount should return correct count', async () => {
      const file1 = path.join(testDir, 'stat1.log');
      const file2 = path.join(testDir, 'stat2.log');
      await fs.writeFile(file1, 'test\n');
      await fs.writeFile(file2, 'test\n');

      assert.strictEqual(multiplexer.getWatcherCount(), 0);

      await multiplexer.getWatcher(file1, 100);
      assert.strictEqual(multiplexer.getWatcherCount(), 1);

      await multiplexer.getWatcher(file2, 100);
      assert.strictEqual(multiplexer.getWatcherCount(), 2);
    });

    test('getTotalClients should count all clients', async () => {
      const file1 = path.join(testDir, 'total1.log');
      const file2 = path.join(testDir, 'total2.log');
      await fs.writeFile(file1, 'test\n');
      await fs.writeFile(file2, 'test\n');

      const watcher1 = await multiplexer.getWatcher(file1, 100);
      const watcher2 = await multiplexer.getWatcher(file2, 100);

      const c1 = new MockWebSocket() as unknown as WebSocket;
      const c2 = new MockWebSocket() as unknown as WebSocket;
      const c3 = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(file1, c1);
      multiplexer.addClient(file1, c2);
      multiplexer.addClient(file2, c3);

      assert.strictEqual(multiplexer.getTotalClients(), 3);
    });

    test('getClientCount should return per-file count', async () => {
      const file1 = path.join(testDir, 'count1.log');
      const file2 = path.join(testDir, 'count2.log');
      await fs.writeFile(file1, 'test\n');
      await fs.writeFile(file2, 'test\n');

      await multiplexer.getWatcher(file1, 100);
      await multiplexer.getWatcher(file2, 100);

      const c1 = new MockWebSocket() as unknown as WebSocket;
      const c2 = new MockWebSocket() as unknown as WebSocket;
      const c3 = new MockWebSocket() as unknown as WebSocket;

      multiplexer.addClient(file1, c1);
      multiplexer.addClient(file1, c2);
      multiplexer.addClient(file2, c3);

      assert.strictEqual(multiplexer.getClientCount(file1), 2);
      assert.strictEqual(multiplexer.getClientCount(file2), 1);
    });
  });

  describe('One file per watcher', () => {
    test('should maintain exactly one watcher per file even with many clients', async () => {
      const filePath = path.join(testDir, 'one_watch.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher1 = await multiplexer.getWatcher(filePath, 100);

      // Add 50 clients
      const clients: WebSocket[] = [];
      for (let i = 0; i < 50; i++) {
        const client = new MockWebSocket() as unknown as WebSocket;
        clients.push(client);
        multiplexer.addClient(filePath, client);
      }

      assert.strictEqual(multiplexer.getWatcherCount(), 1, 'should have only 1 watcher');
      assert.strictEqual(multiplexer.getTotalClients(), 50);

      // Verify it's the same watcher
      const watcher2 = await multiplexer.getWatcher(filePath, 100);
      assert.strictEqual(watcher1, watcher2);
    });
  });

  describe('Concurrent operations', () => {
    test('should handle rapid add/remove operations', async () => {
      const filePath = path.join(testDir, 'rapid.log');
      await fs.writeFile(filePath, 'test\n');

      const watcher = await multiplexer.getWatcher(filePath, 100);
      const clients: WebSocket[] = [];

      // Rapidly add clients
      for (let i = 0; i < 10; i++) {
        const client = new MockWebSocket() as unknown as WebSocket;
        clients.push(client);
        multiplexer.addClient(filePath, client);
      }

      assert.strictEqual(multiplexer.getTotalClients(), 10);

      // Rapidly remove clients
      for (const client of clients) {
        await multiplexer.removeClient(filePath, client);
      }

      assert.strictEqual(multiplexer.getWatcherCount(), 0);
    });
  });

  describe('getWatchers snapshot', () => {
    test('should return copy of watchers map', async () => {
      const file1 = path.join(testDir, 'snap1.log');
      const file2 = path.join(testDir, 'snap2.log');
      await fs.writeFile(file1, 'test\n');
      await fs.writeFile(file2, 'test\n');

      await multiplexer.getWatcher(file1, 100);
      await multiplexer.getWatcher(file2, 100);

      const snapshot = multiplexer.getWatchers();

      assert.strictEqual(snapshot.size, 2);
      assert(snapshot.has(file1));
      assert(snapshot.has(file2));
    });
  });
});
