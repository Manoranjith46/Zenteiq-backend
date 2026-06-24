// Auth Routes — Authentication Endpoints
// Component 5: HTTP Server - authRoutes
// Per SECTION 4H: POST /auth/register, POST /auth/login, GET /auth/me

import { IncomingMessage, ServerResponse } from 'http';
import { Config } from '../config';
import { registerUser, loginUser, getCurrentUser } from '../auth/authService';
import { authenticateRequest } from '../auth/authMiddleware';
import {
  sendCreated,
  sendSuccess,
  sendBadRequest,
  sendConflict,
  sendUnauthorized,
  sendInternalError,
  parseJSONBody,
} from '../utils/httpHelpers';

/**
 * POST /auth/register
 * Request: { email: string, password: string }
 * Response: { token: string, user: { id, email, createdAt } }
 * Errors: 400 (validation), 409 (duplicate)
 */
export async function handleRegister(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  try {
    const body = await parseJSONBody<{ email?: string; password?: string }>(req);

    const { email, password } = body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      sendBadRequest(res, 'Email is required');
      return;
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      sendBadRequest(res, 'Password is required');
      return;
    }

    try {
      const response = await registerUser(email, password, config);
      sendCreated(res, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';

      if (message.includes('already exists')) {
        sendConflict(res, message);
      } else {
        sendBadRequest(res, message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse request';
    sendBadRequest(res, message);
  }
}

/**
 * POST /auth/login
 * Request: { email: string, password: string }
 * Response: { token: string, user: { id, email, createdAt } }
 * Errors: 400 (validation), 401 (invalid credentials)
 */
export async function handleLogin(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  try {
    const body = await parseJSONBody<{ email?: string; password?: string }>(req);

    const { email, password } = body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      sendBadRequest(res, 'Email is required');
      return;
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      sendBadRequest(res, 'Password is required');
      return;
    }

    try {
      const response = await loginUser(email, password, config);
      sendSuccess(res, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      sendUnauthorized(res, message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse request';
    sendBadRequest(res, message);
  }
}

/**
 * GET /auth/me
 * Headers: Authorization: Bearer <token>
 * Response: { id: string, email: string, createdAt: string }
 * Errors: 401 (missing/invalid token)
 */
export async function handleMe(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  try {
    const payload = authenticateRequest(req.headers, config);
    const user = getCurrentUser(payload);
    sendSuccess(res, user);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    sendUnauthorized(res, message);
  }
}

/**
 * Routes auth requests to appropriate handler
 */
export async function handleAuthRoute(
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<boolean> {
  if (path === '/auth/register' && method === 'POST') {
    await handleRegister(req, res, config);
    return true;
  }

  if (path === '/auth/login' && method === 'POST') {
    await handleLogin(req, res, config);
    return true;
  }

  if (path === '/auth/me' && method === 'GET') {
    await handleMe(req, res, config);
    return true;
  }

  return false;
}
