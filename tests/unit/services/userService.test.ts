import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma, mockPublisher, makeUser, makeProfile } from '../../setup';

// Service under test — imported AFTER mocks are registered in setup.ts
import * as userService from '../../../src/services/userService';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getUserById
// ---------------------------------------------------------------------------
describe('getUserById', () => {
  it('returns user with profile when found', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await userService.getUserById('user-1');

    expect(result).toEqual(user);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { profile: true },
    });
  });

  it('throws 404 when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(userService.getUserById('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('lazily creates a profile when user exists but profile is null', async () => {
    const user = makeUser({ profile: null, email: 'lazy@example.com', name: 'Lazy User' });
    const createdProfile = makeProfile({ email: 'lazy@example.com', displayName: 'Lazy User' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.create.mockResolvedValue(createdProfile);
    mockPrisma.user.update.mockResolvedValue({ ...user, profileId: createdProfile.id });

    const result = await userService.getUserById('user-1');

    expect(result.profile).toEqual(createdProfile);
    expect(mockPrisma.profile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'lazy@example.com',
        displayName: 'Lazy User',
      }),
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { profileId: createdProfile.id },
    });
  });

  it('uses email prefix as displayName when name is null during lazy creation', async () => {
    const user = makeUser({ profile: null, name: null, email: 'john@example.com' });
    const createdProfile = makeProfile({ email: 'john@example.com', displayName: 'john' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.create.mockResolvedValue(createdProfile);
    mockPrisma.user.update.mockResolvedValue({ ...user, profileId: createdProfile.id });

    await userService.getUserById('user-1');

    expect(mockPrisma.profile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayName: 'john',
      }),
    });
  });
});

