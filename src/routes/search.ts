import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError, badRequest } from '../lib/errors';
import * as searchService from '../services/searchService';

export async function searchRoutes(app: FastifyInstance) {
  // POST /users/search - Search users
  app.post('/', async (request, reply) => {
    try {
      requireAuth(request);
      const body = request.body as { query?: string; limit?: number };

      if (!body.query || typeof body.query !== 'string') {
        throw badRequest('Search query is required');
      }

      const limit = body.limit && body.limit > 0 ? Math.min(body.limit, 50) : 10;
      const results = await searchService.searchUsers(body.query, limit);
      return { results };
    } catch (error) {
      sendError(reply, error);
    }
  });
}
