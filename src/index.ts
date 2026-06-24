import http from 'http';
import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { handleAuthRoute } from './routes/authRoutes.js';
import { handleLogRoute, setServerStartTime } from './routes/logRoutes.js';
import { sendInternalError } from './utils/httpHelpers.js';
import { parseURL } from './utils/httpHelpers.js';
import { handleWebSocketConnection } from './ws/wsHandler.js';

// Load and validate configuration (exits if invalid)
const config = loadConfig();
const serverStartTime = Date.now();
setServerStartTime(serverStartTime);

// Create HTTP server
const server = http.createServer(async (req, res) => {
  // Set standard headers
  res.setHeader('Content-Type', 'application/json');

  // Extract method and path
  const method = req.method || 'GET';
  const { path } = parseURL(req.url);

  try {
    // Log incoming request
    console.log(`[INFO] ${method} ${path}`);

    // Try auth routes first
    if (path.startsWith('/auth')) {
      if (await handleAuthRoute(method, path, req, res, config)) {
        return;
      }
    }

    // Try log routes
    if (path.startsWith('/logs') || path === '/health') {
      if (await handleLogRoute(method, path, req, res, config)) {
        return;
      }
    }

    // 404 - Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    sendInternalError(res, message);
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  console.log('[INFO] WebSocket client connected');

  // Pass full URL to handler so it can extract filename from path
  const url = req.url || '';

  // Handle connection asynchronously
  handleWebSocketConnection(ws, url, config).catch((error) => {
    console.error(`[ERROR] WebSocket handler error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  });
});

// Start server
const port = config.PORT;
server.listen(port, () => {
  console.log(`[INFO] Server is ready to accept HTTP and WebSocket connections on http://localhost:${port}`);
  console.log(`[INFO] Logs directory: ${config.LOGS_DIR}`);
  console.log(`[INFO] Allowed extensions: ${config.ALLOWED_EXTENSIONS.join(', ')}`);
  console.log(`[INFO] Poll interval: ${config.POLL_INTERVAL_MS}ms`);
  console.log(`[INFO] JWT expires in: ${config.JWT_EXPIRES_IN}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[INFO] SIGTERM received, shutting down gracefully');
  // Close all watchers first
  const { multiplexer } = await import('./logs/multiplexer.js');
  await multiplexer.closeAll();
  server.close(() => {
    console.log('[INFO] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[INFO] SIGINT received, shutting down gracefully');
  // Close all watchers first
  const { multiplexer } = await import('./logs/multiplexer.js');
  await multiplexer.closeAll();
  server.close(() => {
    console.log('[INFO] Server closed');
    process.exit(0);
  });
});
