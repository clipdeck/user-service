import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, mockPrisma, makeUser } from '../../setup';

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
// POST /referrals/generate
// ---------------------------------------------------------------------------
describe('POST /referrals/generate', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/referrals/generate' });
    expect(res.statusCode).toBe(401);
  });

  it('returns existing referral code when already generated', async () => {
    const user = makeUser({ referralCode: 'EXIST123' });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/generate',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().referralCode).toBe('EXIST123');
  });

  it('generates a new referral code when user has none', async () => {
    const user = makeUser({ referralCode: null });
    const updated = makeUser({ referralCode: 'NEWCODE1' });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)    // fetch user
      .mockResolvedValue(null);       // no code collision

    mockPrisma.user.update.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/generate',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().referralCode).toBeTruthy();
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/generate',
      headers: { 'x-user-id': 'ghost' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /referrals/apply
// ---------------------------------------------------------------------------
describe('POST /referrals/apply', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      payload: { referralCode: 'CODE123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when referralCode is missing from body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('applies a valid referral code successfully', async () => {
    const user = makeUser({ id: 'user-new', referredById: null });
    const referrer = makeUser({ id: 'user-ref', referralCode: 'VALID123', referralCount: 1 });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(referrer);

    mockPrisma.$transaction.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      headers: {
        'x-user-id': 'user-new',
        'content-type': 'application/json',
      },
      payload: { referralCode: 'VALID123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().referrerId).toBe('user-ref');
  });

  it('returns 409 when user has already been referred', async () => {
    const user = makeUser({ referredById: 'already-referred-by' });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { referralCode: 'SOMECODE' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 400 for an invalid referral code', async () => {
    const user = makeUser({ referredById: null });
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(null); // no referrer found

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { referralCode: 'INVALID' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when user tries to use their own referral code', async () => {
    const user = makeUser({ id: 'user-1', referredById: null });
    const selfRef = makeUser({ id: 'user-1', referralCode: 'MYCODE' });

    mockPrisma.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce(selfRef);

    const res = await app.inject({
      method: 'POST',
      url: '/referrals/apply',
      headers: {
        'x-user-id': 'user-1',
        'content-type': 'application/json',
      },
      payload: { referralCode: 'MYCODE' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /referrals/stats
// ---------------------------------------------------------------------------
describe('GET /referrals/stats', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/referrals/stats' });
    expect(res.statusCode).toBe(401);
  });

  it('returns referral stats for authenticated user', async () => {
    const user = makeUser({
      referralCode: 'MYCODE123',
      referralCount: 3,
      isReferralQualified: false,
      referrals: [] as any,
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'GET',
      url: '/referrals/stats',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.referralCode).toBe('MYCODE123');
    expect(body.referralCount).toBe(3);
    expect(body.isReferralQualified).toBe(false);
    expect(body.recentReferrals).toEqual([]);
  });

  it('returns recentReferrals list when referrals exist', async () => {
    const referred = makeUser({ id: 'ref-1', name: 'Alice' });
    const user = makeUser({
      referralCode: 'CODE',
      referralCount: 1,
      referrals: [{ id: 'ref-1', name: 'Alice', firstLoginAt: null }] as any,
    });
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const res = await app.inject({
      method: 'GET',
      url: '/referrals/stats',
      headers: { 'x-user-id': 'user-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().recentReferrals[0].name).toBe('Alice');
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/referrals/stats',
      headers: { 'x-user-id': 'ghost' },
    });

    expect(res.statusCode).toBe(404);
  });
});
