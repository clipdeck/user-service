import { createConsumer, withRetry, withLogging } from '@clipdeck/events';
import type { EventConsumer } from '@clipdeck/events';
import { logger } from '../lib/logger';
import { config } from '../config';

let consumer: EventConsumer | null = null;

/**
 * Set up event handlers for events this service consumes from other services.
 *
 * The user-service primarily publishes events (profile_updated, etc.)
 * but may consume a small set for internal bookkeeping.
 */
export async function setupEventHandlers() {
  consumer = createConsumer({
    serviceName: 'user-service',
    connectionUrl: config.rabbitmqUrl,
    exchange: config.eventExchange,
    queueName: 'user.events',
    routingKeys: ['user.profile_updated', 'user.onboarding_completed'],
    enableLogging: true,
    logger: {
      info: (msg, data) => logger.info(data, msg),
      error: (msg, err) => logger.error(err, msg),
      debug: (msg, data) => logger.debug(data, msg),
    },
  });

  // Handle profile update echo (e.g. for cache invalidation or audit logging)
  consumer.on(
    'user.profile_updated',
    withRetry(
      withLogging(async (event, ctx) => {
        logger.debug(
          { event: event.type, userId: event.payload.userId },
          'Profile update event received'
        );
        ctx.ack();
      })
    )
  );

  await consumer.start();
  logger.info('Event handlers started');
}

export async function stopEventHandlers() {
  if (consumer) {
    await consumer.stop();
    consumer = null;
  }
}
