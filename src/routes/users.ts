import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { sendError, forbidden } from '../lib/errors';
import * as userService from '../services/userService';

export async function userRoutes(app: FastifyInstance) {
  // GET /users - List users (staff only)
  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      search?: string;
      sort?: string;
      role?: string;
    };
  }>('/', async (request, reply) => {
    try {
      if (request.headers['x-user-staff'] !== 'true') {
        throw forbidden('Staff access required');
      }

      const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit || '25', 10) || 25));
      const search = request.query.search?.trim();
      const sortParam = request.query.sort || 'createdAt:desc';
      const role = request.query.role;

      // Parse sort parameter
      const [sortField, sortDirection] = sortParam.split(':');
      const allowedSortFields = ['createdAt', 'updatedAt', 'name', 'email', 'role'];
      const orderByField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';
      const orderByDir = sortDirection === 'asc' ? 'asc' : 'desc';

      // Build where clause
      const where: Record<string, unknown> = {};

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (role) {
        where.role = role;
      }

      const safeSelect = {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        onboardingCompleted: true,
        walletAddress: true,
        referralCode: true,
        referralCount: true,
      };

      const [data, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: safeSelect,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { [orderByField]: orderByDir },
        }),
        prisma.user.count({ where }),
      ]);

      return { data, total, page, limit };
    } catch (error) {
      sendError(reply, error);
    }
  });

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
