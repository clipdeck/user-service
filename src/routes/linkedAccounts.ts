import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';

export async function linkedAccountRoutes(app: FastifyInstance) {
  // GET /users/me/linked-accounts
  app.get('/me/linked-accounts', async (request, _reply) => {
    const user = requireAuth(request);
    const accounts = await prisma.linkedSocialAccount.findMany({
      where: { userId: user.userId },
      select: { platform: true, username: true, createdAt: true },
    });
    return { accounts };
  });

  // DELETE /users/me/linked-accounts/:platform
  app.delete<{ Params: { platform: string } }>(
    '/me/linked-accounts/:platform',
    async (request, reply) => {
      const user = requireAuth(request);
      await prisma.linkedSocialAccount.deleteMany({
        where: { userId: user.userId, platform: request.params.platform },
      });
      return reply.status(204).send();
    },
  );
}
