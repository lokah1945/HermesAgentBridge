import { Router } from 'express';
import { z } from 'zod';
import { healthController } from '../controllers/health.controller';
import { validateBody } from '../middleware/validate';

const router = Router();

const workspaceContextSchema = z.object({
  workspace: z.string().optional()
});

router.get('/health', (req, res) => {
  healthController.getHealth(req, res);
});

router.post('/workspace/context', validateBody(workspaceContextSchema), (req, res) => {
  healthController.getWorkspaceContext(req, res);
});

router.post('/responses', (req, res) => {
  healthController.handleResponsePlaceholder(req, res);
});

router.get('/stats', (req, res) => {
  healthController.getStats(req, res);
});

export default router;
