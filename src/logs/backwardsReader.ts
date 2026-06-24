// Backwards Reader — Low-Memory Tail Algorithm
// Component 6: Backwards Reader
// Per Agent_Prompt.md SECTION 4A: Read last N lines without loading full file into RAM

import fs from 'fs/promises';
import fsSync from 'fs';

/**
 * Result of reading last N lines from a file
 */
export interface ReadTailResult {
  lines: string[];
  endOffset: number; // File size at time of read (becomes starting offset for append detection)
}

/**
 * Reads the last N lines of a file without loading the entire file into memory.
 *
 * Algorithm (SECTION 4A):
 *   1. Open file and get size
 *   2. If empty, return empty lines
 *   3. Read backwards in CHUNK_SIZE chunks
 *   4. Split each chunk on newlines
 *   5. Track remainder (incomplete line at chunk boundary)
 *   6. Stop when we have N lines or reach start of file
 *   7. Slice to exactly last N lines
 *   8. Return lines + endOffset (for append detection)
 *
 * @param filePath - Absolute path to file to read
 * @param lines - Number of lines to read (defaults to 10)
 * @param chunkSize - Bytes to read per iteration (defaults to 4096)
 * @returns { lines: string[], endOffset: number }
 * @throws Error if file cannot be read
 */
export async function readTail(filePath: string, lines: number = 10, chunkSize: number = 4096): Promise<ReadTailResult> {
  // Validate inputs
  if (lines < 0) {
    throw new Error('lines must be non-negative');
  }
  if (lines === 0) {
    return { lines: [], endOffset: 0 };
  }
  if (chunkSize < 256) {
    throw new Error('chunkSize must be at least 256 bytes');
  }

  // Open file
  const fd = await fs.open(filePath, 'r');

  try {
    // Get file size
    const stat = await fd.stat();
    const fileSize = stat.size;

    // Empty file
    if (fileSize === 0) {
      return { lines: [], endOffset: 0 };
    }

    // Read backwards in chunks
    let readPos = fileSize;
    const linesFound: string[] = [];
    let remainder = ''; // Incomplete line at the start of a chunk

    while (readPos > 0 && linesFound.length < lines) {
      // Calculate chunk boundaries
      const chunkStart = Math.max(0, readPos - chunkSize);
      const actualSize = readPos - chunkStart;

      // Read chunk
      const buf = Buffer.alloc(actualSize);
      await fd.read(buf, 0, actualSize, chunkStart);
      const chunkStr = buf.toString('utf8');

      // Combine with remainder from previous chunk
      const combined = chunkStr + remainder;

      // Split on newlines
      const splitLines = combined.split('\n');

      // Last element may be incomplete - save as remainder for next iteration
      remainder = splitLines.shift() || '';

      // Add complete lines to our result (in reverse order for now)
      linesFound.push(...splitLines);

      // Move to previous chunk
      readPos = chunkStart;
    }

    // After loop, prepend remainder if it exists (incomplete line at start of file)
    if (remainder) {
      linesFound.unshift(remainder);
    }

    // Remove trailing empty string that comes from files ending with newline
    while (linesFound.length > 0 && linesFound[linesFound.length - 1] === '') {
      linesFound.pop();
    }

    // Slice to last N lines
    const result = linesFound.slice(-lines);

    return {
      lines: result,
      endOffset: fileSize,
    };
  } finally {
    await fd.close();
  }
}

/**
 * Reads the last N lines from a file (synchronous version - use with caution on large files)
 * Only use when async is not available (e.g., in very specific callbacks)
 */
export function readTailSync(filePath: string, lines: number = 10, chunkSize: number = 4096): ReadTailResult {
  // Validate inputs
  if (lines < 0) {
    throw new Error('lines must be non-negative');
  }
  if (lines === 0) {
    return { lines: [], endOffset: 0 };
  }

  // Get file size
  const stat = fsSync.statSync(filePath);
  const fileSize = stat.size;

  // Empty file
  if (fileSize === 0) {
    return { lines: [], endOffset: 0 };
  }

  // Open file
  const fd = fsSync.openSync(filePath, 'r');

  try {
    let readPos = fileSize;
    const linesFound: string[] = [];
    let remainder = '';

    while (readPos > 0 && linesFound.length < lines) {
      const chunkStart = Math.max(0, readPos - chunkSize);
      const actualSize = readPos - chunkStart;

      const buf = Buffer.alloc(actualSize);
      fsSync.readSync(fd, buf, 0, actualSize, chunkStart);
      const chunkStr = buf.toString('utf8');

      const combined = chunkStr + remainder;
      const splitLines = combined.split('\n');

      remainder = splitLines.shift() || '';
      linesFound.push(...splitLines);

      readPos = chunkStart;
    }

    if (remainder) {
      linesFound.unshift(remainder);
    }

    // Remove trailing empty string that comes from files ending with newline
    while (linesFound.length > 0 && linesFound[linesFound.length - 1] === '') {
      linesFound.pop();
    }

    const result = linesFound.slice(-lines);

    return {
      lines: result,
      endOffset: fileSize,
    };
  } finally {
    fsSync.closeSync(fd);
  }
}
