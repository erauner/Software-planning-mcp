import { config } from 'dotenv';

// Load environment variables
config();

export interface RedisConfig {
  url: string;
  keyPrefix: string;
  ttl?: number; // Session TTL in seconds
  maxRetries?: number;
}

export interface StorageMode {
  type: 'file' | 'redis';
  redis?: RedisConfig;
}

export interface AppConfig {
  storage: StorageMode;
  repository: {
    idMode: 'auto' | 'explicit' | 'path';
    defaultRepository?: string;
    enableMultiRepo: boolean;
  };
  sessionCleanup: {
    enabled: boolean;
    intervalMs: number;
  };
}

export function loadConfig(): AppConfig {
  const storageMode = (process.env.STORAGE_MODE as 'file' | 'redis') || 'file';

  return {
    storage: {
      type: storageMode,
      redis: storageMode === 'redis' ? {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'planning',
        ttl: parseInt(process.env.REDIS_TTL || '2592000'), // 30 days
        maxRetries: 3
      } : undefined
    },
    repository: {
      idMode: (process.env.REPO_ID_MODE as 'auto' | 'explicit' | 'path') || 'auto',
      defaultRepository: process.env.DEFAULT_REPOSITORY,
      enableMultiRepo: process.env.ENABLE_MULTI_REPO === 'true'
    },
    sessionCleanup: {
      enabled: process.env.ENABLE_SESSION_CLEANUP === 'true',
      intervalMs: parseInt(process.env.SESSION_CLEANUP_INTERVAL || '3600000')
    }
  };
}
