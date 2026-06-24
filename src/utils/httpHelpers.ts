// HTTP Helpers — Response and Error Utilities
// Component 5: HTTP Server - httpHelpers

import { ServerResponse } from 'http';

/**
 * Standard JSON error response format per SECTION 7
 */
export interface ErrorResponse {
  error: string;
  code: string;
}

/**
 * Sends a JSON response with status code
 * Per SECTION 7: Always return JSON, never raw strings or stack traces
 */
export function sendJSON<T>(res: ServerResponse, statusCode: number, data: T): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Sends a successful JSON response (200 OK)
 */
export function sendSuccess<T>(res: ServerResponse, data: T): void {
  sendJSON(res, 200, data);
}

/**
 * Sends a created response (201)
 */
export function sendCreated<T>(res: ServerResponse, data: T): void {
  sendJSON(res, 201, data);
}

/**
 * Sends a bad request error (400)
 * Per SECTION 7: error messages must be clear, no stack traces
 */
export function sendBadRequest(res: ServerResponse, message: string): void {
  sendJSON(res, 400, {
    error: message,
    code: 'BAD_REQUEST',
  } as ErrorResponse);
}

/**
 * Sends an unauthorized error (401)
 */
export function sendUnauthorized(res: ServerResponse, message: string = 'Unauthorized'): void {
  sendJSON(res, 401, {
    error: message,
    code: 'UNAUTHORIZED',
  } as ErrorResponse);
}

/**
 * Sends a forbidden error (403)
 */
export function sendForbidden(res: ServerResponse, message: string = 'Forbidden'): void {
  sendJSON(res, 403, {
    error: message,
    code: 'FORBIDDEN',
  } as ErrorResponse);
}

/**
 * Sends a not found error (404)
 */
export function sendNotFound(res: ServerResponse, message: string = 'Not found'): void {
  sendJSON(res, 404, {
    error: message,
    code: 'NOT_FOUND',
  } as ErrorResponse);
}

/**
 * Sends a conflict error (409)
 * Used for duplicate resource creation (e.g., user already exists)
 */
export function sendConflict(res: ServerResponse, message: string): void {
  sendJSON(res, 409, {
    error: message,
    code: 'CONFLICT',
  } as ErrorResponse);
}

/**
 * Sends an internal server error (500)
 * Never exposes internal error details to client
 */
export function sendInternalError(res: ServerResponse, message: string = 'Internal server error'): void {
  console.error(`[ERROR] ${message}`);
  sendJSON(res, 500, {
    error: message,
    code: 'INTERNAL_ERROR',
  } as ErrorResponse);
}

/**
 * Parses JSON body from request
 * Returns parsed object or throws error
 */
export async function parseJSONBody<T>(req: any): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      // Prevent abuse: reject if body exceeds 10KB
      if (body.length > 10240) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        resolve(parsed as T);
      } catch (error) {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Parses query string from URL
 * Returns Map of query parameters
 */
export function parseQueryString(queryString?: string): Map<string, string> {
  const params = new Map<string, string>();

  if (!queryString) {
    return params;
  }

  const pairs = queryString.split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key) {
      params.set(decodeURIComponent(key), value ? decodeURIComponent(value) : '');
    }
  }

  return params;
}

/**
 * Extracts path and query string from URL
 */
export function parseURL(url?: string): { path: string; queryString?: string } {
  if (!url) {
    return { path: '/' };
  }

  const [path, queryString] = url.split('?');
  return { path, queryString };
}
