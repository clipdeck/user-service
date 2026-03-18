import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../setup';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('user-service');
  });

  it('responds quickly (under 100ms)', async () => {
    const start = Date.now();
    const res = await app.inject({ method: 'GET', url: '/health' });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('GET /ready', () => {
  it('returns 200 with status ready', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.service).toBe('user-service');
  });

  it('responds quickly (under 100ms)', async () => {
    const start = Date.now();
    const res = await app.inject({ method: 'GET', url: '/ready' });
    const elapsed = Date.now() - start;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });
});
