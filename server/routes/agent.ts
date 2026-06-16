import { Router, Request, Response, NextFunction } from 'express';
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

const approveRejectSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  stepId: z.string().min(1, 'stepId is required')
});

function validateParams(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({ error: 'Validation failed', details: result.error.issues });
    }
    next();
  };
}

router.post('/run', validateBody(runAgentSchema), (req, res) => {
  agentController.runAgent(req, res);
});

router.post('/approve/:sessionId/:stepId', validateParams(approveRejectSchema), (req, res) => {
  agentController.approveStep(req, res);
});

router.post('/reject/:sessionId/:stepId', validateParams(approveRejectSchema), (req, res) => {
  agentController.rejectStep(req, res);
});

export default router;

