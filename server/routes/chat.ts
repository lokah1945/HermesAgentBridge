import { Router } from 'express';
import { z } from 'zod';
import { chatController } from '../controllers/chat.controller';
import { validateBody } from '../middleware/validate';

const router = Router();

const chatCompletionsSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string()
    })
  ).min(1, 'messages array must contain at least 1 message'),
  stream: z.boolean().optional()
});

router.get('/models', (req, res) => {
  chatController.getModels(req, res);
});

router.post('/completions', validateBody(chatCompletionsSchema), (req, res) => {
  chatController.getCompletions(req, res);
});

export default router;
