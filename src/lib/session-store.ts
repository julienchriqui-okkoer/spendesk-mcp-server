/**
 * Extended session store that includes client token and optional client credentials.
 */

import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ClientCredentials } from "../middleware/auth.js";

export interface SessionInfo {
  transport: StreamableHTTPServerTransport;
  clientToken?: string;
  /** When set, use client_credentials auth for this session (from Dust/Claude at connection time). */
  clientCredentials?: ClientCredentials;
  createdAt: number;
}

export class SessionStore {
  private sessions: Map<string, SessionInfo> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    // Cleanup expired sessions every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);
  }

  /**
   * Store a session with optional client token, company info, or client credentials.
   */
  set(
    sessionId: string,
    transport: StreamableHTTPServerTransport,
    clientToken?: string,
    clientCredentials?: ClientCredentials
  ): void {
    this.sessions.set(sessionId, {
      transport,
      clientToken,
      clientCredentials,
      createdAt: Date.now(),
    });
  }

  /**
   * Get session info by ID.
   */
  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get transport by session ID.
   */
  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.sessions.get(sessionId)?.transport;
  }

  /**
   * Delete a session.
   */
  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Check if session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get all session IDs.
   */
  keys(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Cleanup expired sessions.
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, info] of this.sessions.entries()) {
      if (now - info.createdAt > this.SESSION_TIMEOUT_MS) {
        try {
          info.transport.close();
        } catch (err) {
          console.error(`Error closing expired session ${sessionId}:`, err);
        }
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Close all sessions and cleanup.
   */
  async closeAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    const closePromises = Array.from(this.sessions.values()).map(async (info) => {
      try {
        await info.transport.close();
      } catch (err) {
        console.error("Error closing transport:", err);
      }
    });

    await Promise.all(closePromises);
    this.sessions.clear();
  }
}
