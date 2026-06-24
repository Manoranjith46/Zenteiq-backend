// Auth Middleware — JWT Extraction and Validation
// Component 4: Auth Service - authMiddleware
// Per Agent_Prompt.md SECTION 4G: Extract JWT from Authorization header (Bearer token)

import { IncomingHttpHeaders } from 'http';
import { Config } from '../config';
import { verifyToken, TokenPayload } from './authService';

/**
 * Extracts Bearer token from Authorization header
 * Format: "Bearer <token>"
 * Returns null if header is missing or malformed
 */
export function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) {
    return null;
  }

  if (!authorizationHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validates a JWT token and returns the payload
 * Throws error if token is invalid or expired
 */
export function validateToken(token: string, config: Config): TokenPayload {
  return verifyToken(token, config);
}

/**
 * Middleware for HTTP requests
 * Extracts and validates JWT from Authorization header
 * Returns payload if valid, throws error otherwise
 */
export function authenticateRequest(headers: IncomingHttpHeaders, config: Config): TokenPayload {
  const token = extractBearerToken(headers.authorization);

  if (!token) {
    throw new Error('Missing or invalid Authorization header');
  }

  return validateToken(token, config);
}

/**
 * Extracts JWT from query parameter (for WebSocket connections)
 * Per spec SECTION 4G: WS token passed as query param ?token=<jwt>
 * This is a trade-off: query params appear in server access logs
 * Returns null if query param is missing
 */
export function extractQueryToken(queryString?: string): string | null {
  if (!queryString) {
    return null;
  }

  // Simple query param extraction (handles ?token=abc123)
  const params = new URLSearchParams(queryString);
  const token = params.get('token');

  return token && token.length > 0 ? token : null;
}

/**
 * Validates a JWT token from WebSocket query parameters
 * Throws error if token is invalid or expired
 */
export function authenticateWebSocket(queryString: string | undefined, config: Config): TokenPayload {
  const token = extractQueryToken(queryString);

  if (!token) {
    throw new Error('Missing token query parameter');
  }

  return validateToken(token, config);
}
