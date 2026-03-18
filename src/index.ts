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
import { toNodeHandler } from 'better-auth/node';

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

  // Mount Better Auth handler at /auth/* (before other routes)
  // toNodeHandler wraps the fetch-based Better Auth handler for Node.js http.
  // reply.hijack() tells Fastify we own the raw response — without it Fastify
  // tries to serialize `reply` itself and returns {"statusCode":200,"headers":{…}}.
  const authHandler = toNodeHandler(auth);
  app.all('/auth/*', async (request, reply) => {
    reply.hijack();
    await authHandler(request.raw, reply.raw);
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
