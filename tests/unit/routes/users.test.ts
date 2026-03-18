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
// GET /users/me
// ---------------------------------------------------------------------------
describe('GET /users/me', () => {
  it('returns 401 when X-User-Id header is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns current user when authenticated', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('user-1');
    expect(body.email).toBe('user@example.com');
  });

  it('returns 404 when user not found in DB', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { 'x-user-id': 'nonexistent' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /users/me
// ---------------------------------------------------------------------------
describe('PUT /users/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/users/me',
      payload: { name: 'New Name' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('updates user profile fields successfully', async () => {
    const original = makeUser();
    const updated = makeUser({ name: 'New Name', walletAddress: '0xDEADBEEF' });

    mockPrisma.user.findUnique.mockResolvedValue(original);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { name: 'New Name', walletAddress: '0xDEADBEEF' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('New Name');
    expect(body.walletAddress).toBe('0xDEADBEEF');
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: {
        'x-user-id': 'ghost',
        'content-type': 'application/json',
      },
      payload: { name: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /users/me/stats
// ---------------------------------------------------------------------------
describe('GET /users/me/stats', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/me/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('returns user stats when authenticated', async () => {
    const user = makeUser({
      profile: makeProfile({ displayName: 'Test', bio: 'Bio', avatarUrl: 'https://cdn.example.com/a.jpg' }),
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'GET',
      url: '/users/me/stats',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBe('user-1');
    expect(body.profileComplete).toBe(true);
    expect(body.campaignLimit).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// GET /users/by-username/:username
// ---------------------------------------------------------------------------
describe('GET /users/by-username/:username', () => {
  it('returns public profile without authentication', async () => {
    const profile = makeProfile({ username: 'publicuser', isPublic: true });
    const user = makeUser({ profile });
    mockPrisma.profile.findUnique.mockResolvedValue({ ...profile, user });

    const res = await app.inject({
      method: 'GET',
      url: '/users/by-username/publicuser',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('publicuser');
    expect(body.isPublic).toBe(true);
  });

  it('returns limited data for private profile', async () => {
    const profile = makeProfile({ username: 'privateuser', isPublic: false, bio: 'secret' });
    const user = makeUser({ profile });
    mockPrisma.profile.findUnique.mockResolvedValue({ ...profile, user });

    const res = await app.inject({
      method: 'GET',
      url: '/users/by-username/privateuser',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isPublic).toBe(false);
    expect(body.bio).toBeUndefined();
  });

  it('returns 404 for non-existent username', async () => {
    mockPrisma.profile.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/users/by-username/nobody',
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:id  (public profile view)
// ---------------------------------------------------------------------------
describe('GET /users/:id', () => {
  it('returns public-safe user data without authentication', async () => {
    const profile = makeProfile({ isPublic: true, bio: 'Public bio' });
    const user = makeUser({ id: 'user-1', profile });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({ method: 'GET', url: '/users/user-1' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Should expose id, name, image, and profile subset
    expect(body.id).toBe('user-1');
    expect(body.profile).toBeDefined();
    expect(body.profile.bio).toBe('Public bio');
    // Sensitive fields NOT present at user level
    expect(body.email).toBeUndefined();
    expect(body.walletAddress).toBeUndefined();
    expect(body.phoneNumber).toBeUndefined();
  });

  it('hides private profile details (bio, location, etc.) for private profiles', async () => {
    const profile = makeProfile({
      isPublic: false,
      bio: 'hidden',
      location: 'hidden location',
      website: 'https://hidden.com',
    });
    const user = makeUser({ profile });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({ method: 'GET', url: '/users/user-1' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.bio).toBeUndefined();
    expect(body.profile.location).toBeUndefined();
    expect(body.profile.website).toBeUndefined();
    expect(body.profile.socialLinks).toBeUndefined();
  });

  it('returns null profile when user has no profile', async () => {
    const user = makeUser({ profile: null });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({ method: 'GET', url: '/users/user-1' });

    expect(res.statusCode).toBe(200);
    expect(res.json().profile).toBeNull();
  });

  it('returns 404 for non-existent user ID', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({ method: 'GET', url: '/users/ghost' });

    expect(res.statusCode).toBe(404);
  });
});
