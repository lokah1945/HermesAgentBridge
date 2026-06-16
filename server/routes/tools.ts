import { Router } from 'express';
import { z } from 'zod';
import { toolsController } from '../controllers/tools.controller';
import { validateBody } from '../middleware/validate';

const router = Router();

const executeToolSchema = z.object({
  tool: z.enum(['terminal', 'git', 'search']),
  session_id: z.string().min(1, 'session_id is required'),
  action: z.string().optional(),
  params: z.any().optional()
});

router.post('/execute', validateBody(executeToolSchema), (req, res) => {
  toolsController.executeTool(req, res);
});

export default router;
