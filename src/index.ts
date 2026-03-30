import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { logger } from './lib/logger';
import { register } from './lib/metrics';
import { userRoutes } from './routes/users';
import { profileRoutes } from './routes/profiles';
import { searchRoutes } from './routes/search';
import { referralRoutes } from './routes/referrals';
import { linkedAccountRoutes } from './routes/linkedAccounts';
import { sessionRoutes } from './routes/sessions';
import { publisher } from './lib/events';
import { setupEventHandlers, stopEventHandlers } from './events/handlers';
import { auth } from './lib/auth';

async function main() {
  const app = Fastify({
    loggerInstance: logger,
  });

  // Plugins
  await app.register(cors, {
    origin: [...config.allowedOrigins, 'https://clipdeck.ar'],
    credentials: true,
  });
  await app.register(helmet);

  // Mount Better Auth handler at /auth/* (before other routes).
  //
  // Why not toNodeHandler?  Fastify's JSON content-type parser reads and
  // drains request.raw before our route handler fires.  toNodeHandler then
  // tries to read the body a second time → gets an empty stream → hangs on
  // POST bodies (sign-in/social, etc).
  //
  // Instead, we call auth.handler() (the fetch-API surface) directly:
  // 1. Build a Web API Request using request.body (already parsed by Fastify).
  // 2. Await the Response.
  // 3. Write status + headers + body straight to reply.raw (hijacked so
  //    Fastify doesn't interfere).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    // Keep the raw string so auth routes can re-serialize it faithfully.
    try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error); }
  });

  app.all('/auth/*', async (request, reply) => {
    reply.hijack();

    // Better Auth's baseURL is 'https://api.clipdeck.ar/api/auth'.
    // It ignores basePath when baseURL already has a path (Better Auth's withPath()
    // short-circuits when checkHasPath() is true), so the effective mount point is
    // exactly the baseURL pathname (/api/auth).
    //
    // The api-gateway strips /api and forwards /auth/* to us.
    // Strip the leading /auth so we get the bare endpoint path, then prepend
    // betterAuthUrl to reconstruct the canonical URL Better Auth expects.
    const basePath = '/auth';
    const endpointPath = request.url.startsWith(basePath)
      ? request.url.slice(basePath.length) || '/'
      : request.url;
    const url = new URL(config.betterAuthUrl + endpointPath);

    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) {
      if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    let body: string | null = null;
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body != null) {
      body = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body);
      headers.set('content-type', 'application/json');
    }

    const fetchReq  = new Request(url, { method: request.method, headers, body });
    const fetchRes  = await auth.handler(fetchReq);

    // Collect headers — must group duplicate keys into string[] so that
    // all set-cookie values survive. Using Record<string,string> + simple
    // assignment silently drops all but the last value for any repeated key.
    const resHeaders: Record<string, string | string[]> = {};
    fetchRes.headers.forEach((v, k) => {
      const existing = resHeaders[k];
      if (existing === undefined) {
        resHeaders[k] = v;
      } else if (Array.isArray(existing)) {
        existing.push(v);
      } else {
        resHeaders[k] = [existing, v];
      }
    });

    // Redact raw session tokens from /auth/list-sessions responses to
    // prevent token leakage to the client.
    let responseBody = await fetchRes.text();
    if (endpointPath.startsWith('/list-sessions') && fetchRes.status === 200 && responseBody) {
      try {
        const parsed = JSON.parse(responseBody);
        if (Array.isArray(parsed)) {
          for (const session of parsed) {
            if (session && typeof session.token === 'string') {
              session.token = '[REDACTED]';
            }
          }
          responseBody = JSON.stringify(parsed);
        }
      } catch {
        // Not JSON — pass through unchanged
      }
    }

    reply.raw.writeHead(fetchRes.status, resHeaders);
    reply.raw.end(responseBody);
  });

  // Metrics endpoint for Prometheus scraping
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return reply.send(await register.metrics());
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'user-service' }));
  app.get('/ready', async () => {
    // Could add DB connectivity check here
    return { status: 'ready', service: 'user-service' };
  });

  // Routes
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(profileRoutes, { prefix: '/profiles' });
  await app.register(searchRoutes, { prefix: '/users/search' });
  await app.register(referralRoutes, { prefix: '/referrals' });
  await app.register(linkedAccountRoutes, { prefix: '/users' });
  await app.register(sessionRoutes, { prefix: '/users' });

  // Connect event publisher
  await publisher.connect();

  // Start event consumers
  await setupEventHandlers();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await stopEventHandlers();
    await publisher.disconnect();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Warn if OAuth provider env vars are missing (causes 404 on sign-in routes)
  if (!config.discordClientId || !config.discordClientSecret) {
    logger.warn('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is missing — Discord OAuth will return 404');
  }
  if (!config.googleClientId || !config.googleClientSecret) {
    logger.warn('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing — Google OAuth will return 404');
  }

  // Start server
  await app.listen({ port: config.port, host: config.host });
  logger.info(`User service listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  logger.error(err, 'Failed to start user service');
  process.exit(1);
});
