import { Router } from 'express';
import { z } from 'zod';
import { agentController } from '../controllers/agent.controller';
import { validateBody } from '../middleware/validate';

const router = Router();

const runAgentSchema = z.object({
  session_id: z.string().min(1, 'session_id is required'),
  task: z.string().min(1, 'task is required'),
  workspace: z.object({
    root: z.string().min(1, 'workspace root path is required')
  }),
  mode: z.enum(['auto', 'review']).optional()
});

router.post('/run', validateBody(runAgentSchema), (req, res) => {
  agentController.runAgent(req, res);
});

router.post('/approve/:sessionId/:stepId', (req, res) => {
  agentController.approveStep(req, res);
});

router.post('/reject/:sessionId/:stepId', (req, res) => {
  agentController.rejectStep(req, res);
});

export default router;
