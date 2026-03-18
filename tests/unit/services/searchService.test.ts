import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma, makeUser, makeProfile } from '../../setup';

import * as searchService from '../../../src/services/searchService';

beforeEach(() => {
  vi.clearAllMocks();
});

// Shared helpers
function profileWithUser(overrides: object = {}) {
  const profile = makeProfile(overrides);
  return { ...profile, user: { id: 'user-1', name: 'Test User' } };
}

describe('searchUsers', () => {
  it('returns empty array for empty query', async () => {
    const results = await searchService.searchUsers('', 10);
    expect(results).toEqual([]);
    expect(mockPrisma.profile.findMany).not.toHaveBeenCalled();
  });

  it('returns empty array for whitespace-only query', async () => {
    const results = await searchService.searchUsers('   ', 10);
    expect(results).toEqual([]);
  });

  it('searches profiles and users, combining results', async () => {
    const p = profileWithUser({ displayName: 'Alice', discordTag: null, discordId: null });
    mockPrisma.profile.findMany.mockResolvedValue([p]);
    mockPrisma.user.findMany.mockResolvedValue([]); // no extra user matches

    const results = await searchService.searchUsers('alice', 10);

    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe('Alice');
    expect(results[0].userId).toBe('user-1');
  });

  it('respects the limit and caps at 50 from the route layer', async () => {
    // Return 3 profiles but limit=2
    const profiles = [
      profileWithUser({ id: 'p1', username: 'user1', displayName: 'Alpha' }),
      profileWithUser({ id: 'p2', username: 'user2', displayName: 'Beta' }),
      profileWithUser({ id: 'p3', username: 'user3', displayName: 'Gamma' }),
    ];
    mockPrisma.profile.findMany.mockResolvedValue(profiles);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const results = await searchService.searchUsers('a', 2);

    // combined.slice(0, limit) should yield 2
    expect(results).toHaveLength(2);
    expect(mockPrisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 })
    );
  });

  it('merges profile and extra user results without duplicates', async () => {
    // Profile query returns user-1; user query should exclude user-1
    const p = profileWithUser({ displayName: 'Alice' });
    const extraUser = makeUser({ id: 'user-2', name: 'Bob', profile: makeProfile({ id: 'p2', displayName: 'Bob', discordId: null, discordTag: null, avatarUrl: null }) });

    mockPrisma.profile.findMany.mockResolvedValue([p]);
    mockPrisma.user.findMany.mockResolvedValue([extraUser]);

    const results = await searchService.searchUsers('b', 10);

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.userId);
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
  });

  it('passes insensitive search to prisma query', async () => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await searchService.searchUsers('TestQuery', 10);

    expect(mockPrisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ displayName: expect.objectContaining({ mode: 'insensitive' }) }),
          ]),
        }),
      })
    );
  });

  it('returns discordId and discordTag from profile results', async () => {
    const p = profileWithUser({ discordId: 'disc-123', discordTag: 'alice#1234' });
    mockPrisma.profile.findMany.mockResolvedValue([{ ...p }]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const results = await searchService.searchUsers('alice', 10);

    expect(results[0].discordId).toBe('disc-123');
    expect(results[0].discordTag).toBe('alice#1234');
  });

  it('handles profile with null user (orphaned profile)', async () => {
    const profile = makeProfile({ id: 'orphan' });
    const orphaned = { ...profile, user: null };
    mockPrisma.profile.findMany.mockResolvedValue([orphaned]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const results = await searchService.searchUsers('orphan', 10);

    expect(results[0].userId).toBeNull();
  });
});
