import express from 'express';
import request from 'supertest';
import { installFeedbackBodyParser } from './main.helpers';

/** ROK-1313: POST /feedback alone gets the 8 MB JSON parser. */
function buildApp(): express.Express {
  const app = express();
  installFeedbackBodyParser(app);
  app.use(express.json({ limit: '2mb' }));
  app.post('/feedback', (req, res) => {
    res.json({ length: String(req.body?.screenshotBase64 ?? '').length });
  });
  app.post('/other', (req, res) => {
    res.json({ length: String(req.body?.screenshotBase64 ?? '').length });
  });
  return app;
}

const big = { screenshotBase64: 'A'.repeat(5_000_000) };

describe('installFeedbackBodyParser', () => {
  it('parses a 5 MB JSON body on POST /feedback', async () => {
    const res = await request(buildApp()).post('/feedback').send(big);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ length: 5_000_000 });
  });

  it('leaves every other route on the 2 MB parser', async () => {
    const res = await request(buildApp()).post('/other').send(big);
    expect(res.status).toBe(413);
  });

  it('still rejects a body over 8 MB on POST /feedback', async () => {
    const huge = { screenshotBase64: 'A'.repeat(9_000_000) };
    const res = await request(buildApp()).post('/feedback').send(huge);
    expect(res.status).toBe(413);
  });
});
