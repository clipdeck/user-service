import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma, makeUser } from '../../setup';

import * as referralService from '../../../src/services/referralService';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// generateReferralCode
// ---------------------------------------------------------------------------
describe('generateReferralCode', () => {
  it('returns existing referral code without regenerating', async () => {
    const user = makeUser({ referralCode: 'ABCD1234' });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await referralService.generateReferralCode('user-1');

    expect(result.referralCode).toBe('ABCD1234');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('generates and saves a new code when user has none', async () => {
    const user = makeUser({ referralCode: null });
    const updatedUser = makeUser({ referralCode: 'NEWCODE1' });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)        // fetch user
      .mockResolvedValue(null);           // no collision on generated code

    mockPrisma.user.update.mockResolvedValue(updatedUser);

    const result = await referralService.generateReferralCode('user-1');

    expect(result.referralCode).toBeTruthy();
    expect(mockPrisma.user.update).toHaveBeenCalledOnce();
  });

  it('retries on collision and eventually generates a code', async () => {
    const user = makeUser({ referralCode: null });
    const collidingUser = makeUser({ id: 'other', referralCode: 'COLLIDE' });
    const updatedUser = makeUser({ referralCode: 'UNIQUE12' });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)          // initial fetch
      .mockResolvedValueOnce(collidingUser) // first attempt: collision
      .mockResolvedValueOnce(null);         // second attempt: free

    mockPrisma.user.update.mockResolvedValue(updatedUser);

    const result = await referralService.generateReferralCode('user-1');

    expect(result.referralCode).toBeTruthy();
  });

  it('throws 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(referralService.generateReferralCode('ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// processReferral
// ---------------------------------------------------------------------------
describe('processReferral', () => {
  it('successfully links referral and increments referrer count', async () => {
    const user = makeUser({ id: 'user-new', referredById: null });
    const referrer = makeUser({ id: 'user-referrer', referralCode: 'REF123', referralCount: 3 });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)     // fetch self
      .mockResolvedValueOnce(referrer); // fetch referrer by code

    mockPrisma.$transaction.mockResolvedValue([user, referrer]);

    const result = await referralService.processReferral('user-new', 'REF123');

    expect(result.success).toBe(true);
    expect(result.referrerId).toBe('user-referrer');
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });

  it('marks referrer as qualified after 5 referrals (reaching 5)', async () => {
    const user = makeUser({ id: 'user-new', referredById: null });
    const referrer = makeUser({ id: 'user-referrer', referralCode: 'REF123', referralCount: 4 });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(referrer);

    // Capture the transaction call to inspect the isReferralQualified value
    mockPrisma.$transaction.mockImplementation(async (ops: any[]) => {
      for (const op of ops) await op;
      return [];
    });

    // We need update to be trackable inside the transaction
    mockPrisma.user.update.mockResolvedValue({});

    await referralService.processReferral('user-new', 'REF123');

    // The second update should set isReferralQualified: true (4+1 >= 5)
    const updateCalls = mockPrisma.user.update.mock.calls;
    const referrerUpdate = updateCalls.find(
      (c: any[]) => c[0]?.data?.isReferralQualified !== undefined
    );
    expect(referrerUpdate?.[0]?.data?.isReferralQualified).toBe(true);
  });

  it('throws 409 when user was already referred', async () => {
    const user = makeUser({ referredById: 'someone-else' });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    await expect(
      referralService.processReferral('user-1', 'CODE')
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('throws 400 for an invalid referral code', async () => {
    const user = makeUser({ referredById: null });
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(null); // referrer not found

    await expect(
      referralService.processReferral('user-1', 'BADCODE')
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('throws 400 when user tries to use their own referral code', async () => {
    const user = makeUser({ id: 'user-1', referredById: null });
    const selfReferrer = makeUser({ id: 'user-1', referralCode: 'MYCODE' }); // same id

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(selfReferrer);

    await expect(
      referralService.processReferral('user-1', 'MYCODE')
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
  });

  it('throws 404 when applying user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      referralService.processReferral('ghost', 'CODE')
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// getReferralStats
// ---------------------------------------------------------------------------
describe('getReferralStats', () => {
  it('returns referral stats with recent referrals', async () => {
    const referred1 = makeUser({ id: 'ref-1', name: 'Alice', firstLoginAt: new Date() });
    const referred2 = makeUser({ id: 'ref-2', name: 'Bob', firstLoginAt: new Date() });
    const user = makeUser({
      referralCode: 'MYCODE',
      referralCount: 2,
      isReferralQualified: false,
      referrals: [referred1, referred2] as any,
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await referralService.getReferralStats('user-1');

    expect(stats.referralCode).toBe('MYCODE');
    expect(stats.referralCount).toBe(2);
    expect(stats.isReferralQualified).toBe(false);
    expect(stats.recentReferrals).toHaveLength(2);
    expect(stats.recentReferrals[0].name).toBe('Alice');
  });

  it('returns empty recent referrals when none exist', async () => {
    const user = makeUser({ referrals: [] as any });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await referralService.getReferralStats('user-1');

    expect(stats.recentReferrals).toHaveLength(0);
  });

  it('returns null referralCode when not yet generated', async () => {
    const user = makeUser({ referralCode: null, referrals: [] as any });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const stats = await referralService.getReferralStats('user-1');

    expect(stats.referralCode).toBeNull();
  });

  it('throws 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(referralService.getReferralStats('ghost')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
