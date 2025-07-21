import { RedisStorageClient } from './redis-client.js';
import { SessionContext, IStorage } from './types.js';
import { Storage } from './storage.js';
import { RedisStorage } from './storage-adapters/redis-storage.js';
import { AppConfig } from './config.js';

export interface IStorageFactory {
  createFileStorage(context: SessionContext): Promise<IStorage>;
  createRedisStorage(context: SessionContext): Promise<IStorage>;
}

export class StorageFactory implements IStorageFactory {
  private redisClient?: RedisStorageClient;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;

    if (config.storage.type === 'redis' && config.storage.redis) {
      this.redisClient = new RedisStorageClient(config.storage.redis);
    }
  }

  async createFileStorage(context: SessionContext): Promise<IStorage> {
    const storage = new Storage(
      context.repository.localPath || process.cwd(),
      context.repository.branch
    );
    await storage.initialize();
    return storage;
  }

  async createRedisStorage(context: SessionContext): Promise<IStorage> {
    if (!this.redisClient) {
      throw new Error('Redis client not configured');
    }

    const storage = new RedisStorage(this.redisClient, context);
    await storage.initialize();
    return storage;
  }

  async createStorage(context: SessionContext): Promise<IStorage> {
    if (this.config.storage.type === 'redis') {
      return this.createRedisStorage(context);
    } else {
      return this.createFileStorage(context);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (this.config.storage.type === 'redis' && this.redisClient) {
      return await this.redisClient.healthCheck();
    }
    return true; // File storage always available
  }
}
