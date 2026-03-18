import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, mockPrisma, mockPublisher, makeUser, makeProfile } from '../../setup';

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
// PUT /profiles/me
// ---------------------------------------------------------------------------
describe('PUT /profiles/me', () => {
  it('returns 401 when X-User-Id header is missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      payload: { displayName: 'New Name' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('updates display name and bio successfully', async () => {
    const user = makeUser();
    const updatedProfile = makeProfile({ displayName: 'Updated', bio: 'New bio' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.findUnique.mockResolvedValue(null); // no username conflict
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { displayName: 'Updated', bio: 'New bio' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayName).toBe('Updated');
    expect(body.bio).toBe('New bio');
  });

  it('returns 409 when new username is already taken', async () => {
    const user = makeUser();
    const conflictingProfile = makeProfile({ id: 'other-profile', username: 'taken' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    // Simulate the conflict — findUnique returns an existing profile with the target username
    mockPrisma.profile.findUnique.mockResolvedValue(conflictingProfile);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { username: 'taken' },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('sets profile to private successfully', async () => {
    const user = makeUser();
    const updatedProfile = makeProfile({ isPublic: false });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { isPublic: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().isPublic).toBe(false);
  });

  it('publishes a profile_updated event on success', async () => {
    const user = makeUser();
    const updatedProfile = makeProfile({ displayName: 'EventUser' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { displayName: 'EventUser' },
    });

    expect(mockPublisher.publish).toHaveBeenCalledOnce();
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'ghost',
        'content-type': 'application/json',
      },
      payload: { displayName: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when user exists but has no profile linked', async () => {
    const user = makeUser({ profile: null });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { bio: 'will fail' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('updates social links in the profile', async () => {
    const user = makeUser();
    const socialLinks = { twitter: 'https://twitter.com/test' };
    const updatedProfile = makeProfile({ socialLinks });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const res = await app.inject({
      method: 'PUT',
      url: '/profiles/me',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { socialLinks },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().socialLinks).toEqual(socialLinks);
  });
});

// ---------------------------------------------------------------------------
// PATCH /profiles/me/onboarding
// ---------------------------------------------------------------------------
describe('PATCH /profiles/me/onboarding', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/profiles/me/onboarding' });
    expect(res.statusCode).toBe(401);
  });

  it('completes onboarding successfully', async () => {
    const user = makeUser({ onboardingCompleted: false });
    const updated = makeUser({ onboardingCompleted: true });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PATCH',
      url: '/profiles/me/onboarding',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().onboardingCompleted).toBe(true);
  });

  it('returns 409 when onboarding already completed', async () => {
    const user = makeUser({ onboardingCompleted: true });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'PATCH',
      url: '/profiles/me/onboarding',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/profiles/me/onboarding',
      headers: { 'x-user-id': 'ghost' },
    });

    expect(res.statusCode).toBe(404);
  });
});
