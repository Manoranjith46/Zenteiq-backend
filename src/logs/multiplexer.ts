// Multiplexer — WatcherState Management
// Component 8: Multiplexer
// Per Agent_Prompt.md SECTION 3C: One WatcherState per file, multiple clients per watcher

import { WebSocket } from 'ws';
import { createWatcher, closeWatcher, startPolling, stopPolling, WatcherState } from './pollEngine';

/**
 * Global multiplexer: manages one WatcherState per monitored file
 * Maps absolute file path -> WatcherState
 */
class FileMultiplexer {
  private watchers: Map<string, WatcherState> = new Map();

  /**
   * Gets or creates a WatcherState for a file
   * If file already being watched, returns existing watcher
   * If new file, creates watcher, starts polling
   *
   * @param absPath - Absolute path to file
   * @param pollIntervalMs - Poll interval in milliseconds
   * @returns WatcherState for the file
   */
  async getWatcher(absPath: string, pollIntervalMs: number): Promise<WatcherState> {
    // Return existing watcher if already monitoring this file
    if (this.watchers.has(absPath)) {
      return this.watchers.get(absPath)!;
    }

    // Create new watcher
    const watcher = await createWatcher(absPath);
    this.watchers.set(absPath, watcher);

    // Start polling loop
    const filename = this.extractFilename(absPath);
    startPolling(watcher, filename, pollIntervalMs);

    console.log(`[INFO] Started monitoring: ${filename}`);

    return watcher;
  }

  /**
   * Adds a client to a watcher
   * If client already in watcher, no-op (safe to call multiple times)
   *
   * @param absPath - Absolute path to file
   * @param client - WebSocket client to add
   * @returns true if client was added, false if already subscribed
   */
  addClient(absPath: string, client: WebSocket): boolean {
    const watcher = this.watchers.get(absPath);
    if (!watcher) {
      return false; // File not being watched
    }

    // Check if already subscribed
    if (watcher.clients.has(client)) {
      return false;
    }

    watcher.clients.add(client);
    return true;
  }

  /**
   * Removes a client from a watcher
   * If last client, stops polling and cleans up watcher
   *
   * @param absPath - Absolute path to file
   * @param client - WebSocket client to remove
   */
  async removeClient(absPath: string, client: WebSocket): Promise<void> {
    const watcher = this.watchers.get(absPath);
    if (!watcher) {
      return;
    }

    watcher.clients.delete(client);

    // If last client disconnected, cleanup watcher
    if (watcher.clients.size === 0) {
      await this.closeWatcher(absPath);
    }
  }

  /**
   * Closes and cleans up a watcher
   * Stops polling, closes file descriptor, removes from map
   *
   * @param absPath - Absolute path to file
   */
  async closeWatcher(absPath: string): Promise<void> {
    const watcher = this.watchers.get(absPath);
    if (!watcher) {
      return;
    }

    stopPolling(watcher);
    await closeWatcher(watcher);
    this.watchers.delete(absPath);

    const filename = this.extractFilename(absPath);
    console.log(`[INFO] Stopped monitoring: ${filename}`);
  }

  /**
   * Gets all active watchers (for testing/monitoring)
   */
  getWatchers(): Map<string, WatcherState> {
    return new Map(this.watchers);
  }

  /**
   * Clears all watchers (for cleanup, typically on shutdown)
   */
  async closeAll(): Promise<void> {
    const paths = Array.from(this.watchers.keys());
    for (const path of paths) {
      await this.closeWatcher(path);
    }
  }

  /**
   * Gets the number of active watchers
   */
  getWatcherCount(): number {
    return this.watchers.size;
  }

  /**
   * Gets the total number of connected clients
   */
  getTotalClients(): number {
    let total = 0;
    for (const watcher of this.watchers.values()) {
      total += watcher.clients.size;
    }
    return total;
  }

  /**
   * Gets client count for a specific file
   */
  getClientCount(absPath: string): number {
    const watcher = this.watchers.get(absPath);
    return watcher ? watcher.clients.size : 0;
  }

  /**
   * Extracts filename from absolute path (for logging)
   */
  private extractFilename(absPath: string): string {
    const parts = absPath.split(/[/\\]/);
    return parts[parts.length - 1] || absPath;
  }
}

// Singleton instance
export const multiplexer = new FileMultiplexer();
