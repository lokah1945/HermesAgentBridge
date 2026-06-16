import { Router } from 'express';
import { z } from 'zod';
import { sessionController } from '../controllers/session.controller';
import { validateBody } from '../middleware/validate';

const router = Router();

const startSessionSchema = z.object({
  workspace: z.string().optional(),
  profile: z.string().optional()
});

const endSessionSchema = z.object({
  session_id: z.string().min(1, 'session_id is required')
});

router.post('/start', validateBody(startSessionSchema), (req, res) => {
  sessionController.startSession(req, res);
});

router.post('/end', validateBody(endSessionSchema), (req, res) => {
  sessionController.endSession(req, res);
});

router.get('/:sessionId/stream', (req, res) => {
  sessionController.getStream(req, res);
});

export default router;
