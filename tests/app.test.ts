import request from 'supertest';
import { app } from '../src/app';

describe('scaffold acceptance', () => {
  it('GET /health returns the success envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      error: null,
      data: { status: 'ok', env: 'test' },
    });
  });

  it('unknown route returns the 404 envelope', async () => {
    const res = await request(app).get('/v1/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('protected probe: missing bearer token yields 401 envelope', async () => {
    const express = await import('express');
    const { requireAuth } = await import('../src/middlewares/auth');
    const { errorMiddleware } = await import('../src/core/errorMiddleware');
    const probe = express.default();
    probe.get('/secure', requireAuth, (_req, res) => res.json({ ok: true }));
    probe.use(errorMiddleware);
    const res = await request(probe).get('/secure');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('zod validation failure returns VALIDATION_ERROR envelope with details', async () => {
    const express = await import('express');
    const { z } = await import('zod');
    const { zodValidate } = await import('../src/middlewares/zodValidate');
    const { errorMiddleware } = await import('../src/core/errorMiddleware');
    const probe = express.default();
    probe.use(express.default.json());
    probe.post('/echo', zodValidate(z.object({ name: z.string().min(2) })), (req, res) =>
      res.json(req.body),
    );
    probe.use(errorMiddleware);
    const res = await request(probe).post('/echo').send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });
});
