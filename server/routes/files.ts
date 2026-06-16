import { Router } from 'express';
import { z } from 'zod';
import { filesController } from '../controllers/files.controller';
import { validateBody } from '../middleware/validate';

const router = Router();

const readFileSchema = z.object({
  path: z.string().min(1, 'path is required'),
  workspace: z.string().min(1, 'workspace is required')
});

const writeFileSchema = z.object({
  path: z.string().min(1, 'path is required'),
  content: z.string(),
  workspace: z.string().min(1, 'workspace is required'),
  diff_preview: z.boolean().optional()
});

router.post('/read', validateBody(readFileSchema), (req, res) => {
  filesController.readFile(req, res);
});

router.post('/write', validateBody(writeFileSchema), (req, res) => {
  filesController.writeFile(req, res);
});

export default router;
