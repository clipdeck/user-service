import { prisma } from '../lib/prisma';
import { publisher, UserEvents, SERVICE_NAME } from '../lib/events';
import { notFound, badRequest, conflict } from '../lib/errors';
import { logger } from '../lib/logger';
import type { AuthUser } from '../middleware/auth';

/**
 * Get user by ID with profile.
 * Lazily creates a default Profile record when one is missing (covers
 * users who signed up before the databaseHooks auto-creation was added).
 */
export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { profile: true },
  });

  if (!user) throw notFound(`User ${id} not found`);

  if (!user.profile) {
    const profile = await ensureProfile(user);
    return { ...user, profile };
  }

  return user;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { profile: true },
  });

  if (!user) throw notFound(`User with email ${email} not found`);
  return user;
}

/**
 * Get user's profile data
 */
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!user) throw notFound(`User ${userId} not found`);
  return user.profile;
}

/**
 * Update user profile (top-level user fields)
 */
export async function updateProfile(
  userId: string,
  data: {
    walletAddress?: string;
    name?: string;
    phoneNumber?: string;
  }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound(`User ${userId} not found`);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      walletAddress: data.walletAddress,
      name: data.name,
      phoneNumber: data.phoneNumber,
    },
    include: { profile: true },
  });

  logger.info({ userId }, 'User profile updated');
  return updated;
}

/**
 * Update profile model details (displayName, bio, avatar, etc.)
 */
export async function updateProfileDetails(
  userId: string,
  data: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    isPublic?: boolean;
    location?: string;
    showEarnings?: boolean;
    socialLinks?: Record<string, string>;
    website?: string;
    username?: string;
  }
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!user) throw notFound(`User ${userId} not found`);
  if (!user.profile) throw notFound(`Profile for user ${userId} not found`);

  // Check username uniqueness if changing
  if (data.username && data.username !== user.profile.username) {
    const existing = await prisma.profile.findUnique({
      where: { username: data.username },
    });
    if (existing) {
      throw conflict(`Username "${data.username}" is already taken`);
    }
  }

  const updatedProfile = await prisma.profile.update({
    where: { id: user.profile.id },
    data: {
      displayName: data.displayName,
      bio: data.bio,
      avatarUrl: data.avatarUrl,
      isPublic: data.isPublic,
      location: data.location,
      showEarnings: data.showEarnings,
      socialLinks: data.socialLinks !== undefined ? data.socialLinks : undefined,
      website: data.website,
      username: data.username,
    },
  });

  // Publish profile updated event
  const event = UserEvents.profileUpdated(
    {
      userId,
      displayName: updatedProfile.displayName ?? undefined,
      avatarUrl: updatedProfile.avatarUrl ?? undefined,
      username: updatedProfile.username ?? undefined,
    },
    SERVICE_NAME
  );
  await publisher.publish(event);

  logger.info({ userId, profileId: updatedProfile.id }, 'Profile details updated');
  return updatedProfile;
}

/**
 * Complete onboarding for a user
 */
export async function completeOnboarding(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound(`User ${userId} not found`);

  if (user.onboardingCompleted) {
    throw conflict('Onboarding already completed');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompleted: true },
    include: { profile: true },
  });

  logger.info({ userId }, 'Onboarding completed');
  return updated;
}

/**
 * Get basic user stats
 * Note: Real stats (campaign count, clip count, earnings) come from other
 * services via API calls or event-driven denormalization. This provides
 * placeholder data and user-local stats only.
 */
export async function getUserStats(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!user) throw notFound(`User ${userId} not found`);

  return {
    userId: user.id,
    onboardingCompleted: user.onboardingCompleted,
    campaignLimit: user.campaignLimit,
    referralCount: user.referralCount,
    isReferralQualified: user.isReferralQualified,
    profileComplete: !!(
      user.profile?.displayName &&
      user.profile?.bio &&
      user.profile?.avatarUrl
    ),
    memberSince: user.firstLoginAt ?? user.profile?.createdAt,
  };
}

/**
 * Get user by username (public profile)
 */
export async function getUserByUsername(username: string) {
  const profile = await prisma.profile.findUnique({
    where: { username },
    include: { user: true },
  });

  if (!profile) throw notFound(`User with username "${username}" not found`);

  // Return only public-safe data
  if (!profile.isPublic) {
    return {
      id: profile.user?.id,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      username: profile.username,
      isPublic: false,
    };
  }

  return {
    id: profile.user?.id,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    username: profile.username,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    socialLinks: profile.socialLinks,
    role: profile.role,
    memberSince: profile.createdAt,
    isPublic: true,
  };
}

// ---------------------------------------------------------------------------
// Lazy profile creation for users missing a Profile record
// ---------------------------------------------------------------------------

/**
 * Creates a default Profile for an existing user who doesn't have one.
 * This handles users created before the Better Auth databaseHooks were added,
 * as well as any edge cases where the hook failed silently.
 */
async function ensureProfile(user: { id: string; name: string | null; email: string | null; image?: string | null }) {
  const displayName = user.name
    ?? (user.email ? user.email.split('@')[0] : undefined)
    ?? undefined;

  const profile = await prisma.profile.create({
    data: {
      email: user.email ?? `${user.id}@unknown`,
      displayName,
      avatarUrl: user.image ?? undefined,
      createdAt: new Date(),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { profileId: profile.id },
  });

  logger.info({ userId: user.id, profileId: profile.id }, 'Lazily created missing profile for existing user');
  return profile;
}
