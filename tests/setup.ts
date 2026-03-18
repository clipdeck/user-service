import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.test before any module is imported that reads process.env
// (config.ts runs at module load time via top-level safeParse)
const envPath = resolve(__dirname, '../.env.test');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.test not found — rely on existing env
}

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted() — values created here are available inside vi.mock() factories
// because vi.mock is hoisted to the top of the file by vitest's transform.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    profile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  };

  const publisher = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return { prisma, publisher };
});

// ---------------------------------------------------------------------------
// Module mocks — must be called at top level, they are hoisted by vitest.
// ---------------------------------------------------------------------------
vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }));

vi.mock('../src/lib/events', () => ({
  publisher: mocks.publisher,
  UserEvents: {
    profileUpdated: vi.fn().mockReturnValue({ type: 'user.profile_updated', payload: {} }),
  },
  SERVICE_NAME: 'user-service',
}));

vi.mock('../src/events/handlers', () => ({
  setupEventHandlers: vi.fn().mockResolvedValue(undefined),
  stopEventHandlers: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Exported mock references for use in test files
// ---------------------------------------------------------------------------
export const mockPrisma = mocks.prisma;
export const mockPublisher = mocks.publisher;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
export type MockProfile = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  discordId: string | null;
  discordTag: string | null;
  guildRoles: string[];
  invitedById: string | null;
  invitesCount: number;
  bio: string | null;
  isPublic: boolean;
  location: string | null;
  showEarnings: boolean;
  socialLinks: Record<string, string> | null;
  username: string | null;
  website: string | null;
};

export type MockUser = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
  profileId: string | null;
  onboardingCompleted: boolean;
  phoneNumber: string | null;
  walletAddress: string | null;
  campaignLimit: number;
  firstLoginIp: string | null;
  firstLoginAt: Date | null;
  referralCode: string | null;
  referralCount: number;
  isReferralQualified: boolean;
  referredById: string | null;
  profile?: MockProfile | null;
  referrals?: MockUser[];
};

export function makeProfile(overrides: Partial<MockProfile> = {}): MockProfile {
  return {
    id: 'profile-1',
    email: 'user@example.com',
    displayName: 'Test User',
    avatarUrl: 'https://example.com/avatar.jpg',
    role: 'CREATOR',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    discordId: null,
    discordTag: null,
    guildRoles: [],
    invitedById: null,
    invitesCount: 0,
    bio: 'Hello world',
    isPublic: true,
    location: 'New York',
    showEarnings: false,
    socialLinks: null,
    username: 'testuser',
    website: 'https://example.com',
    ...overrides,
  };
}

export function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  const profile = overrides.profile !== undefined ? overrides.profile : makeProfile();
  const { profile: _ignored, ...rest } = overrides;
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'user@example.com',
    emailVerified: null,
    image: null,
    profileId: 'profile-1',
    onboardingCompleted: false,
    phoneNumber: null,
    walletAddress: null,
    campaignLimit: 10,
    firstLoginIp: null,
    firstLoginAt: null,
    referralCode: null,
    referralCount: 0,
    isReferralQualified: false,
    referredById: null,
    profile,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// App builder — returns a Fastify instance wired up the same way as index.ts
// but without starting a real server or connecting to external services.
// ---------------------------------------------------------------------------
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { userRoutes } from '../src/routes/users';
import { profileRoutes } from '../src/routes/profiles';
import { searchRoutes } from '../src/routes/search';
import { referralRoutes } from '../src/routes/referrals';

export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: '*', credentials: true });
  await app.register(helmet);

  app.get('/health', async () => ({ status: 'ok', service: 'user-service' }));
  app.get('/ready', async () => ({ status: 'ready', service: 'user-service' }));

  await app.register(userRoutes, { prefix: '/users' });
  await app.register(profileRoutes, { prefix: '/profiles' });
  await app.register(searchRoutes, { prefix: '/users/search' });
  await app.register(referralRoutes, { prefix: '/referrals' });

  await app.ready();
  return app;
}
