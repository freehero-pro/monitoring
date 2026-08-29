import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRow } from './magicLink.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: UserRow | null;
  }
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.currentUser) {
    await reply.code(401).send({ error: 'Требуется вход' });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.currentUser) {
    await reply.code(401).send({ error: 'Требуется вход' });
    return;
  }
  if (request.currentUser.role !== 'admin') {
    await reply.code(403).send({ error: 'Действие доступно только администратору' });
  }
}
