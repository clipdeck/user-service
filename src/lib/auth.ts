import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { passkey } from '@better-auth/passkey';
import { prisma } from './prisma';
import { config } from '../config';

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
  advanced: {
    cookiePrefix: 'clipdeck',
    generateId: 'uuid',
  },
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;
