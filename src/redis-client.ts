import { Redis } from 'ioredis';
import type { RedisConfig } from './config.js';

export class RedisStorageClient {
  private client: Redis;
  private config: RedisConfig;

  constructor(config: RedisConfig) {
    this.config = config;
    this.client = new Redis(config.url, {
      maxRetriesPerRequest: config.maxRetries || 3,
      keyPrefix: config.keyPrefix + ':'
    });
  }

  // Key generation helpers
  sessionKey(userId: string, sessionId: string): string {
    return `session:${userId}:${sessionId}`;
  }

  userSessionsKey(userId: string): string {
    return `user:${userId}:sessions`;
  }

  // Repository+branch specific data (shared across users)
  repoDataKey(repoId: string, branch: string): string {
    return `repo:${repoId}:branch:${branch}:data`;
  }

  // User's data for a specific repo+branch
  userRepoDataKey(userId: string, repoId: string, branch: string): string {
    return `user:${userId}:repo:${repoId}:branch:${branch}`;
  }

  // Index of all branches for a repository
  repoBranchesKey(repoId: string): string {
    return `repo:${repoId}:branches`;
  }

  // Connection management
  async connect(): Promise<void> {
    // Redis client connects automatically, so just test the connection
    await this.client.ping();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  // Redis operations
  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.setex(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async sadd(key: string, member: string): Promise<void> {
    await this.client.sadd(key, member);
  }

  async srem(key: string, member: string): Promise<void> {
    await this.client.srem(key, member);
  }

  async smembers(key: string): Promise<string[]> {
    return await this.client.smembers(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }
}
