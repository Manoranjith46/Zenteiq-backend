// Path Guard — Security Module
// Component 3: Path Guard (CRITICAL SECURITY)
// Per Agent_Prompt.md SECTION 4D: Prevents directory traversal attacks

import path from 'path';
import { Config } from '../config';

/**
 * Custom error for path security violations
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * Filename validation rules:
 * - Must match /^[\w\-\.]+$/ (alphanumeric, dash, underscore, dot)
 * - Must NOT start with a dot (no hidden files: .env, .ssh, etc.)
 * - Must NOT be empty
 * - Extension must be in ALLOWED_EXTENSIONS from config
 */
const FILENAME_REGEX = /^[\w\-.]+$/;

/**
 * Validates a filename according to security rules
 * Throws SecurityError if validation fails
 */
export function validateFilename(filename: string, allowedExtensions: string[]): void {
  // Rule 1: Must not be empty
  if (!filename || filename.trim() === '') {
    throw new SecurityError('Filename cannot be empty');
  }

  // Rule 2: Must not start with a dot (no hidden files)
  if (filename.startsWith('.')) {
    throw new SecurityError(`Path traversal attempt blocked: filename cannot start with dot`);
  }

  // Rule 3: Must match alphanumeric/dash/underscore/dot only
  if (!FILENAME_REGEX.test(filename)) {
    throw new SecurityError(`Path traversal attempt blocked: invalid characters in filename: ${filename}`);
  }

  // Rule 4: Extension must be in ALLOWED_EXTENSIONS
  const fileExtension = path.extname(filename);
  if (!allowedExtensions.includes(fileExtension)) {
    throw new SecurityError(
      `File extension '${fileExtension}' not allowed. Allowed: ${allowedExtensions.join(', ')}`,
    );
  }
}

/**
 * Resolves and validates a file path to ensure it stays within LOGS_DIR
 * Per SECTION 4D algorithm:
 *   1. Decode URI components (catch %2F%2E%2E style traversal)
 *   2. Use path.basename to strip all directory components
 *   3. Resolve relative to LOGS_DIR
 *   4. Final check: resolved path must start with LOGS_DIR + path.sep
 *
 * @param rawInput - Raw input from client (may contain encoded traversal attempts)
 * @param config - Config object with LOGS_DIR and ALLOWED_EXTENSIONS
 * @returns Absolute path to file, guaranteed to be within LOGS_DIR
 * @throws SecurityError if path is invalid or attempts traversal
 */
export function resolveAndGuard(rawInput: string, config: Config): string {
  // Step 1: Decode URI components to catch encoded traversal (e.g., %2F%2E%2E = "/..")
  const decoded = decodeURIComponent(rawInput);

  // Step 2: Extract basename only (strips all directory components)
  const basename = path.basename(decoded);

  // Step 3: Validate filename against security rules
  validateFilename(basename, config.ALLOWED_EXTENSIONS);

  // Step 4: Resolve the path relative to LOGS_DIR
  const logsDir = path.resolve(process.cwd(), config.LOGS_DIR);
  const resolved = path.resolve(logsDir, basename);

  // Step 5: Final check - resolved path must be within LOGS_DIR
  // Use both checks to handle edge cases:
  //   - resolved.startsWith(logsDir + path.sep) for normal files in logs dir
  //   - resolved === logsDir for edge case when LOGS_DIR itself is requested (reject)
  const isWithinLogsDir = resolved.startsWith(logsDir + path.sep);
  if (!isWithinLogsDir) {
    throw new SecurityError(`Path traversal attempt blocked: ${rawInput}`);
  }

  return resolved;
}

/**
 * Utility to extract the filename from a resolved path (for logging/responses)
 */
export function extractFilename(resolvedPath: string): string {
  return path.basename(resolvedPath);
}
