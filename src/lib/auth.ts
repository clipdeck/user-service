import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { passkey } from '@better-auth/passkey';
import { prisma } from './prisma';
import { config } from '../config';
import { logger } from './logger';

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: config.jwtSecret,
  baseURL: config.betterAuthUrl,
  basePath: '/auth',
  trustedOrigins: [
    'https://clipdeck.ar',
    'https://api.clipdeck.ar',
    ...config.allowedOrigins,
  ],
  session: {
    modelName: 'userSession',
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh if older than 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  account: {
    modelName: 'userAccount',
  },
  verification: {
    modelName: 'userVerification',
  },
  socialProviders: {
    discord: {
      clientId: config.discordClientId ?? '',
      clientSecret: config.discordClientSecret ?? '',
      enabled: !!(config.discordClientId && config.discordClientSecret),
    },
    google: {
      clientId: config.googleClientId ?? '',
      clientSecret: config.googleClientSecret ?? '',
      enabled: !!(config.googleClientId && config.googleClientSecret),
    },
    twitter: {
      clientId: config.twitterClientId ?? '',
      clientSecret: config.twitterClientSecret ?? '',
      enabled: !!(config.twitterClientId && config.twitterClientSecret),
    },
  },
  plugins: [
    passkey(),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'CLIPPER',
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            // Derive a displayName from the user's name or email prefix
            const displayName = user.name
              ?? (user.email ? user.email.split('@')[0] : undefined)
              ?? undefined;

            const profile = await prisma.profile.create({
              data: {
                email: user.email ?? `${user.id}@unknown`,
                displayName,
                avatarUrl: (user as Record<string, unknown>).image as string | undefined,
                createdAt: new Date(),
              },
            });

            await prisma.user.update({
              where: { id: user.id },
              data: { profileId: profile.id },
            });

            logger.info({ userId: user.id, profileId: profile.id }, 'Auto-created profile for new user');
          } catch (err) {
            logger.error({ err, userId: user.id }, 'Failed to auto-create profile for new user');
          }
        },
      },
    },
  },
  advanced: {
    cookiePrefix: 'clipdeck',
    generateId: 'uuid',
    crossSubDomainCookies: {
      enabled: true,
      domain: '.clipdeck.ar',
    },
    ipAddress: {
      // api-gateway always forwards the real IP in X-Forwarded-For
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
  },
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;
