import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError, badRequest } from '../lib/errors';
import * as referralService from '../services/referralService';

export async function referralRoutes(app: FastifyInstance) {
  // POST /referrals/generate - Generate referral code
  app.post('/generate', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const result = await referralService.generateReferralCode(authUser.userId);
      reply.status(201);
      return result;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // POST /referrals/apply - Apply referral code
  app.post('/apply', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const body = request.body as { referralCode?: string };

      if (!body.referralCode || typeof body.referralCode !== 'string') {
        throw badRequest('Referral code is required');
      }

      const result = await referralService.processReferral(authUser.userId, body.referralCode);
      return result;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /referrals/stats - Get referral stats
  app.get('/stats', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const stats = await referralService.getReferralStats(authUser.userId);
      return stats;
    } catch (error) {
      sendError(reply, error);
    }
  });
}
