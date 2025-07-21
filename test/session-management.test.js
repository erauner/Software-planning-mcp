import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../build/session-manager.js';
import { RedisStorageClient } from '../build/redis-client.js';

describe('Session Management', () => {
  let sessionManager;
  let redisClient;

  before(async () => {
    // Skip Redis tests if Redis is not available
    const redisUrl = process.env.TEST_REDIS_URL || 'redis://localhost:6379';

    try {
      redisClient = new RedisStorageClient({
        url: redisUrl,
        keyPrefix: 'test-sessions',
        ttl: 3600
      });
      await redisClient.client.ping();
      sessionManager = new SessionManager(redisClient);
    } catch (error) {
      console.log('Skipping Redis session tests - Redis not available');
      return;
    }
  });

  beforeEach(async () => {
    if (!redisClient) return;

    // Clean up test keys before each test
    const keys = await redisClient.client.keys('test-sessions:*');
    if (keys.length > 0) {
      await redisClient.client.del(...keys);
    }
  });

  after(async () => {
    if (redisClient) {
      // Clean up test keys
      const keys = await redisClient.client.keys('test-sessions:*');
      if (keys.length > 0) {
        await redisClient.client.del(...keys);
      }
      await redisClient.disconnect();
    }
  });

  it('should create sessions with repository context', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    const session = await sessionManager.createOrUpdateSession({
      userId: 'test-user',
      repository: {
        repoIdentifier: 'github.com/user/repo',
        branch: 'main'
      }
    });

    assert(session.sessionId);
    assert.equal(session.userId, 'test-user');
    assert.equal(session.repository.repoIdentifier, 'github.com/user/repo');
    assert.equal(session.repository.branch, 'main');
    assert(session.createdAt);
    assert(session.lastAccessed);
  });

  it('should find sessions by repository and branch', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    const created = await sessionManager.createOrUpdateSession({
      userId: 'test-user',
      repository: {
        repoIdentifier: 'github.com/user/repo',
        branch: 'feature-x'
      }
    });

    const found = await sessionManager.findSession({
      userId: 'test-user',
      repository: 'github.com/user/repo',
      branch: 'feature-x'
    });

    assert(found);
    assert.equal(found.sessionId, created.sessionId);
    assert.equal(found.repository.branch, 'feature-x');
  });

  it('should get session by IDs', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    const created = await sessionManager.createOrUpdateSession({
      userId: 'test-user-2',
      sessionId: 'custom-session-id',
      repository: {
        repoIdentifier: 'github.com/test/project',
        branch: 'develop'
      }
    });

    const retrieved = await sessionManager.getSessionByIds('test-user-2', 'custom-session-id');

    assert(retrieved);
    assert.equal(retrieved.sessionId, 'custom-session-id');
    assert.equal(retrieved.userId, 'test-user-2');
    assert.equal(retrieved.repository.repoIdentifier, 'github.com/test/project');
  });

  it('should list user sessions', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    // Create multiple sessions for the same user
    await sessionManager.createOrUpdateSession({
      userId: 'multi-user',
      repository: {
        repoIdentifier: 'github.com/repo1',
        branch: 'main'
      }
    });

    await sessionManager.createOrUpdateSession({
      userId: 'multi-user',
      repository: {
        repoIdentifier: 'github.com/repo2',
        branch: 'dev'
      }
    });

    const sessions = await sessionManager.getUserSessions('multi-user');

    assert.equal(sessions.length, 2);
    assert(sessions.some(s => s.repository.repoIdentifier === 'github.com/repo1'));
    assert(sessions.some(s => s.repository.repoIdentifier === 'github.com/repo2'));
  });

  it('should update last accessed time', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    const session = await sessionManager.createOrUpdateSession({
      userId: 'test-user-3',
      repository: {
        repoIdentifier: 'github.com/update/test',
        branch: 'main'
      }
    });

    const originalAccessTime = session.lastAccessed;

    // Wait a bit to ensure time difference
    await new Promise(resolve => setTimeout(resolve, 10));

    const updated = await sessionManager.createOrUpdateSession({
      userId: 'test-user-3',
      sessionId: session.sessionId,
      repository: {
        repoIdentifier: 'github.com/update/test',
        branch: 'main'
      }
    });

    assert(new Date(updated.lastAccessed) > new Date(originalAccessTime));
  });

  it('should isolate sessions by user', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    // Create session for user1
    await sessionManager.createOrUpdateSession({
      userId: 'user1',
      repository: {
        repoIdentifier: 'github.com/shared/repo',
        branch: 'main'
      }
    });

    // Create session for user2 with same repo/branch
    await sessionManager.createOrUpdateSession({
      userId: 'user2',
      repository: {
        repoIdentifier: 'github.com/shared/repo',
        branch: 'main'
      }
    });

    const user1Sessions = await sessionManager.getUserSessions('user1');
    const user2Sessions = await sessionManager.getUserSessions('user2');

    assert.equal(user1Sessions.length, 1);
    assert.equal(user2Sessions.length, 1);
    assert.notEqual(user1Sessions[0].sessionId, user2Sessions[0].sessionId);
  });

  it('should return null for non-existent sessions', async () => {
    if (!sessionManager) return; // Skip if Redis not available

    const notFound = await sessionManager.getSessionByIds('non-existent', 'fake-session');
    assert.equal(notFound, null);

    const notFoundByRepo = await sessionManager.findSession({
      userId: 'test-user',
      repository: 'github.com/does/not/exist',
      branch: 'main'
    });
    assert.equal(notFoundByRepo, null);
  });
});
