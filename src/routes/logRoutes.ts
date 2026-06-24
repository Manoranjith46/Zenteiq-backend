// Log Routes — Log File Endpoints
// Component 5: HTTP Server - logRoutes
// Per SECTION 4H: GET /health, GET /logs, GET /logs/:filename/tail

import { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs/promises';
import path from 'path';
import { Config } from '../config';
import { resolveAndGuard, SecurityError } from '../utils/pathGuard';
import {
  sendSuccess,
  sendBadRequest,
  sendForbidden,
  sendNotFound,
  sendInternalError,
  parseQueryString,
  parseURL,
} from '../utils/httpHelpers';

// Server start time (set by index.ts)
let serverStartTime = Date.now();

/**
 * Sets the server start time (called from index.ts)
 */
export function setServerStartTime(time: number): void {
  serverStartTime = time;
}

/**
 * GET /health
 * Per SECTION 4H: { status, uptime, timestamp }
 */
export async function handleHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000);

  sendSuccess(res, {
    status: 'ok',
    uptime,
    timestamp: new Date().toISOString(),
  });
}

/**
 * File info for /logs listing
 */
export interface FileInfo {
  name: string;
  size: number;
  modified: string;
}

/**
 * GET /logs
 * Per SECTION 4H: { files: [{ name, size, modified }] }
 * Lists all log files in LOGS_DIR
 */
export async function handleLogsList(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  try {
    const logsDir = path.resolve(process.cwd(), config.LOGS_DIR);

    try {
      const entries = await fs.readdir(logsDir, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        // Validate file extension
        const ext = path.extname(entry.name);
        if (!config.ALLOWED_EXTENSIONS.includes(ext)) {
          continue;
        }

        // Get file stats
        const filePath = path.join(logsDir, entry.name);
        const stat = await fs.stat(filePath);

        files.push({
          name: entry.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }

      // Sort by name
      files.sort((a, b) => a.name.localeCompare(b.name));

      sendSuccess(res, { files });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        sendSuccess(res, { files: [] });
      } else {
        throw error;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list log files';
    sendInternalError(res, message);
  }
}

/**
 * GET /logs/:filename/tail?lines=N
 * Per SECTION 4H: { file, lines, timestamp } | 401 | 403 | 404
 * Returns the last N lines of a file (N defaults to 10)
 * NOTE: Component 6 (backwardsReader) will implement the actual tailing
 * For now, this is a placeholder that will be enhanced in later components
 */
export async function handleLogTail(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  filename: string,
): Promise<void> {
  try {
    // Validate and guard the file path
    const resolvedPath = resolveAndGuard(filename, config);

    // Parse query string for lines parameter
    const { queryString } = parseURL(req.url);
    const queryParams = parseQueryString(queryString);
    const linesStr = queryParams.get('lines') || '10';
    const lines = parseInt(linesStr, 10);

    if (isNaN(lines) || lines < 1) {
      sendBadRequest(res, 'lines parameter must be a positive integer');
      return;
    }

    // Check if file exists
    try {
      await fs.stat(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        sendNotFound(res, `File not found: ${filename}`);
      } else {
        throw error;
      }
      return;
    }

    // TODO: Component 6 will implement actual backwards reader
    // For now, return empty lines array
    sendSuccess(res, {
      file: filename,
      lines: [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof SecurityError) {
      console.warn(`[WARN] Security violation: ${error.message}`);
      sendForbidden(res, 'Access denied');
    } else {
      const message = error instanceof Error ? error.message : 'Failed to read log file';
      sendInternalError(res, message);
    }
  }
}

/**
 * Routes log requests to appropriate handler
 */
export async function handleLogRoute(
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<boolean> {
  if (path === '/health' && method === 'GET') {
    await handleHealth(req, res);
    return true;
  }

  if (path === '/logs' && method === 'GET') {
    await handleLogsList(req, res, config);
    return true;
  }

  // GET /logs/:filename/tail
  const tailMatch = path.match(/^\/logs\/([^/]+)\/tail$/);
  if (tailMatch && method === 'GET') {
    const filename = decodeURIComponent(tailMatch[1]);
    await handleLogTail(req, res, config, filename);
    return true;
  }

  return false;
}
