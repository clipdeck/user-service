import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, mockPrisma, makeUser, makeProfile } from '../../setup';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /users/search
// ---------------------------------------------------------------------------
describe('POST /users/search', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      payload: { query: 'alice' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when query is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { limit: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when query is an empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { query: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns search results for a valid query', async () => {
    const profile = makeProfile({ displayName: 'Alice', discordTag: null });
    const profileWithUser = { ...profile, user: { id: 'user-1', name: 'Alice' } };

    mockPrisma.profile.findMany.mockResolvedValue([profileWithUser]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { query: 'alice' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].displayName).toBe('Alice');
  });

  it('respects the limit parameter up to 50', async () => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { query: 'test', limit: 25 },
    });

    expect(res.statusCode).toBe(200);
    // Verify prisma was called with limit 25
    expect(mockPrisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 })
    );
  });

  it('clamps limit to 50 when value exceeds maximum', async () => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { query: 'test', limit: 200 },
    });

    expect(res.statusCode).toBe(200);
    // Route clamps limit: Math.min(200, 50) = 50
    expect(mockPrisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('defaults limit to 10 when not provided', async () => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { query: 'test' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.profile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  it('returns empty results array when nothing matches', async () => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { query: 'zzznomatch' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual([]);
  });
});
