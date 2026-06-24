// Configuration loader for ZenteiQ Log Monitor
// Validates all environment variables at startup
// Per Agent_Prompt.md SECTION 9: Must define exactly these variables

import 'dotenv/config';

export interface Config {
  PORT: number;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  POLL_INTERVAL_MS: number;
  TAIL_CHUNK_SIZE: number;
  LOGS_DIR: string;
  ALLOWED_EXTENSIONS: string[];
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validates a required environment variable exists and has a value
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Parses a string as an integer with validation
 */
function parseInteger(key: string, value: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new ConfigError(`Environment variable ${key} must be a positive integer, got: ${value}`);
  }
  return parsed;
}

/**
 * Parses comma-separated extensions string
 */
function parseExtensions(value: string): string[] {
  const extensions = value.split(',').map((ext) => ext.trim());
  if (extensions.length === 0) {
    throw new ConfigError('ALLOWED_EXTENSIONS must contain at least one extension');
  }
  // Validate each extension starts with a dot
  for (const ext of extensions) {
    if (!ext.startsWith('.')) {
      throw new ConfigError(`Extension must start with a dot, got: ${ext}`);
    }
  }
  return extensions;
}

/**
 * Loads and validates all configuration from environment variables
 * Exits process with code 1 if any validation fails
 */
export function loadConfig(): Config {
  try {
    const portStr = requireEnv('PORT');
    const jwtSecret = requireEnv('JWT_SECRET');
    const jwtExpiresIn = requireEnv('JWT_EXPIRES_IN');
    const pollIntervalStr = requireEnv('POLL_INTERVAL_MS');
    const tailChunkSizeStr = requireEnv('TAIL_CHUNK_SIZE');
    const logsDir = requireEnv('LOGS_DIR');
    const allowedExtensionsStr = requireEnv('ALLOWED_EXTENSIONS');

    // Validate JWT_SECRET length (per spec: at least 32 chars in production)
    if (jwtSecret.length < 32) {
      console.error('[WARN] JWT_SECRET is less than 32 characters. This is not recommended for production.');
    }

    const config: Config = {
      PORT: parseInteger('PORT', portStr),
      JWT_SECRET: jwtSecret,
      JWT_EXPIRES_IN: jwtExpiresIn,
      POLL_INTERVAL_MS: parseInteger('POLL_INTERVAL_MS', pollIntervalStr),
      TAIL_CHUNK_SIZE: parseInteger('TAIL_CHUNK_SIZE', tailChunkSizeStr),
      LOGS_DIR: logsDir,
      ALLOWED_EXTENSIONS: parseExtensions(allowedExtensionsStr),
    };

    // Validate numeric ranges
    if (config.POLL_INTERVAL_MS < 10) {
      throw new ConfigError('POLL_INTERVAL_MS must be at least 10ms');
    }
    if (config.TAIL_CHUNK_SIZE < 1024) {
      throw new ConfigError('TAIL_CHUNK_SIZE must be at least 1024 bytes');
    }

    console.log('[INFO] Configuration loaded and validated successfully');
    return config;
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : `Configuration error: ${String(error)}`;
    console.error(`[ERROR] ${message}`);
    process.exit(1);
  }
}

