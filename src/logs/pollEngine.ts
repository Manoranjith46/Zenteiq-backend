// Poll Engine — File Monitoring & Append Detection
// Component 7: Poll Engine
// Per Agent_Prompt.md SECTION 4B-C: Poll for file changes, detect rotation/truncation/appends

import fs from 'fs/promises';
import { Stats } from 'fs';
import { WebSocket } from 'ws';

/**
 * State managed per monitored file
 */
export interface WatcherState {
  absPath: string;
  fd: fs.FileHandle | null;
  offset: number; // byte offset of last confirmed read
  inode: number; // inode for rotation detection
  size: number; // last known file size
  lineBuffer: string; // accumulates incomplete line at chunk boundary
  clients: Set<WebSocket>;
  pollTimer: NodeJS.Timeout | null;
}

/**
 * Creates a new WatcherState for a file
 * @param absPath - Absolute path to file to watch
 * @returns New WatcherState with fd opened
 */
export async function createWatcher(absPath: string): Promise<WatcherState> {
  try {
    const stat = await fs.stat(absPath);
    const fd = await fs.open(absPath, 'r');

    return {
      absPath,
      fd,
      offset: 0,
      inode: stat.ino || 0, // Windows may return 0
      size: stat.size,
      lineBuffer: '',
      clients: new Set(),
      pollTimer: null,
    };
  } catch (error) {
    throw new Error(`Failed to create watcher for ${absPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Closes a watcher and cleans up resources
 */
export async function closeWatcher(state: WatcherState): Promise<void> {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  if (state.fd) {
    await state.fd.close();
    state.fd = null;
  }

  state.clients.clear();
}

/**
 * Main polling loop - runs every POLL_INTERVAL_MS
 * Detects rotation, truncation, and appends
 */
export async function pollFile(state: WatcherState, filename: string): Promise<void> {
  try {
    // Check current file status
    let stat: Stats;
    try {
      stat = await fs.stat(state.absPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`[WARN] File not found during poll: ${state.absPath}`);
        return;
      }
      throw error;
    }

    // ROTATION DETECTION: inode changed means file was rotated
    if (stat.ino !== 0 && stat.ino !== state.inode) {
      console.log(`[INFO] File rotation detected: ${filename} (inode: ${state.inode} → ${stat.ino})`);

      // Close old fd and open new
      if (state.fd) {
        await state.fd.close();
      }
      state.fd = await fs.open(state.absPath, 'r');

      // Reset state for new file
      state.offset = 0;
      state.inode = stat.ino;
      state.size = stat.size;
      state.lineBuffer = '';

      // Broadcast rotation event to all clients
      broadcastToClients(state, {
        type: 'rotated',
        file: filename,
        timestamp: new Date().toISOString(),
      });

      return; // Next poll will read new file
    }

    // TRUNCATION DETECTION: size decreased
    if (stat.size < state.size) {
      console.log(`[INFO] File truncation detected: ${filename} (size: ${state.size} → ${stat.size})`);

      state.offset = 0;
      state.size = stat.size;
      state.lineBuffer = '';

      // Broadcast truncation event
      broadcastToClients(state, {
        type: 'truncated',
        file: filename,
        timestamp: new Date().toISOString(),
      });

      return;
    }

    // APPEND DETECTION: size increased
    if (stat.size > state.size) {
      await readAppendedBytes(state, filename);
    }

    // Update size for next poll (even if no change)
    state.size = stat.size;
  } catch (error) {
    console.error(`[ERROR] Poll error for ${state.absPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Reads bytes appended since last poll
 * Per SECTION 4C: read from offset to current file size, handle partial lines
 */
async function readAppendedBytes(state: WatcherState, filename: string): Promise<void> {
  if (!state.fd) {
    console.error(`[ERROR] File descriptor is null for ${state.absPath}`);
    return;
  }

  try {
    const stat = await fs.stat(state.absPath);
    const bytesToRead = stat.size - state.offset;

    if (bytesToRead <= 0) {
      return;
    }

    // Read new bytes
    const buf = Buffer.alloc(bytesToRead);
    await state.fd.read(buf, 0, bytesToRead, state.offset);
    const newText = buf.toString('utf8');

    // Combine with any leftover from previous read
    const combined = state.lineBuffer + newText;
    const allLines = combined.split('\n');

    // Handle partial line at end (may be empty string if text ended with \n)
    const lastSegment = allLines.pop() || '';
    state.lineBuffer = lastSegment;

    // Filter out empty lines and broadcast complete lines
    const completeLines = allLines.filter((line) => line.length > 0);

    if (completeLines.length > 0) {
      broadcastToClients(state, {
        type: 'append',
        file: filename,
        lines: completeLines,
        timestamp: new Date().toISOString(),
      });
    }

    // CRITICAL: Only advance offset after successful read + broadcast
    state.offset = stat.size;
  } catch (error) {
    console.error(`[ERROR] Failed to read appended bytes for ${state.absPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Broadcasts a message to all connected clients watching this file
 */
function broadcastToClients(state: WatcherState, message: Record<string, unknown>): void {
  for (const client of state.clients) {
    if (client.readyState === 1) {
      // 1 = OPEN
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        console.error(`[WARN] Failed to send to client: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
}

/**
 * Starts polling loop for a watcher
 * @param state - WatcherState to poll
 * @param filename - Filename for logging/broadcast
 * @param pollIntervalMs - Poll interval in milliseconds
 */
export function startPolling(state: WatcherState, filename: string, pollIntervalMs: number): void {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }

  state.pollTimer = setInterval(() => {
    pollFile(state, filename).catch((error) => {
      console.error(`[ERROR] Unhandled poll error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
  }, pollIntervalMs);
}

/**
 * Stops polling loop for a watcher
 */
export function stopPolling(state: WatcherState): void {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}
