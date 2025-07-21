import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectRepositoryId, extractRepoIdentifier, detectCurrentBranch } from '../build/utils/repo-identifier.js';

describe('Repository Identification', () => {
  describe('extractRepoIdentifier', () => {
    it('should parse various Git URL formats', () => {
      const cases = [
        ['https://github.com/user/repo.git', 'github.com/user/repo'],
        ['git@github.com:user/repo.git', 'github.com/user/repo'],
        ['https://gitlab.com/group/subgroup/project', 'gitlab.com/group/subgroup/project'],
        ['ssh://git@bitbucket.org/team/repo.git', 'bitbucket.org/team/repo'],
        ['https://github.com/user/repo', 'github.com/user/repo'], // without .git
        ['git@gitlab.com:namespace/project.git', 'gitlab.com/namespace/project'],
        ['https://dev.azure.com/org/project/_git/repo', 'dev.azure.com/org/project/_git/repo']
      ];

      for (const [url, expected] of cases) {
        assert.equal(extractRepoIdentifier(url), expected);
      }
    });

    it('should handle edge cases', () => {
      // Test URLs without standard patterns
      try {
        extractRepoIdentifier('invalid-url');
        assert.fail('Should throw error for invalid URL');
      } catch (error) {
        assert(error.message.includes('Unable to parse repository URL'));
      }
    });
  });

  describe('detectRepositoryId', () => {
    it('should detect repository ID from current directory', async () => {
      // This test might be environment-dependent
      // For now, just test that it returns a string
      const repoId = await detectRepositoryId();
      assert(typeof repoId === 'string');
      assert(repoId.length > 0);
    });

    it('should handle non-git directories', async () => {
      const repoId = await detectRepositoryId('/tmp');
      // Should return some fallback ID for non-git directories
      assert(typeof repoId === 'string');
    });
  });

  describe('detectCurrentBranch', () => {
    it('should detect current branch', async () => {
      const branch = await detectCurrentBranch();
      assert(typeof branch === 'string');
      assert(branch.length > 0);
    });

    it('should handle non-git directories', async () => {
      const branch = await detectCurrentBranch('/tmp');
      // Should return default branch for non-git directories
      assert.equal(branch, 'default');
    });
  });
});
