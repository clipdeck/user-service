import type { FastifyInstance } from 'fastify';
import { createHmac, randomBytes, createHash } from 'node:crypto';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { encrypt, decrypt } from '../lib/encryption';
import { badRequest, notFound } from '../lib/errors';
import { logger } from '../lib/logger';

const VALID_PLATFORMS = ['TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'TWITTER'] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

const CALLBACK_BASE = 'https://api.clipdeck.ar/api/linked-accounts/callback';
const FRONTEND_SETTINGS = 'https://clipdeck.ar/dashboard/settings/profile';

// ---------------------------------------------------------------------------
// State JWT helpers (HMAC-based, not full JWT lib — zero dependencies)
// ---------------------------------------------------------------------------

interface StatePayload {
  userId: string;
  platform: string;
  codeVerifier?: string;
  exp: number;
}

function signState(payload: StatePayload): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString('base64url');
  const sig = createHmac('sha256', config.jwtSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyState(state: string): StatePayload | null {
  const [encoded, sig] = state.split('.');
  if (!encoded || !sig) return null;
  const expected = createHmac('sha256', config.jwtSecret).update(encoded).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as StatePayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PKCE helpers (Twitter requires S256)
// ---------------------------------------------------------------------------

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// Platform-specific helpers
// ---------------------------------------------------------------------------

function buildAuthUrl(platform: Platform, state: string, codeChallenge?: string): string {
  const redirectUri = `${CALLBACK_BASE}/${platform.toLowerCase()}`;

  switch (platform) {
    case 'TIKTOK':
      return `https://www.tiktok.com/v2/auth/authorize?${new URLSearchParams({
        client_key: config.tiktokClientKey ?? '',
        scope: 'user.info.basic,video.list',
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
      })}`;

    case 'INSTAGRAM':
      return `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
        client_id: config.instagramAppId ?? '',
        scope: 'instagram_basic,instagram_manage_insights',
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
      })}`;

    case 'YOUTUBE':
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: config.googleClientId ?? '',
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
        access_type: 'offline',
        prompt: 'consent',
      })}`;

    case 'TWITTER':
      return `https://twitter.com/i/oauth2/authorize?${new URLSearchParams({
        client_id: config.twitterClientId ?? '',
        scope: 'tweet.read users.read offline.access',
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge ?? '',
        code_challenge_method: 'S256',
      })}`;
  }
}

async function exchangeCodeForTokens(
  platform: Platform,
  code: string,
  codeVerifier?: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
  const redirectUri = `${CALLBACK_BASE}/${platform.toLowerCase()}`;

  switch (platform) {
    case 'TIKTOK': {
      const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: config.tiktokClientKey ?? '',
          client_secret: config.tiktokClientSecret ?? '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(`TikTok token exchange failed: ${JSON.stringify(data)}`);
      return {
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string | undefined,
        expiresIn: data.expires_in as number | undefined,
      };
    }

    case 'INSTAGRAM': {
      // Step 1: exchange code for short-lived token
      const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.instagramAppId ?? '',
          client_secret: config.instagramAppSecret ?? '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const shortData = await shortRes.json() as Record<string, unknown>;
      if (!shortRes.ok) throw new Error(`Instagram short-lived token failed: ${JSON.stringify(shortData)}`);
      const shortToken = shortData.access_token as string;

      // Step 2: exchange short-lived for long-lived token
      const longUrl = `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: config.instagramAppSecret ?? '',
        access_token: shortToken,
      })}`;
      const longRes = await fetch(longUrl);
      const longData = await longRes.json() as Record<string, unknown>;
      if (!longRes.ok) throw new Error(`Instagram long-lived token failed: ${JSON.stringify(longData)}`);

      return {
        accessToken: longData.access_token as string,
        expiresIn: longData.expires_in as number | undefined,
      };
    }

    case 'YOUTUBE': {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.googleClientId ?? '',
          client_secret: config.googleClientSecret ?? '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(`YouTube token exchange failed: ${JSON.stringify(data)}`);
      return {
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string | undefined,
        expiresIn: data.expires_in as number | undefined,
      };
    }

    case 'TWITTER': {
      const res = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.twitterClientId ?? '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code_verifier: codeVerifier ?? '',
        }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(`Twitter token exchange failed: ${JSON.stringify(data)}`);
      return {
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string | undefined,
        expiresIn: data.expires_in as number | undefined,
      };
    }
  }
}

interface PlatformProfile {
  platformId: string;
  username?: string;
  displayName?: string;
}

async function fetchPlatformProfile(
  platform: Platform,
  accessToken: string,
): Promise<PlatformProfile> {
  switch (platform) {
    case 'TIKTOK': {
      const res = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json() as { data?: { user?: Record<string, string> } };
      const user = data.data?.user;
      if (!user?.open_id) throw new Error('Failed to fetch TikTok profile');
      return { platformId: user.open_id, username: user.username, displayName: user.display_name };
    }

    case 'INSTAGRAM': {
      const url = `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${accessToken}`;
      const res = await fetch(url);
      const data = await res.json() as Record<string, string>;
      if (!data.id) throw new Error('Failed to fetch Instagram profile');
      // Reject non-business/creator accounts
      const accountType = data.account_type;
      if (accountType && accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR') {
        throw new Error(`Instagram account type "${accountType}" is not supported. Only BUSINESS or MEDIA_CREATOR accounts can be linked.`);
      }
      return { platformId: data.id, username: data.username };
    }

    case 'YOUTUBE': {
      const res = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json() as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }> };
      const channel = data.items?.[0];
      if (!channel) throw new Error('Failed to fetch YouTube channel');
      return {
        platformId: channel.id,
        username: channel.snippet?.customUrl,
        displayName: channel.snippet?.title,
      };
    }

    case 'TWITTER': {
      const res = await fetch('https://api.x.com/2/users/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json() as { data?: { id: string; username?: string; name?: string } };
      const user = data.data;
      if (!user?.id) throw new Error('Failed to fetch Twitter profile');
      return { platformId: user.id, username: user.username, displayName: user.name };
    }
  }
}

async function refreshPlatformToken(
  platform: Platform,
  account: { encryptedAccessToken: string | null; encryptedRefreshToken: string | null },
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number } | null> {
  try {
    switch (platform) {
      case 'TIKTOK': {
        if (!account.encryptedRefreshToken) return null;
        const refreshToken = decrypt(account.encryptedRefreshToken);
        const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: config.tiktokClientKey ?? '',
            client_secret: config.tiktokClientSecret ?? '',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return null;
        return {
          accessToken: data.access_token as string,
          refreshToken: data.refresh_token as string | undefined,
          expiresIn: data.expires_in as number | undefined,
        };
      }

      case 'INSTAGRAM': {
        if (!account.encryptedAccessToken) return null;
        const currentToken = decrypt(account.encryptedAccessToken);
        const url = `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
          grant_type: 'ig_refresh_token',
          access_token: currentToken,
        })}`;
        const res = await fetch(url);
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return null;
        return {
          accessToken: data.access_token as string,
          expiresIn: data.expires_in as number | undefined,
        };
      }

      case 'YOUTUBE': {
        if (!account.encryptedRefreshToken) return null;
        const refreshToken = decrypt(account.encryptedRefreshToken);
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.googleClientId ?? '',
            client_secret: config.googleClientSecret ?? '',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return null;
        return {
          accessToken: data.access_token as string,
          refreshToken: data.refresh_token as string | undefined,
          expiresIn: data.expires_in as number | undefined,
        };
      }

      case 'TWITTER': {
        if (!account.encryptedRefreshToken) return null;
        const refreshToken = decrypt(account.encryptedRefreshToken);
        const res = await fetch('https://api.x.com/2/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.twitterClientId ?? '',
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) return null;
        return {
          accessToken: data.access_token as string,
          refreshToken: data.refresh_token as string | undefined,
          expiresIn: data.expires_in as number | undefined,
        };
      }
    }
  } catch (err) {
    logger.error({ err, platform }, 'Token refresh failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function socialLinkingRoutes(app: FastifyInstance) {

  // GET /linked-accounts/connect/:platform — initiate OAuth flow
  app.get<{ Params: { platform: string } }>(
    '/connect/:platform',
    async (request, reply) => {
      const user = requireAuth(request);
      const platform = request.params.platform.toUpperCase() as Platform;

      if (!VALID_PLATFORMS.includes(platform)) {
        throw badRequest(`Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}`);
      }

      // Build state token (10-minute TTL)
      let codeChallenge: string | undefined;
      let codeVerifier: string | undefined;

      if (platform === 'TWITTER') {
        const pkce = generatePKCE();
        codeVerifier = pkce.codeVerifier;
        codeChallenge = pkce.codeChallenge;
      }

      const state = signState({
        userId: user.userId,
        platform,
        codeVerifier,
        exp: Date.now() + 10 * 60 * 1000,
      });

      const authUrl = buildAuthUrl(platform, state, codeChallenge);

      return reply.redirect(authUrl);
    },
  );

  // GET /linked-accounts/callback/:platform — OAuth callback
  app.get<{ Params: { platform: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback/:platform',
    async (request, reply) => {
      const platform = request.params.platform.toUpperCase() as Platform;

      if (!VALID_PLATFORMS.includes(platform)) {
        return reply.redirect(`${FRONTEND_SETTINGS}?link_error=invalid_platform`);
      }

      const { code, state, error: oauthError } = request.query;

      if (oauthError) {
        logger.warn({ platform, error: oauthError }, 'OAuth provider returned error');
        return reply.redirect(`${FRONTEND_SETTINGS}?link_error=${encodeURIComponent(oauthError)}`);
      }

      if (!code || !state) {
        return reply.redirect(`${FRONTEND_SETTINGS}?link_error=missing_code_or_state`);
      }

      const payload = verifyState(state);
      if (!payload) {
        return reply.redirect(`${FRONTEND_SETTINGS}?link_error=invalid_or_expired_state`);
      }

      if (payload.platform !== platform) {
        return reply.redirect(`${FRONTEND_SETTINGS}?link_error=platform_mismatch`);
      }

      try {
        // Exchange authorization code for tokens
        const tokens = await exchangeCodeForTokens(platform, code, payload.codeVerifier);

        // Fetch platform profile
        const profile = await fetchPlatformProfile(platform, tokens.accessToken);

        // Compute expiry
        const expiresAt = tokens.expiresIn
          ? new Date(Date.now() + tokens.expiresIn * 1000)
          : null;

        // Determine scopes
        const scopes = platform === 'TIKTOK'
          ? ['user.info.basic', 'video.list']
          : platform === 'INSTAGRAM'
            ? ['instagram_basic', 'instagram_manage_insights']
            : platform === 'YOUTUBE'
              ? ['https://www.googleapis.com/auth/youtube.readonly']
              : ['tweet.read', 'users.read', 'offline.access'];

        // Upsert the linked account
        await prisma.linkedSocialAccount.upsert({
          where: { userId_platform: { userId: payload.userId, platform } },
          create: {
            userId: payload.userId,
            platform,
            platformId: profile.platformId,
            username: profile.username,
            platformDisplayName: profile.displayName,
            status: 'connected',
            encryptedAccessToken: encrypt(tokens.accessToken),
            encryptedRefreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
            expiresAt,
            scopes,
          },
          update: {
            platformId: profile.platformId,
            username: profile.username,
            platformDisplayName: profile.displayName,
            status: 'connected',
            encryptedAccessToken: encrypt(tokens.accessToken),
            encryptedRefreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
            expiresAt,
            scopes,
          },
        });

        logger.info({ userId: payload.userId, platform, platformId: profile.platformId }, 'Social account linked');
        return reply.redirect(`${FRONTEND_SETTINGS}?linked=${platform.toLowerCase()}`);
      } catch (err) {
        logger.error({ err, platform }, 'Social linking callback failed');
        const message = err instanceof Error ? err.message : 'unknown_error';
        return reply.redirect(`${FRONTEND_SETTINGS}?link_error=${encodeURIComponent(message)}`);
      }
    },
  );

  // GET /linked-accounts/:platform/token — internal (service-to-service) token retrieval
  app.get<{ Params: { platform: string }; Querystring: { userId?: string } }>(
    '/:platform/token',
    async (request, reply) => {
      const platform = request.params.platform.toUpperCase() as Platform;
      const userId = request.query.userId;

      if (!VALID_PLATFORMS.includes(platform)) {
        throw badRequest(`Invalid platform. Must be one of: ${VALID_PLATFORMS.join(', ')}`);
      }
      if (!userId) {
        throw badRequest('userId query parameter is required');
      }

      const account = await prisma.linkedSocialAccount.findUnique({
        where: { userId_platform: { userId, platform } },
      });

      if (!account) {
        throw notFound(`No linked ${platform} account found for user`);
      }

      if (account.status === 'disconnected') {
        throw notFound(`${platform} account is disconnected`);
      }

      // Check if token is expired and attempt refresh
      if (account.expiresAt && account.expiresAt < new Date()) {
        const refreshed = await refreshPlatformToken(platform, account);

        if (!refreshed) {
          // Mark as token_expired
          await prisma.linkedSocialAccount.update({
            where: { id: account.id },
            data: { status: 'token_expired' },
          });
          return reply.status(401).send({
            error: { code: 'TOKEN_EXPIRED', message: `${platform} token expired and refresh failed` },
          });
        }

        // Update with refreshed tokens
        const newExpiresAt = refreshed.expiresIn
          ? new Date(Date.now() + refreshed.expiresIn * 1000)
          : null;

        await prisma.linkedSocialAccount.update({
          where: { id: account.id },
          data: {
            encryptedAccessToken: encrypt(refreshed.accessToken),
            encryptedRefreshToken: refreshed.refreshToken ? encrypt(refreshed.refreshToken) : account.encryptedRefreshToken,
            expiresAt: newExpiresAt,
            status: 'connected',
          },
        });

        return {
          accessToken: refreshed.accessToken,
          platform,
          expiresAt: newExpiresAt?.toISOString() ?? null,
        };
      }

      // Token is still valid — decrypt and return
      const accessToken = account.encryptedAccessToken
        ? decrypt(account.encryptedAccessToken)
        : null;

      if (!accessToken) {
        throw notFound(`No access token stored for ${platform} account`);
      }

      return {
        accessToken,
        platform,
        expiresAt: account.expiresAt?.toISOString() ?? null,
      };
    },
  );
}
