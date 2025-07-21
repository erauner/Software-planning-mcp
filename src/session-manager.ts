import { v4 as uuidv4 } from 'uuid';
import { RedisStorageClient } from './redis-client.js';
import { RepositoryContext, SessionContext } from './types.js';

interface CreateSessionArgs {
  userId: string;
  sessionId?: string;
  repository: RepositoryContext;
}

export class SessionManager {
  private redis: RedisStorageClient;

  constructor(redis: RedisStorageClient) {
    this.redis = redis;
  }

  async createOrUpdateSession(args: CreateSessionArgs): Promise<SessionContext> {
    const sessionId = args.sessionId || uuidv4();

    const session: SessionContext = {
      userId: args.userId,
      sessionId,
      repository: args.repository,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    };

    // Store session data
    const sessionKey = this.redis.sessionKey(args.userId, sessionId);
    await this.redis.set(sessionKey, JSON.stringify(session));

    // Add to user's session list
    const userSessionsKey = this.redis.userSessionsKey(args.userId);
    await this.redis.sadd(userSessionsKey, sessionId);

    return session;
  }

  async getSession(sessionId: string): Promise<SessionContext | null> {
    // We need to find which user this session belongs to
    // This is a limitation of the current key structure
    // In a real implementation, we might want a global session index
    throw new Error('getSession requires userId - use validateSession instead');
  }

  async validateSession(sessionId: string, userId: string): Promise<boolean> {
    const sessionKey = this.redis.sessionKey(userId, sessionId);
    return await this.redis.exists(sessionKey);
  }

  async getUserSessions(userId: string): Promise<SessionContext[]> {
    const userSessionsKey = this.redis.userSessionsKey(userId);
    const sessionIds = await this.redis.smembers(userSessionsKey);

    const sessions: SessionContext[] = [];

    for (const sessionId of sessionIds) {
      const sessionKey = this.redis.sessionKey(userId, sessionId);
      const sessionData = await this.redis.get(sessionKey);

      if (sessionData) {
        sessions.push(JSON.parse(sessionData));
      }
    }

    return sessions;
  }
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const sessionKey = this.redis.sessionKey(userId, sessionId);
    await this.redis.del(sessionKey);

    // Remove from user's session list
    const userSessionsKey = this.redis.userSessionsKey(userId);
    await this.redis.srem(userSessionsKey, sessionId);
  }

  async findSession(criteria: {
    userId: string;
    repository: string;
    branch: string;
  }): Promise<SessionContext | null> {
    const sessions = await this.getUserSessions(criteria.userId);

    return sessions.find(session =>
      session.repository.repoIdentifier === criteria.repository &&
      session.repository.branch === criteria.branch
    ) || null;
  }

  async getSessionByIds(userId: string, sessionId: string): Promise<SessionContext | null> {
    const sessionKey = this.redis.sessionKey(userId, sessionId);
    const sessionData = await this.redis.get(sessionKey);

    if (!sessionData) {
      return null;
    }

    return JSON.parse(sessionData);
  }
}
