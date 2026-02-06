import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { logger } from './lib/logger';
import { userRoutes } from './routes/users';
import { profileRoutes } from './routes/profiles';
import { searchRoutes } from './routes/search';
import { referralRoutes } from './routes/referrals';
import { publisher } from './lib/events';
import { setupEventHandlers, stopEventHandlers } from './events/handlers';

async function main() {
  const app = Fastify({
    logger: logger as any,
  });

  // Plugins
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(helmet);

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
