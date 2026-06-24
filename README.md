# ZenteiQ Real-Time Log Monitor

A production-ready backend service that lets authenticated clients monitor server-side log files in real time over WebSockets — a fully custom `tail -f` built from low-level Node.js primitives.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Stack & Architecture](#2-stack--architecture)
3. [Setup Instructions](#3-setup-instructions)
4. [Authentication Flow](#4-authentication-flow)
5. [REST API Reference](#5-rest-api-reference)
6. [WebSocket API Reference](#6-websocket-api-reference)
7. [Simulating Log Writes](#7-simulating-log-writes)
8. [Log Monitoring Algorithm](#8-log-monitoring-algorithm)
9. [Edge Cases Handled](#9-edge-cases-handled)
10. [Known Limitations](#10-known-limitations)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Project Overview

ZenteiQ Real-Time Log Monitor is a Node.js + TypeScript backend service that streams live log file updates to authenticated WebSocket clients. When a client connects, it immediately receives the last N lines of the chosen log file. After that, only newly written lines are pushed — never the full file again.

The core tailing engine is hand-built from low-level `fs` primitives (file descriptors, byte offsets, `fs.stat` polling). No high-level tailing libraries (`chokidar`, `node-tail`, `watchdog`, `pygtail`) are used anywhere. Multiple clients watching the same file share a single polling loop and a single file descriptor, keeping resource usage flat regardless of how many clients connect.

---

## 2. Stack & Architecture

**Runtime:** Node.js 18+  
**Language:** TypeScript (strict mode)  
**Dependencies:** `ws`, `jsonwebtoken`, `bcryptjs`, `dotenv` — no framework, no Express

### Architecture Diagram

```
                          ┌─────────────────────────────────────┐
                          │          HTTP / WS Server           │
                          │          (src/index.ts)             │
                          └──────────────┬──────────────────────┘
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               │                         │                         │
    ┌──────────▼──────────┐  ┌───────────▼──────────┐  ┌──────────▼──────────┐
    │   Auth Middleware    │  │    REST Routes        │  │   WS Handler        │
    │  (authMiddleware.ts) │  │ (authRoutes.ts        │  │  (wsHandler.ts)     │
    │   JWT verification   │  │  logRoutes.ts)        │  │  Upgrade validation │
    └──────────┬──────────┘  └───────────┬──────────┘  └──────────┬──────────┘
               │                         │                         │
               │              ┌──────────▼──────────┐             │
               └──────────────►      Path Guard      ◄────────────┘
                              │   (pathGuard.ts)     │
                              │  Blocks traversal    │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │     Multiplexer      │
                              │  (multiplexer.ts)    │
                              │  1 watcher per file  │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │     Poll Engine      │
                              │  (pollEngine.ts)     │
                              │  fs.stat every 250ms │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   Backwards Reader   │
                              │ (backwardsReader.ts) │
                              │  4KB chunk, no RAM   │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │    ./logs/ on disk   │
                              │  app.log, error.log  │
                              └─────────────────────┘

Data flow on new line written to file:
  File ──► PollEngine (detects size delta) ──► LineBuffer (buffers partial lines)
       ──► Multiplexer.broadcast() ──► WebSocket clients [1..N]
```

### Directory Structure

```
zenteiq-logmonitor/
├── src/
│   ├── index.ts                  ← HTTP + WS server entry point
│   ├── config.ts                 ← Env validation; exits on bad config
│   ├── auth/
│   │   ├── authService.ts        ← register, login, verifyToken
│   │   ├── authMiddleware.ts     ← Bearer token extraction
│   │   └── userStore.ts          ← In-memory user Map
│   ├── logs/
│   │   ├── backwardsReader.ts    ← Low-memory last-N-lines reader
│   │   ├── pollEngine.ts         ← fs.stat polling + append detection
│   │   ├── multiplexer.ts        ← One watcher per file registry
│   │   └── lineBuffer.ts         ← Partial-write line buffering
│   ├── ws/
│   │   └── wsHandler.ts          ← WebSocket lifecycle management
│   ├── routes/
│   │   ├── authRoutes.ts         ← /auth/* endpoints
│   │   └── logRoutes.ts          ← /health, /logs, /logs/:file/tail
│   └── utils/
│       ├── pathGuard.ts          ← Path traversal prevention
│       └── httpHelpers.ts        ← JSON response helpers
├── logs/
│   ├── app.log                   ← Sample log for testing
│   └── error.log                 ← Sample error log
├── tests/
│   ├── backwardsReader.test.ts
│   ├── pathGuard.test.ts
│   ├── auth.test.ts
│   ├── pollEngine.test.ts
│   ├── multiplexer.test.ts
│   ├── wsHandler.test.ts
│   ├── edgeCases.test.ts
│   └── integration.test.ts
├── .env.example
├── .env                          ← git-ignored
├── tsconfig.json
├── package.json
└── README.md
```

---

## 3. Setup Instructions

### Prerequisites

- **Node.js:** v18.0.0 or later (`node --version` to check)
- **npm:** v8+ (bundled with Node 18)
- **OS:** Linux or macOS recommended. Windows is supported but file rotation detection is unavailable (see [Known Limitations](#10-known-limitations)).

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/zenteiq-logmonitor.git
cd zenteiq-logmonitor

# 2. Install dependencies
npm install

# 3. Copy and configure environment variables
cp .env.example .env
```

### Environment Variables

Open `.env` and configure each variable:

```env
# TCP port the server listens on
PORT=3000

# Secret used to sign JWTs — must be at least 32 characters
# Generate a strong secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=replace_with_a_long_random_secret_at_least_32_chars

# JWT token lifetime (e.g. 24h, 7d, 3600)
JWT_EXPIRES_IN=24h

# How often (ms) the poll engine checks each watched file for changes
# Minimum: 50ms. Lower = faster updates, higher CPU. Default: 250ms.
POLL_INTERVAL_MS=250

# Size (bytes) of each backward-read chunk for the tail algorithm
# Default: 4096 (4KB). Larger = fewer reads for big files.
TAIL_CHUNK_SIZE=4096

# Comma-separated list of allowed log file extensions
ALLOWED_EXTENSIONS=.log,.txt

# Directory (relative to project root) where log files are stored
# All file access is restricted to this directory.
LOGS_DIR=./logs
```

### Running the Server

```bash
# Development (hot-reload via nodemon)
npm run dev

# Build TypeScript to dist/
npm run build

# Run compiled production build
npm start

# Run all tests
npm test

# TypeScript type-check only (no output)
npx tsc --noEmit
```

**Expected startup output:**

```
[INFO] Config loaded successfully
[INFO] Server listening on port 3000
```

### Creating Sample Log Files

The `logs/` directory ships with `app.log` and `error.log`. To create additional test files:

```bash
# Create a new log file
touch logs/my-service.log

# Populate it with sample entries
for i in $(seq 1 50); do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  Service event #$i" >> logs/my-service.log
done
```

---

## 4. Authentication Flow

All REST endpoints (except `/health`) and all WebSocket connections require a valid JWT. The full flow is:

```
1. Register     POST /auth/register  →  receive JWT
2. (or) Login   POST /auth/login     →  receive JWT
3. Use JWT      Authorization: Bearer <token>   (REST)
                ?token=<token>                   (WebSocket)
```

### Step 1 — Register

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"securepass123"}' | jq .
```

**Response `201 Created`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error — duplicate email `409 Conflict`:**
```json
{ "error": "Email already registered", "code": "CONFLICT" }
```

**Error — weak password `400 Bad Request`:**
```json
{ "error": "Password must be at least 8 characters", "code": "VALIDATION_ERROR" }
```

### Step 2 — Login

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"securepass123"}' | jq .
```

**Response `200 OK`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Error — wrong credentials `401 Unauthorized`:**
```json
{ "error": "Invalid email or password", "code": "UNAUTHORIZED" }
```

### Step 3 — Get Current User

```bash
export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

curl -s http://localhost:3000/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Response `200 OK`:**
```json
{
  "id": "a3f7c2d1-...",
  "email": "dev@example.com",
  "createdAt": "2026-06-24T14:30:00.000Z"
}
```

### JWT Payload

Tokens are HS256-signed and contain:

```json
{
  "sub": "a3f7c2d1-...",
  "email": "dev@example.com",
  "iat": 1750775400,
  "exp": 1750861800
}
```

---

## 5. REST API Reference

All responses use `Content-Type: application/json`. All error responses follow the shape:

```json
{ "error": "<human-readable message>", "code": "<machine-readable code>" }
```

---

### `GET /health`

Returns server status. No authentication required.

```bash
curl -s http://localhost:3000/health | jq .
```

**Response `200 OK`:**
```json
{
  "status": "ok",
  "uptime": 142.38,
  "timestamp": "2026-06-24T14:45:00.000Z"
}
```

---

### `POST /auth/register`

Register a new user and receive a JWT.

**Request body:**
```json
{ "email": "user@example.com", "password": "minlength8" }
```

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"minlength8"}' | jq .
```

| Status | Meaning |
|--------|---------|
| `201`  | Registered successfully — body: `{ "token": "..." }` |
| `400`  | Validation error (short password, missing field) |
| `409`  | Email already registered |

---

### `POST /auth/login`

Authenticate an existing user.

**Request body:**
```json
{ "email": "user@example.com", "password": "minlength8" }
```

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"minlength8"}' | jq .
```

| Status | Meaning |
|--------|---------|
| `200`  | Authenticated — body: `{ "token": "..." }` |
| `400`  | Missing email or password |
| `401`  | Wrong credentials |

---

### `GET /auth/me`

Return the currently authenticated user's profile.

```bash
curl -s http://localhost:3000/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```

| Status | Meaning |
|--------|---------|
| `200`  | Body: `{ "id", "email", "createdAt" }` |
| `401`  | Missing, expired, or invalid token |

---

### `GET /logs`

List all log files available in `LOGS_DIR`.

```bash
curl -s http://localhost:3000/logs \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Response `200 OK`:**
```json
{
  "files": [
    { "name": "app.log",   "size": 4096, "modified": "2026-06-24T14:00:00.000Z" },
    { "name": "error.log", "size": 1024, "modified": "2026-06-24T13:55:00.000Z" }
  ]
}
```

| Status | Meaning |
|--------|---------|
| `200`  | File list returned |
| `401`  | Not authenticated |

---

### `GET /logs/:filename/tail?lines=N`

Return the last N lines of a log file. Useful for checking recent content without opening a WebSocket.

**Query parameters:**

| Param   | Default | Max | Description |
|---------|---------|-----|-------------|
| `lines` | `10`    | `500` | Number of lines to return |

```bash
# Get last 10 lines (default)
curl -s "http://localhost:3000/logs/app.log/tail" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get last 50 lines
curl -s "http://localhost:3000/logs/app.log/tail?lines=50" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Response `200 OK`:**
```json
{
  "file": "app.log",
  "lines": [
    "[2026-06-24 14:00:01] INFO  Server started on port 3000",
    "[2026-06-24 14:00:02] INFO  Database connection established",
    "[2026-06-24 14:00:05] WARN  Cache miss on key: session_abc123"
  ],
  "timestamp": "2026-06-24T14:45:00.000Z"
}
```

| Status | Meaning |
|--------|---------|
| `200`  | Lines returned |
| `401`  | Not authenticated |
| `403`  | Path traversal attempt blocked |
| `404`  | File not found in `LOGS_DIR` |

**Security — path traversal is blocked:**
```bash
# These all return 403 Forbidden:
curl "http://localhost:3000/logs/../../.env/tail" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:3000/logs/%2e%2e%2f.env/tail" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:3000/logs//etc/passwd/tail" -H "Authorization: Bearer $TOKEN"
```

---

## 6. WebSocket API Reference

### Connection URL

```
ws://localhost:3000/ws/logs/{filename}?lines=N&token=<jwt>
```

| Parameter  | Required | Default | Max  | Description |
|------------|----------|---------|------|-------------|
| `filename` | Yes      | —       | —    | Log file name (e.g. `app.log`) |
| `token`    | Yes      | —       | —    | Valid JWT from login/register |
| `lines`    | No       | `10`    | `500`| Number of historical lines to receive on connect |

> **Security note:** The JWT is passed as a query parameter because browsers cannot set custom headers on WebSocket connections. This means the token will appear in server access logs. For higher-security environments, consider using short-lived tokens (e.g. 5-minute expiry) specifically for WebSocket connections.

### Connecting with wscat

```bash
# Install wscat globally
npm install -g wscat

# Connect and start receiving log events
wscat -c "ws://localhost:3000/ws/logs/app.log?lines=10&token=$TOKEN"
```

### Message Types

All messages are JSON-encoded strings sent from server to client.

---

#### `initial` — Sent once on connect

Contains the last N lines of the file at the time of connection.

```json
{
  "type": "initial",
  "file": "app.log",
  "lines": [
    "[2026-06-24 14:00:01] INFO  Server started",
    "[2026-06-24 14:00:02] INFO  Connected to DB"
  ],
  "timestamp": "2026-06-24T14:45:00.000Z"
}
```

---

#### `append` — Sent when new lines are written to the file

Only the newly written lines are sent. Lines that were already sent are never resent.

```json
{
  "type": "append",
  "file": "app.log",
  "lines": [
    "[2026-06-24 14:46:01] ERROR Disk usage at 95%"
  ],
  "timestamp": "2026-06-24T14:46:01.123Z"
}
```

---

#### `truncated` — Sent when the file is cleared

The file was emptied (e.g. `> logs/app.log` or `truncate -s 0 logs/app.log`). The server resets its read offset to 0 and subsequent appends are streamed from the beginning of the new content.

```json
{
  "type": "truncated",
  "file": "app.log",
  "timestamp": "2026-06-24T14:50:00.000Z"
}
```

---

#### `rotated` — Sent when the file is replaced (log rotation)

The original file was renamed and a new file was created at the same path (e.g. `logrotate` behavior). The server detects this via inode change, resets its offset, and begins streaming from the new file.

```json
{
  "type": "rotated",
  "file": "app.log",
  "timestamp": "2026-06-24T15:00:00.000Z"
}
```

---

#### `error` — Sent before the connection is closed due to an error

```json
{
  "type": "error",
  "code": "UNAUTHORIZED",
  "message": "Token is expired"
}
```

| Code            | Meaning |
|-----------------|---------|
| `UNAUTHORIZED`  | Missing, invalid, or expired token |
| `FORBIDDEN`     | Path traversal attempt blocked |
| `NOT_FOUND`     | File does not exist in `LOGS_DIR` |

---

### WebSocket Connection Rejected (Pre-Upgrade)

If the JWT is invalid or the path is unsafe, the HTTP upgrade is rejected before a WebSocket connection is established:

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error":"Unauthorized","code":"UNAUTHORIZED"}
```

| HTTP Status | Trigger |
|-------------|---------|
| `401`       | Missing or invalid JWT |
| `403`       | Path traversal in filename |
| `404`       | File not found |

---

## 7. Simulating Log Writes

Use these commands in a second terminal while your WebSocket client is connected to observe live streaming.

### Appending Lines

```bash
# Append a single timestamped line
echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  Test event" >> logs/app.log

# Append multiple lines in a loop (simulates a running service)
while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  Heartbeat OK" >> logs/app.log
  sleep 1
done

# Simulate mixed log levels
echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARN  Memory usage at 82%" >> logs/app.log
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR Request timeout on /api/data" >> logs/app.log
```

### Simulating File Truncation

This resets the file to empty while clients are connected. Connected WebSocket clients will receive a `truncated` message, and subsequent writes are streamed from byte 0.

```bash
# Linux / macOS
truncate -s 0 logs/app.log

# Or using shell redirection
> logs/app.log
```

### Simulating Log Rotation

This renames the current file and creates a new empty one at the same path — exactly what `logrotate` does in production. Connected clients will receive a `rotated` message and then stream from the new file.

```bash
mv logs/app.log logs/app.log.1 && touch logs/app.log

# Then write to the new file
echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  New log file started after rotation" >> logs/app.log
```

### Full WebSocket Test Session

```bash
# Terminal 1: Start the server
npm run dev

# Terminal 2: Register, get token, connect WebSocket
TOKEN=$(curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' | jq -r .token)

wscat -c "ws://localhost:3000/ws/logs/app.log?lines=5&token=$TOKEN"

# Terminal 3: Write to the log while watching Terminal 2
echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  You should see this line appear instantly" >> logs/app.log
```

---

## 8. Log Monitoring Algorithm

### 8.1 Backwards Reader (Last N Lines, Low Memory)

When a client connects, we send the last N lines of the log file. Naively loading the entire file into memory (with `fs.readFile`) is forbidden — log files can be gigabytes.

**The backwards-chunk algorithm:**

```
File (e.g. 50MB):
  [start ........... position 51,200 ........... EOF at 52,428,800]

Iteration 1:  Read bytes [52,424,704 → 52,428,800]  (4KB chunk, from end)
              Split on \n, count lines found: 3
Iteration 2:  Read bytes [52,420,608 → 52,424,704]  (previous 4KB)
              Prepend to accumulated text, count lines: 8
Iteration 3:  Read bytes [52,416,512 → 52,420,608]
              Line count now 12 — we have enough for N=10.
              Slice last 10, return.
```

Key properties:
- Uses `fs.promises.open` → `fd.read(buf, 0, chunkSize, position)` → `fd.close()`. No `readFile`.
- Maximum memory usage per read: `TAIL_CHUNK_SIZE × 2` (current chunk + accumulated text), not proportional to file size.
- Returns `endOffset` (the file's byte size at read time), which becomes the starting cursor for the polling loop.

### 8.2 Offset Tracking & Append Detection

The poll engine runs `fs.promises.stat(filePath)` every `POLL_INTERVAL_MS` milliseconds and compares the returned `size` against the last known offset.

```
State stored per watched file:
  offset  = byte position of last confirmed read
  size    = file size at last poll
  inode   = inode number from last stat (used for rotation)

Poll cycle:
  newSize = stat(file).size

  if newSize > offset:
    readBytes(from=offset, to=newSize)   ← only the new delta
    offset = newSize                      ← advance cursor after successful read
    broadcast(newLines)

  if newSize === offset:
    no change, skip

  if newSize < offset:
    truncation detected → reset offset=0
```

This guarantees:
- **No duplicate sends:** offset is only advanced after a successful read and broadcast.
- **No re-reading old content:** reads start at `offset`, not at 0.
- **No missed content:** offset is advanced to `stat.size`, not to `offset + bytesRead` (avoids race conditions with concurrent appends).

### 8.3 Multiplexer — One Watcher Per File

Without a multiplexer, 50 clients watching `app.log` would create 50 polling intervals and 50 open file descriptors — a resource disaster.

```
Without multiplexer:            With multiplexer:

Client A ─► Watcher A (fd#1)   Client A ─┐
Client B ─► Watcher B (fd#2)   Client B ─┤─► Single Watcher (fd#1)
Client C ─► Watcher C (fd#3)   Client C ─┘       │
                                              broadcast to all
```

The `Multiplexer` maintains a `Map<absPath, WatcherState>`. Each `WatcherState` holds a `Set<WebSocket>` of all clients watching that file. A new `PollEngine` is only started if the map does not already have an entry for that absolute path.

When the last client disconnects, `clearInterval` is called and the file descriptor is closed immediately.

### 8.4 Data Flow Diagram

```
New line written to logs/app.log
         │
         │  fs.stat() detects size increase (every POLL_INTERVAL_MS)
         ▼
    PollEngine.poll()
         │
         │  fd.read(buffer, 0, newBytes, oldOffset)
         ▼
    LineBuffer.push(rawText)
         │  ├─ Holds "partial line..." if no \n yet
         │  └─ Returns ["complete line 1", "complete line 2"]
         ▼
    Multiplexer.broadcast(lines)
         │
         ├──► ws.send(JSON) ──► Client A
         ├──► ws.send(JSON) ──► Client B
         └──► ws.send(JSON) ──► Client C
```

---

## 9. Edge Cases Handled

### 9.1 Partial Line Writes

Some loggers flush content in multiple writes. For example:

```
Write 1:  "2026-06-24 ERROR Disk"       ← no newline yet
Write 2:  " full\n"                     ← newline arrives
```

**Without buffering:** the client would receive `"2026-06-24 ERROR Disk"` as a line, which is corrupt.

**Our solution (`LineBuffer`):** After every read, the raw text is passed to `LineBuffer.push()`. It splits on `\n` and stores the last segment (which may be incomplete) back in an internal buffer. Only fully terminated lines are returned. On the next poll cycle, the stored fragment is prepended to the new chunk before splitting again.

The client only ever receives complete, newline-terminated log lines.

### 9.2 File Truncation

When `> logs/app.log` or `truncate -s 0 logs/app.log` is run:

- `stat.size` drops below the tracked `offset`.
- The poll engine detects `newSize < currentOffset`.
- `offset` is reset to `0`.
- The `LineBuffer` is cleared.
- A `{ type: "truncated" }` message is broadcast to all clients.
- On the next poll, new writes are streamed from byte 0.

No data is lost or corrupted — the offset reset is atomic from the perspective of the next read.

### 9.3 File Rotation

When `mv logs/app.log logs/app.log.1 && touch logs/app.log` is run (standard `logrotate` behavior):

- The new file at `logs/app.log` has a different inode number than the original.
- Every poll cycle compares `stat.ino` against the stored `currentInode`.
- On mismatch: the old file descriptor is closed, a new one is opened on the same path, `offset` is reset to `0`, `inode` is updated.
- A `{ type: "rotated" }` message is broadcast to all clients.
- Subsequent appends to the new file are streamed normally.

**Windows caveat:** `stat.ino` returns `0` for all files on Windows. Rotation detection is unavailable on Windows — see [Known Limitations](#10-known-limitations).

---

## 10. Known Limitations

| Limitation | Detail |
|------------|--------|
| **In-memory user store** | Users are stored in a `Map` in RAM. All accounts are lost on server restart. For persistence, replace `userStore.ts` with a `better-sqlite3` or PostgreSQL implementation. |
| **File rotation on Windows** | `fs.stat().ino` returns `0` for all files on Windows, so inode-based rotation detection does not work. The service will still stream appends and detect truncation correctly on Windows. |
| **No WebSocket rate limiting** | There is no limit on how many WebSocket connections a single IP can open. In production, add a rate limiter (e.g. `ws` connection count per IP). |
| **Polling latency** | New lines are delivered within at most `POLL_INTERVAL_MS` milliseconds of being written. Reduce `POLL_INTERVAL_MS` for lower latency (increases CPU usage proportionally). |
| **Extension whitelist is name-based** | `ALLOWED_EXTENSIONS` validation is performed on the filename extension, not on file content. A file renamed from `.sh` to `.log` would pass the guard. |
| **No persistent sessions** | JWTs are stateless — there is no token revocation list. Issued tokens remain valid until they expire, even if the user "logs out". |
| **Single process only** | The multiplexer and user store are in-process state. The service cannot be horizontally scaled without adding a shared pub/sub layer (e.g. Redis). |
| **Max body size: 10KB** | The HTTP request body parser rejects payloads larger than 10KB (returns `413`). |

---

## 11. Troubleshooting

**Q: Server exits immediately on startup with "JWT_SECRET too short"**  
A: Your `.env` file either doesn't exist or `JWT_SECRET` is fewer than 32 characters. Run `cp .env.example .env` and set a long secret.

**Q: `npx tsc --noEmit` shows errors**  
A: Run `npm install` to ensure all `@types/*` packages are present, then retry.

**Q: WebSocket connection closes immediately with 401**  
A: Your token may have expired (default TTL is 24h). Re-run `POST /auth/login` to get a fresh token.

**Q: `GET /logs/app.log/tail` returns `404`**  
A: The file must exist inside the `LOGS_DIR` directory. Run `ls logs/` to confirm the file is there, and ensure `LOGS_DIR` in `.env` points to the correct path.

**Q: Log writes aren't showing up in the WebSocket stream**  
A: Check that `POLL_INTERVAL_MS` is set and not too high. Verify you are writing to the file inside `LOGS_DIR`, not a symlinked or absolute path outside it.

**Q: File rotation message never arrives (on macOS)**  
A: macOS APFS volumes do support inode-based rotation detection. Confirm the rotation actually creates a new file at the same path (`ls -i logs/app.log` before and after — the inode number should change).

---

*Built for ZenteiQ.ai internship assignment — June 2026*