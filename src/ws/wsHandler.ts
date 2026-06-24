// WebSocket Handler — Client Connection Management
// Component 9: WebSocket Handler
// Per Agent_Prompt.md SECTION 4F, 4G: JWT validation, initial burst, append streaming

import { WebSocket } from 'ws';
import { readTail } from '../logs/backwardsReader';
import { multiplexer } from '../logs/multiplexer';
import { authenticateWebSocket } from '../auth/authMiddleware';
import { resolveAndGuard } from '../utils/pathGuard';
import { Config } from '../config';
import path from 'path';

/**
 * Handles a new WebSocket connection
 * Flow:
 *   1. Extract token and filename from URL
 *   2. Validate token (JWT)
 *   3. Validate filename (path guard)
 *   4. Get watcher from multiplexer
 *   5. Add client to watcher
 *   6. Send initial burst of last N lines
 *   7. Client receives append/truncated/rotated events from poll engine
 *   8. On disconnect, remove client from watcher
 *
 * @param ws - WebSocket client
 * @param url - Full URL (e.g., "/ws/logs/app.log?token=<jwt>&lines=50")
 * @param config - Config with LOGS_DIR and POLL_INTERVAL_MS
 */
export async function handleWebSocketConnection(ws: WebSocket, url: string | undefined, config: Config): Promise<void> {
  try {
    // Extract path and query string from full URL
    const fullUrl = url || '';
    const queryIndex = fullUrl.indexOf('?');
    const pathname = queryIndex !== -1 ? fullUrl.substring(0, queryIndex) : fullUrl;
    const queryString = queryIndex !== -1 ? fullUrl.substring(queryIndex + 1) : '';

    // Extract filename from path: /ws/logs/{filename}
    const pathParts = pathname.split('/').filter((p) => p.length > 0);
    if (pathParts.length < 3 || pathParts[0] !== 'ws' || pathParts[1] !== 'logs') {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'FORBIDDEN',
          message: 'Invalid WebSocket path',
        }),
      );
      ws.close(1008, 'Invalid path');
      return;
    }
    const filename = decodeURIComponent(pathParts[2]);

    // Extract and validate token
    const payload = await authenticateWebSocket(queryString, config);
    console.log(`[INFO] WebSocket client authenticated: ${payload.email}`);

    // Parse query string
    const params = new URLSearchParams(queryString);
    const linesStr = params.get('lines') || '10';
    const lines = parseInt(linesStr, 10) || 10;

    // Validate and resolve filename (prevents path traversal)
    let absPath: string;
    try {
      absPath = resolveAndGuard(filename, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid filename';
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'FORBIDDEN',
          message,
        }),
      );
      ws.close(1008, 'Path validation failed');
      return;
    }

    // Get or create watcher from multiplexer
    const watcher = await multiplexer.getWatcher(absPath, config.POLL_INTERVAL_MS);

    // Add client to watcher
    const added = multiplexer.addClient(absPath, ws);
    if (!added) {
      console.warn(`[WARN] Client already subscribed to ${filename}`);
    }

    console.log(`[INFO] WebSocket client subscribed to ${filename}`);

    // Send initial burst: last N lines
    try {
      const result = await readTail(absPath, lines, config.TAIL_CHUNK_SIZE);

      ws.send(
        JSON.stringify({
          type: 'initial',
          file: filename,
          lines: result.lines,
          timestamp: new Date().toISOString(),
        }),
      );

      console.log(`[INFO] Sent initial ${result.lines.length} lines to client for ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read initial lines';
      console.error(`[ERROR] Failed to send initial burst for ${filename}: ${message}`);

      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'INTERNAL_ERROR',
          message: 'Failed to read log file',
        }),
      );
      ws.close(1011, 'Internal error');

      // Remove from watcher since we're closing
      await multiplexer.removeClient(absPath, ws);
      return;
    }

    // Handle client disconnect
    ws.on('close', async () => {
      console.log(`[INFO] WebSocket client disconnected from ${filename}`);
      await multiplexer.removeClient(absPath, ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[ERROR] WebSocket error for ${filename}: ${error.message}`);
    });
  } catch (error) {
    // Authentication failed or other startup error
    const message = error instanceof Error ? error.message : 'Authentication failed';
    const code = message.includes('token') ? 'UNAUTHORIZED' : 'FORBIDDEN';

    try {
      ws.send(
        JSON.stringify({
          type: 'error',
          code,
          message,
        }),
      );
    } catch (sendError) {
      console.error(`[WARN] Failed to send error message: ${sendError instanceof Error ? sendError.message : 'Unknown error'}`);
    }

    ws.close(code === 'UNAUTHORIZED' ? 1008 : 1008, message);
    console.warn(`[WARN] WebSocket connection rejected: ${message}`);
  }
}

