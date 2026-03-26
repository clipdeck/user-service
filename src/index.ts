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

    // Better Auth validates the full URL (host + path) against baseURL.
    // baseURL = 'https://api.clipdeck.ar/api', basePath = '/auth', so
    // it expects requests at https://api.clipdeck.ar/api/auth/*.
    // The api-gateway strips /api before forwarding to us, so request.url
    // is /auth/*. Prepend betterAuthUrl to reconstruct the correct URL.
    const url = new URL(config.betterAuthUrl + request.url);

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

    const resHeaders: Record<string, string> = {};
    fetchRes.headers.forEach((v, k) => { resHeaders[k] = v; });

    reply.raw.writeHead(fetchRes.status, resHeaders);
    reply.raw.end(await fetchRes.text());
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

  // Start server
  await app.listen({ port: config.port, host: config.host });
  logger.info(`User service listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  logger.error(err, 'Failed to start user service');
  process.exit(1);
});
