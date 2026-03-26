import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError } from '../lib/errors';
import * as userService from '../services/userService';

export async function userRoutes(app: FastifyInstance) {
  // GET /users/me - Get current user profile (auth required)
  app.get('/me', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const user = await userService.getUserById(authUser.userId);
      return user;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // PUT /users/me - Update user profile
  app.put('/me', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const body = request.body as {
        walletAddress?: string;
        name?: string;
        phoneNumber?: string;
      };
      const updated = await userService.updateProfile(authUser.userId, body);
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // PATCH /users/me - Alias for PUT /users/me (frontend compatibility)
  app.patch('/me', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const body = request.body as {
        walletAddress?: string;
        name?: string;
        phoneNumber?: string;
      };
      const updated = await userService.updateProfile(authUser.userId, body);
      return updated;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /users/me/stats - Get user stats
  app.get('/me/stats', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const stats = await userService.getUserStats(authUser.userId);
      return stats;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /users/by-username/:username - Get by username (public)
  app.get<{ Params: { username: string } }>('/by-username/:username', async (request, reply) => {
    try {
      const result = await userService.getUserByUsername(request.params.username);
      return result;
    } catch (error) {
      sendError(reply, error);
    }
  });

  // GET /users/:id - Get user by ID (public profile)
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const user = await userService.getUserById(request.params.id);

      // Return only public-safe data for non-authenticated requests
      return {
        id: user.id,
        name: user.name,
        image: user.image,
        profile: user.profile
          ? {
              displayName: user.profile.displayName,
              avatarUrl: user.profile.avatarUrl,
              username: user.profile.username,
              bio: user.profile.isPublic ? user.profile.bio : undefined,
              location: user.profile.isPublic ? user.profile.location : undefined,
              website: user.profile.isPublic ? user.profile.website : undefined,
              socialLinks: user.profile.isPublic ? user.profile.socialLinks : undefined,
              role: user.profile.role,
              isPublic: user.profile.isPublic,
              memberSince: user.profile.createdAt,
            }
          : null,
      };
    } catch (error) {
      sendError(reply, error);
    }
  });
}
