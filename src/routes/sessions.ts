import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { sendError } from '../lib/errors';
import { prisma } from '../lib/prisma';

export async function sessionRoutes(app: FastifyInstance) {
  // GET /users/me/sessions - List sessions without exposing raw token values
  app.get('/me/sessions', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      const sessions = await prisma.userSession.findMany({
        where: { userId: authUser.userId },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          userAgent: true,
          ipAddress: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return { sessions };
    } catch (error) {
      sendError(reply, error);
    }
  });

  // DELETE /users/me/sessions/:id - Revoke a session
  app.delete<{ Params: { id: string } }>('/me/sessions/:id', async (request, reply) => {
    try {
      const authUser = requireAuth(request);
      await prisma.userSession.deleteMany({
        where: { id: request.params.id, userId: authUser.userId },
      });
      return reply.status(204).send();
    } catch (error) {
      sendError(reply, error);
    }
  });
}
