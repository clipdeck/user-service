import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError } from '../lib/errors';
import * as userService from '../services/userService';

export async function profileRoutes(app: FastifyInstance) {
  // PUT /profiles/me - Update profile details (displayName, bio, etc.)
  app.put('/me', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const body = request.body as {
        displayName?: string;
        bio?: string;
        avatarUrl?: string;
        isPublic?: boolean;
        location?: string;
        showEarnings?: boolean;
        socialLinks?: Record<string, string>;
        website?: string;
        username?: string;
      };
      const updated = await userService.updateProfileDetails(authUser.userId, body);
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // PATCH /profiles/me/onboarding - Complete onboarding
  app.patch('/me/onboarding', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const updated = await userService.completeOnboarding(authUser.userId);
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });
}
