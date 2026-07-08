import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import type { PtyManager } from './pty/PtyManager.js';

const createSessionSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  cursorId: z.string().optional(),
  initialWaitMs: z.number().int().min(0).optional(),
});

const writeSchema = z.object({
  input: z.string(),
});

const resizeSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

const updateSessionSchema = z.object({
  alias: z.string().trim().min(1).max(80).optional(),
});

export function createHttpApp(manager: PtyManager) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/sessions', (_req, res) => {
    res.json({ sessions: manager.listSessions() });
  });

  app.post('/api/sessions', async (req, res, next) => {
    try {
      const body = createSessionSchema.parse(req.body ?? {});
      const result = await manager.createSession(body);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sessions/:sessionId/snapshot', (req, res, next) => {
    try {
      res.json(manager.getSnapshot(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/sessions/:sessionId/read', (req, res, next) => {
    try {
      const cursorId = typeof req.query.cursorId === 'string' ? req.query.cursorId : 'web';
      res.json(manager.read(req.params.sessionId, cursorId));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sessions/:sessionId/write', (req, res, next) => {
    try {
      const { input } = writeSchema.parse(req.body);
      manager.write(req.params.sessionId, input);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/sessions/:sessionId/resize', (req, res, next) => {
    try {
      const { cols, rows } = resizeSchema.parse(req.body);
      manager.resize(req.params.sessionId, cols, rows);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/sessions/:sessionId', (req, res, next) => {
    try {
      const { alias } = updateSessionSchema.parse(req.body ?? {});
      res.json({ session: manager.updateAlias(req.params.sessionId, alias) });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/sessions/:sessionId', (req, res, next) => {
    try {
      manager.close(req.params.sessionId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.flatten() });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: message });
  });

  return app;
}
