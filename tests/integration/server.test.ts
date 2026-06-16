import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, server } from '../../server/index';

describe('Server Endpoints Integration Tests', () => {
  afterAll(() => {
    server.close();
  });

  it('should respond to GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(207); // 207 since LLM ollama is likely offline during testing
    expect(res.body.server).toBe('ok');
    expect(res.body.llm.status).toBe('unavailable');
  });

  it('should respond to GET /stats', async () => {
    const res = await request(app).get('/stats');
    expect(res.status).toBe(200);
    expect(res.body.request_count).toBeGreaterThanOrEqual(1);
    expect(res.body.llm_circuit_state).toBe('CLOSED');
  });

  it('should start and end a session', async () => {
    const startRes = await request(app)
      .post('/v1/session/start')
      .send({ workspace: process.cwd(), profile: 'TEST' });

    expect(startRes.status).toBe(200);
    expect(startRes.body.session_id).toBeDefined();

    const sessionId = startRes.body.session_id;

    const endRes = await request(app)
      .post('/v1/session/end')
      .send({ session_id: sessionId });

    expect(endRes.status).toBe(200);
    expect(endRes.body.success).toBe(true);
  });

  it('should trigger Zod validation error on missing fields', async () => {
    const res = await request(app)
      .post('/v1/session/end')
      .send({}); // missing session_id

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].path).toBe('session_id');
  });
});
