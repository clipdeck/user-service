import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { notFound, badRequest, conflict } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Generate a unique referral code for a user
 */
export async function generateReferralCode(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound(`User ${userId} not found`);

  if (user.referralCode) {
    return { referralCode: user.referralCode };
  }

  // Generate a unique code, retry if collision
  let code: string;
  let attempts = 0;
  const maxAttempts = 5;

  do {
    code = randomBytes(4).toString('hex').toUpperCase();
    const existing = await prisma.user.findUnique({
      where: { referralCode: code },
    });
    if (!existing) break;
    attempts++;
  } while (attempts < maxAttempts);

  if (attempts >= maxAttempts) {
    // Fallback: use longer code
    code = randomBytes(6).toString('hex').toUpperCase();
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { referralCode: code },
  });

  logger.info({ userId, referralCode: code }, 'Referral code generated');
  return { referralCode: updated.referralCode };
}

/**
 * Process a referral: link the referred user to the referrer
 */
export async function processReferral(userId: string, referralCode: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound(`User ${userId} not found`);

  if (user.referredById) {
    throw conflict('User has already been referred');
  }

  const referrer = await prisma.user.findUnique({
    where: { referralCode },
  });

  if (!referrer) {
    throw badRequest('Invalid referral code');
  }

  if (referrer.id === userId) {
    throw badRequest('Cannot use your own referral code');
  }

  // Link referral and increment referrer's count
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { referredById: referrer.id },
    }),
    prisma.user.update({
      where: { id: referrer.id },
      data: {
        referralCount: { increment: 1 },
        // Mark as qualified after 5 referrals
        isReferralQualified: referrer.referralCount + 1 >= 5,
      },
    }),
  ]);

  logger.info({ userId, referrerId: referrer.id, referralCode }, 'Referral processed');
  return { success: true, referrerId: referrer.id };
}

/**
 * Get referral stats for a user
 */
export async function getReferralStats(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      referrals: {
        select: { id: true, name: true, firstLoginAt: true },
        orderBy: { firstLoginAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!user) throw notFound(`User ${userId} not found`);

  return {
    referralCode: user.referralCode,
    referralCount: user.referralCount,
    isReferralQualified: user.isReferralQualified,
    recentReferrals: user.referrals.map((r) => ({
      id: r.id,
      name: r.name,
    })),
  };
}
