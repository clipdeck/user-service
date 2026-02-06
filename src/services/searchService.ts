import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Search users by name, email, discordTag, or displayName (case insensitive)
 * Returns userId, discordId, displayName, avatarUrl, discordTag
 */
export async function searchUsers(query: string, limit: number = 10) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const searchTerm = query.trim();

  const profiles = await prisma.profile.findMany({
    where: {
      OR: [
        { displayName: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { discordTag: { contains: searchTerm, mode: 'insensitive' } },
        { username: { contains: searchTerm, mode: 'insensitive' } },
      ],
    },
    include: {
      user: {
        select: { id: true, name: true },
      },
    },
    take: limit,
  });

  // Also search by user name for users who may not have matching profile fields
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
      ],
      // Exclude users already found via profile
      id: { notIn: profiles.map((p) => p.user?.id).filter(Boolean) as string[] },
    },
    include: {
      profile: {
        select: { displayName: true, avatarUrl: true, discordId: true, discordTag: true },
      },
    },
    take: limit,
  });

  const profileResults = profiles.map((p) => ({
    userId: p.user?.id ?? null,
    discordId: p.discordId,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    discordTag: p.discordTag,
  }));

  const userResults = users.map((u) => ({
    userId: u.id,
    discordId: u.profile?.discordId ?? null,
    displayName: u.profile?.displayName ?? u.name,
    avatarUrl: u.profile?.avatarUrl ?? null,
    discordTag: u.profile?.discordTag ?? null,
  }));

  const combined = [...profileResults, ...userResults].slice(0, limit);

  logger.debug({ query: searchTerm, resultCount: combined.length }, 'User search completed');
  return combined;
}