// ---------------------------------------------------------------------------
// getUserByEmail
// ---------------------------------------------------------------------------
describe('getUserByEmail', () => {
  it('returns user with profile when found by email', async () => {
    const user = makeUser();
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await userService.getUserByEmail('user@example.com');

    expect(result).toEqual(user);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      include: { profile: true },
    });
  });

  it('throws 404 when email not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(userService.getUserByEmail('nobody@example.com')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------
describe('getProfile', () => {
  it('returns profile for a user', async () => {
    const profile = makeProfile();
    const user = makeUser({ profile });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await userService.getProfile('user-1');

    expect(result).toEqual(profile);
  });

  it('returns null when user has no profile', async () => {
    const user = makeUser({ profile: null });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await userService.getProfile('user-1');

    expect(result).toBeNull();
  });

  it('throws 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(userService.getProfile('ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// updateProfile (user-level fields)
// ---------------------------------------------------------------------------
describe('updateProfile', () => {
  it('updates wallet address and name', async () => {
    const user = makeUser();
    const updated = makeUser({ walletAddress: '0xABC', name: 'New Name' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.user.update.mockResolvedValue(updated);

    const result = await userService.updateProfile('user-1', {
      walletAddress: '0xABC',
      name: 'New Name',
    });

    expect(result.walletAddress).toBe('0xABC');
    expect(result.name).toBe('New Name');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ walletAddress: '0xABC', name: 'New Name' }),
      })
    );
  });

  it('throws 404 when user does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      userService.updateProfile('ghost', { name: 'Ghost' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// updateProfileDetails
// ---------------------------------------------------------------------------
describe('updateProfileDetails', () => {
  it('updates bio and display name successfully', async () => {
    const user = makeUser();
    const updatedProfile = makeProfile({ bio: 'New bio', displayName: 'New Display' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.findUnique.mockResolvedValue(null); // username not taken
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const result = await userService.updateProfileDetails('user-1', {
      bio: 'New bio',
      displayName: 'New Display',
    });

    expect(result.bio).toBe('New bio');
    expect(result.displayName).toBe('New Display');
    expect(mockPublisher.publish).toHaveBeenCalledOnce();
  });

  it('rejects a username that is already taken by another profile', async () => {
    const user = makeUser();
    const existingProfile = makeProfile({ id: 'profile-999', username: 'taken' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    // Username clash — findUnique returns an existing profile
    mockPrisma.profile.findUnique.mockResolvedValue(existingProfile);

    await expect(
      userService.updateProfileDetails('user-1', { username: 'taken' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('allows keeping the same username (no conflict check result needed)', async () => {
    const sameUsername = 'testuser';
    const user = makeUser({ profile: makeProfile({ username: sameUsername }) });
    const updatedProfile = makeProfile({ username: sameUsername, bio: 'Updated' });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    // profile.findUnique should NOT be called because username did not change
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const result = await userService.updateProfileDetails('user-1', {
      username: sameUsername,
      bio: 'Updated',
    });

    expect(result.username).toBe(sameUsername);
    expect(mockPrisma.profile.findUnique).not.toHaveBeenCalled();
  });

  it('throws 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      userService.updateProfileDetails('ghost', { bio: 'hi' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when user has no linked profile', async () => {
    const user = makeUser({ profile: null });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    await expect(
      userService.updateProfileDetails('user-1', { bio: 'hi' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates social links successfully', async () => {
    const user = makeUser();
    const socialLinks = { twitter: 'https://twitter.com/user', github: 'https://github.com/user' };
    const updatedProfile = makeProfile({ socialLinks });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const result = await userService.updateProfileDetails('user-1', { socialLinks });

    expect(result.socialLinks).toEqual(socialLinks);
  });

  it('sets isPublic to false when requested', async () => {
    const user = makeUser();
    const updatedProfile = makeProfile({ isPublic: false });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.profile.update.mockResolvedValue(updatedProfile);

    const result = await userService.updateProfileDetails('user-1', { isPublic: false });

    expect(result.isPublic).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// completeOnboarding
// ---------------------------------------------------------------------------
describe('completeOnboarding', () => {
  it('marks onboarding as complete', async () => {
    const user = makeUser({ onboardingCompleted: false });
    const updated = makeUser({ onboardingCompleted: true });

    mockPrisma.user.findUnique.mockResolvedValue(user);
    mockPrisma.user.update.mockResolvedValue(updated);

    const result = await userService.completeOnboarding('user-1');

    expect(result.onboardingCompleted).toBe(true);
  });

  it('throws 409 when onboarding already completed', async () => {
    const user = makeUser({ onboardingCompleted: true });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    await expect(userService.completeOnboarding('user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });

  it('throws 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(userService.completeOnboarding('ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// getUserStats
// ---------------------------------------------------------------------------
describe('getUserStats', () => {
  it('returns stats including profileComplete flag when all fields set', async () => {
    const user = makeUser({
      profile: makeProfile({ displayName: 'Test', bio: 'Bio', avatarUrl: 'https://cdn.example.com/img.jpg' }),
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await userService.getUserStats('user-1');

    expect(stats.userId).toBe('user-1');
    expect(stats.profileComplete).toBe(true);
    expect(stats.campaignLimit).toBe(10);
    expect(stats.referralCount).toBe(0);
    expect(stats.isReferralQualified).toBe(false);
  });

  it('returns profileComplete false when bio is missing', async () => {
    const user = makeUser({
      profile: makeProfile({ bio: null }),
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await userService.getUserStats('user-1');

    expect(stats.profileComplete).toBe(false);
  });

  it('returns profileComplete false when user has no profile', async () => {
    const user = makeUser({ profile: null });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await userService.getUserStats('user-1');

    expect(stats.profileComplete).toBe(false);
  });

  it('uses firstLoginAt as memberSince when available', async () => {
    const loginAt = new Date('2024-06-01T00:00:00Z');
    const user = makeUser({ firstLoginAt: loginAt });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await userService.getUserStats('user-1');

    expect(stats.memberSince).toEqual(loginAt);
  });

  it('falls back to profile.createdAt for memberSince when firstLoginAt is null', async () => {
    const profileCreatedAt = new Date('2024-01-01T00:00:00Z');
    const user = makeUser({
      firstLoginAt: null,
      profile: makeProfile({ createdAt: profileCreatedAt }),
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await userService.getUserStats('user-1');

    expect(stats.memberSince).toEqual(profileCreatedAt);
  });

  it('throws 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(userService.getUserStats('ghost')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// getUserByUsername
// ---------------------------------------------------------------------------
describe('getUserByUsername', () => {
  it('returns full public profile for a public user', async () => {
    const profile = makeProfile({
      isPublic: true,
      username: 'testuser',
      bio: 'Hello',
      location: 'NYC',
    });
    const user = makeUser({ profile });
    // getUserByUsername queries Profile, include user
    mockPrisma.profile.findUnique.mockResolvedValue({ ...profile, user });

    const result = await userService.getUserByUsername('testuser');

    expect(result.username).toBe('testuser');
    expect(result.bio).toBe('Hello');
    expect(result.location).toBe('NYC');
    expect(result.isPublic).toBe(true);
  });

  it('returns limited data for a private user', async () => {
    const profile = makeProfile({
      isPublic: false,
      username: 'privateuser',
      bio: 'Secret bio',
    });
    const user = makeUser({ profile });
    mockPrisma.profile.findUnique.mockResolvedValue({ ...profile, user });

    const result = await userService.getUserByUsername('privateuser');

    expect(result.isPublic).toBe(false);
    expect((result as any).bio).toBeUndefined();
    expect((result as any).location).toBeUndefined();
  });

  it('throws 404 when username not found', async () => {
    mockPrisma.profile.findUnique.mockResolvedValue(null);

    await expect(userService.getUserByUsername('nobody')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });
});
