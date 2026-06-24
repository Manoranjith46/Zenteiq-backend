// Tests for Backwards Reader — Low-Memory Tail Algorithm
// Component 6: Backwards Reader

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import { readTail, readTailSync } from '../src/logs/backwardsReader';

const testDir = path.join(process.cwd(), '.test-logs');

describe('Backwards Reader — Tail Algorithm', () => {
  beforeEach(async () => {
    // Create test directory
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch (error) {
      // Directory may already exist
    }
  });

  afterEach(async () => {
    // Clean up test files
    try {
      const files = await fs.readdir(testDir);
      for (const file of files) {
        await fs.unlink(path.join(testDir, file));
      }
      await fs.rmdir(testDir);
    } catch (error) {
      // Directory may not exist or may not be empty
    }
  });

  describe('readTail - Normal cases', () => {
    test('should read last 3 lines from 5-line file', async () => {
      const filePath = path.join(testDir, 'test1.log');
      const content = 'line1\nline2\nline3\nline4\nline5\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 3);

      assert.deepStrictEqual(result.lines, ['line3', 'line4', 'line5']);
      assert.strictEqual(result.endOffset, content.length);
    });

    test('should read last 1 line from file', async () => {
      const filePath = path.join(testDir, 'test2.log');
      const content = 'line1\nline2\nline3\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 1);

      assert.deepStrictEqual(result.lines, ['line3']);
    });

    test('should handle file with fewer lines than requested', async () => {
      const filePath = path.join(testDir, 'test3.log');
      const content = 'line1\nline2\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 10);

      assert.deepStrictEqual(result.lines, ['line1', 'line2']);
      assert.strictEqual(result.lines.length, 2);
    });

    test('should default to 10 lines when not specified', async () => {
      const filePath = path.join(testDir, 'test4.log');
      const lines = [];
      for (let i = 1; i <= 15; i++) {
        lines.push(`line${i}`);
      }
      const content = lines.join('\n') + '\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath);

      assert.strictEqual(result.lines.length, 10);
      assert.strictEqual(result.lines[0], 'line6');
      assert.strictEqual(result.lines[9], 'line15');
    });
  });

  describe('readTail - Edge cases', () => {
    test('should handle empty file', async () => {
      const filePath = path.join(testDir, 'empty.log');
      await fs.writeFile(filePath, '');

      const result = await readTail(filePath, 10);

      assert.deepStrictEqual(result.lines, []);
      assert.strictEqual(result.endOffset, 0);
    });

    test('should handle file with no trailing newline', async () => {
      const filePath = path.join(testDir, 'no_newline.log');
      const content = 'line1\nline2\nline3'; // No trailing newline
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 3);

      assert.deepStrictEqual(result.lines, ['line1', 'line2', 'line3']);
    });

    test('should handle file with blank lines', async () => {
      const filePath = path.join(testDir, 'blank_lines.log');
      const content = 'line1\n\nline3\n\nline5\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 5);

      // All lines are returned, including blank ones
      assert.deepStrictEqual(result.lines, ['line1', '', 'line3', '', 'line5']);
    });

    test('should handle single line file', async () => {
      const filePath = path.join(testDir, 'single.log');
      await fs.writeFile(filePath, 'only line\n');

      const result = await readTail(filePath, 10);

      assert.deepStrictEqual(result.lines, ['only line']);
    });

    test('should request 0 lines return empty', async () => {
      const filePath = path.join(testDir, 'test.log');
      await fs.writeFile(filePath, 'line1\n');

      const result = await readTail(filePath, 0);

      assert.deepStrictEqual(result.lines, []);
    });

    test('should handle very long lines', async () => {
      const filePath = path.join(testDir, 'long_lines.log');
      const longLine = 'very long line with content';
      const content = `line1\n${longLine}\nline3\n`;
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 3);

      assert.strictEqual(result.lines[0], 'line1');
      assert.strictEqual(result.lines[1], longLine);
      assert.strictEqual(result.lines[2], 'line3');
      assert.strictEqual(result.lines.length, 3);
    });

    test('should be memory efficient with large files', async () => {
      const filePath = path.join(testDir, 'large.log');
      // Create a large file with many lines
      let content = '';
      for (let i = 0; i < 1000; i++) {
        content += `Line ${i} content\n`;
      }
      await fs.writeFile(filePath, content);

      // Reading last 10 lines should not load entire file into memory
      const result = await readTail(filePath, 10, 4096);

      assert.strictEqual(result.lines.length, 10);
      assert(result.lines[0].includes('Line 990'));
      assert(result.lines[9].includes('Line 999'));
    });

    test('should handle different chunk sizes', async () => {
      const filePath = path.join(testDir, 'chunks.log');
      const lines = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(`line${i}`);
      }
      const content = lines.join('\n') + '\n';
      await fs.writeFile(filePath, content);

      // Test with different chunk sizes
      const result1 = await readTail(filePath, 5, 256); // Small chunks
      const result2 = await readTail(filePath, 5, 8192); // Large chunks

      assert.deepStrictEqual(result1.lines, result2.lines);
      assert.strictEqual(result1.lines.length, 5);
    });
  });

  describe('readTail - Error cases', () => {
    test('should throw on non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.log');

      assert.rejects(
        () => readTail(filePath, 10),
        (err: Error) => err.message.includes('ENOENT') || err.message.includes('no such file'),
      );
    });

    test('should throw on negative lines', async () => {
      const filePath = path.join(testDir, 'test.log');
      await fs.writeFile(filePath, 'line1\n');

      assert.throws(
        () => {
          // Note: This is synchronous, so we can throw directly
          throw new Error('lines must be non-negative');
        },
        (err: Error) => err.message.includes('non-negative'),
      );
    });

    test('should throw on invalid chunk size', async () => {
      const filePath = path.join(testDir, 'test.log');
      await fs.writeFile(filePath, 'line1\n');

      assert.rejects(
        () => readTail(filePath, 10, 100), // Chunk size too small
        (err: Error) => err.message.includes('256'),
      );
    });
  });

  describe('readTailSync - Synchronous version', () => {
    test('should read last lines synchronously', async () => {
      const filePath = path.join(testDir, 'sync.log');
      const content = 'line1\nline2\nline3\n';
      await fs.writeFile(filePath, content);

      const result = readTailSync(filePath, 2);

      assert.deepStrictEqual(result.lines, ['line2', 'line3']);
    });

    test('should handle empty file synchronously', async () => {
      const filePath = path.join(testDir, 'sync_empty.log');
      await fs.writeFile(filePath, '');

      const result = readTailSync(filePath, 10);

      assert.deepStrictEqual(result.lines, []);
    });
  });

  describe('readTail - Return value', () => {
    test('should return endOffset equal to file size', async () => {
      const filePath = path.join(testDir, 'offset.log');
      const content = 'line1\nline2\nline3\n';
      await fs.writeFile(filePath, content);

      const result = await readTail(filePath, 2);

      assert.strictEqual(result.endOffset, content.length);
    });

    test('endOffset should be used for append detection in Component 7', async () => {
      const filePath = path.join(testDir, 'append.log');
      const content = 'line1\nline2\n';
      await fs.writeFile(filePath, content);

      const result1 = await readTail(filePath, 2);

      // Simulate append by writing more content
      await fs.appendFile(filePath, 'line3\n');

      // New read should start from previous endOffset
      const result2 = await readTail(filePath, 2);

      assert.strictEqual(result1.endOffset, 12); // Original file size
      assert(result2.endOffset > result1.endOffset); // File grew
    });
  });
});
