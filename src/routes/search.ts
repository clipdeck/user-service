import type { FastifyInstance } from 'fastify';
import { sendError, badRequest } from '../lib/errors';
import * as searchService from '../services/searchService';

export async function searchRoutes(app: FastifyInstance) {
  // GET /users/search?q=... - Search users (public)
  app.get<{ Querystring: { q?: string; limit?: string } }>('/', async (request, reply) => {
    try {
      const { q: query, limit: limitStr } = request.query;

      if (!query || typeof query !== 'string') {
        throw badRequest('Search query is required');
      }

      const limit = limitStr && parseInt(limitStr, 10) > 0
        ? Math.min(parseInt(limitStr, 10), 50)
        : 10;
      const results = await searchService.searchUsers(query, limit);
      return { results };
    } catch (error) {
      sendError(reply, error);
    }
  });
}
