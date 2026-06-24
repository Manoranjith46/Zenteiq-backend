// User Store — In-Memory Storage
// Component 4: Auth Service - userStore
// Per Agent_Prompt.md SECTION 4G: In-memory Map for user storage
// NOTE: This resets on server restart. For persistence, use better-sqlite3.

import { randomUUID } from 'crypto';

/**
 * User record stored in memory
 */
export interface User {
  id: string; // UUID
  email: string; // Unique identifier, lowercase
  passwordHash: string; // bcrypt hash
  createdAt: string; // ISO 8601 timestamp
}

/**
 * In-memory user store using Map
 * Key: email (lowercase), Value: User
 */
class UserStore {
  private users: Map<string, User> = new Map();

  /**
   * Adds a new user to the store
   * Throws error if email already exists
   */
  createUser(email: string, passwordHash: string): User {
    const normalizedEmail = email.toLowerCase().trim();

    if (this.users.has(normalizedEmail)) {
      throw new Error(`User with email ${email} already exists`);
    }

    const user: User = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    this.users.set(normalizedEmail, user);
    return user;
  }

  /**
   * Retrieves a user by email
   * Returns null if not found
   */
  getUserByEmail(email: string): User | null {
    const normalizedEmail = email.toLowerCase().trim();
    return this.users.get(normalizedEmail) ?? null;
  }

  /**
   * Retrieves a user by ID
   * Returns null if not found
   */
  getUserById(id: string): User | null {
    for (const user of this.users.values()) {
      if (user.id === id) {
        return user;
      }
    }
    return null;
  }

  /**
   * Gets count of all users (for testing/debugging)
   */
  getUserCount(): number {
    return this.users.size;
  }

  /**
   * Clears all users (for testing only - not exported in production)
   */
  _clearAll(): void {
    this.users.clear();
  }
}

// Export singleton instance
export const userStore = new UserStore();
