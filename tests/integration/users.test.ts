import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, mockPrisma, mockPublisher, makeUser, makeProfile } from '../setup';

/**
 * Integration-style tests that exercise full request/response cycles
 * through all layers: route -> service -> (mocked) prisma.
 * These tests do NOT require a live database.
 */

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
// Full user CRUD flow
// ---------------------------------------------------------------------------
describe('User profile read flow', () => {
  it('authenticated user can read their own full profile', async () => {
    const profile = makeProfile({
      displayName: 'John Doe',
      username: 'johndoe',
      bio: 'I make content',
      role: 'CREATOR',
    });
    const user = makeUser({
      id: 'usr-abc',
      name: 'John Doe',
      email: 'john@example.com',
      profile,
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: {
        'x-user-id': 'usr-abc',
        'x-user-email': 'john@example.com',
        'x-user-name': 'John Doe',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Full data available to owner
    expect(body.id).toBe('usr-abc');
    expect(body.email).toBe('john@example.com');
    expect(body.profile.bio).toBe('I make content');
    expect(body.profile.username).toBe('johndoe');
  });

  it('public endpoint returns limited data for another user', async () => {
    const profile = makeProfile({
      displayName: 'Jane Smith',
      bio: 'Creator',
      isPublic: true,
    });
    const user = makeUser({ id: 'usr-xyz', email: 'jane@example.com', profile });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    // Access without auth
    const res = await app.inject({ method: 'GET', url: '/users/usr-xyz' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Sensitive fields stripped
    expect(body.email).toBeUndefined();
    expect(body.phoneNumber).toBeUndefined();
    expect(body.walletAddress).toBeUndefined();
    // Public-safe fields present
    expect(body.id).toBe('usr-xyz');
    expect(body.profile.bio).toBe('Creator');
  });
});

// ---------------------------------------------------------------------------
// Update flow
// ---------------------------------------------------------------------------
describe('User update flow', () => {
  it('PUT /users/me updates user and returns updated document', async () => {
    const original = makeUser({ name: 'Old Name', walletAddress: null });
    const updated = makeUser({ name: 'New Name', walletAddress: '0xNEW' });

    mockPrisma.user.findUnique.mockResolvedValue(original);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PUT',
      url: '/users/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { name: 'New Name', walletAddress: '0xNEW' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('New Name');
    expect(res.json().walletAddress).toBe('0xNEW');
  });

  it('PUT /profiles/me triggers a profile_updated event', async () => {
    const user = makeUser();
    const updatedProfile = makeProfile({ bio: 'Updated bio' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { bio: 'Updated bio' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPublisher.publish).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Onboarding flow
// ---------------------------------------------------------------------------
describe('Onboarding flow', () => {
  it('completes onboarding on first PATCH request', async () => {
    const user = makeUser({ onboardingCompleted: false });
    const completed = makeUser({ onboardingCompleted: true });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.user.update.mockResolvedValue(completed);

    const res = await app.inject({
      method: 'PATCH',
      url: '/profiles/me/onboarding',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().onboardingCompleted).toBe(true);
  });

  it('returns 409 on duplicate onboarding completion attempt', async () => {
    const user = makeUser({ onboardingCompleted: true });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'PATCH',
      url: '/profiles/me/onboarding',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Referral flow
// ---------------------------------------------------------------------------
describe('Referral flow', () => {
  it('full referral lifecycle: generate code then apply it', async () => {
    // Step 1: referrer generates code
    const referrer = makeUser({ id: 'referrer-1', referralCode: null });
    const referrerWithCode = makeUser({ id: 'referrer-1', referralCode: 'REFABC1' });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(referrer)  // fetch referrer
      .mockResolvedValue(null);         // no code collision

    mockPrisma.user.update.mockResolvedValue(referrerWithCode);

    const generateRes = await app.inject({
      method: 'POST',
      url: '/referrals/generate',
      headers: { 'x-user-id': 'referrer-1' },
    });

    expect(generateRes.statusCode).toBe(201);
    expect(generateRes.json().referralCode).toBeTruthy();

    vi.clearAllMocks();

    // Step 2: new user applies the referrer's code
    const newUser = makeUser({ id: 'new-user-1', referredById: null });
    const referrerForApply = makeUser({ id: 'referrer-1', referralCode: 'REFABC1', referralCount: 0 });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(newUser)
      .mockResolvedValueOnce(referrerForApply);

    mockPrisma.$transaction.mockResolvedValue([]);

    const applyRes = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      headers: {
        'x-user-id': 'new-user-1',
        'content-type': 'application/json',
      },
      payload: { referralCode: 'REFABC1' },
    });

    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().success).toBe(true);
    expect(applyRes.json().referrerId).toBe('referrer-1');
  });
});

// ---------------------------------------------------------------------------
// Search flow
// ---------------------------------------------------------------------------
describe('Search flow', () => {
  it('authenticated user can search for other users', async () => {
    const p1 = makeProfile({ id: 'p1', displayName: 'Alice', username: 'alice', discordTag: null });
    const p2 = makeProfile({ id: 'p2', displayName: 'Alicia', username: 'alicia', discordTag: null });

    mockPrisma.profile.findMany.mockResolvedValue([
      { ...p1, user: { id: 'u1', name: 'Alice' } },
      { ...p2, user: { id: 'u2', name: 'Alicia' } },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/users/search',
      headers: {
        'x-user-id': 'searcher-1',
        'content-type': 'application/json',
      },
      payload: { query: 'ali', limit: 20 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(2);
    const names = body.results.map((r: any) => r.displayName);
    expect(names).toContain('Alice');
    expect(names).toContain('Alicia');
  });
});

// ---------------------------------------------------------------------------
// Auth middleware tests across multiple routes
// ---------------------------------------------------------------------------
describe('Auth middleware enforcement', () => {
  const protectedRoutes = [
    { method: 'GET' as const, url: '/users/me' },
    { method: 'PUT' as const, url: '/users/me' },
    { method: 'GET' as const, url: '/users/me/stats' },
    { method: 'PUT' as const, url: '/profiles/me' },
    { method: 'PATCH' as const, url: '/profiles/me/onboarding' },
    { method: 'POST' as const, url: '/referrals/generate' },
    { method: 'POST' as const, url: '/referrals/apply' },
    { method: 'GET' as const, url: '/referrals/stats' },
    { method: 'POST' as const, url: '/users/search' },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method} ${route.url} returns 401 without X-User-Id header`, async () => {
      const res = await app.inject({ method: route.method, url: route.url });
      expect(res.statusCode).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Privacy — public endpoints accessible without auth
// ---------------------------------------------------------------------------
describe('Public endpoints accessible without auth', () => {
  it('GET /users/:id is public', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({ method: 'GET', url: '/users/user-1' });
    // Should not be 401 — may be 200 or 404 depending on mock
    expect(res.statusCode).not.toBe(401);
  });

  it('GET /users/by-username/:username is public', async () => {
    const profile = makeProfile({ username: 'openuser' });
    mockPrisma.profile.findUnique.mockResolvedValue({ ...profile, user: makeUser() });

    const res = await app.inject({ method: 'GET', url: '/users/by-username/openuser' });
    expect(res.statusCode).not.toBe(401);
  });
});
