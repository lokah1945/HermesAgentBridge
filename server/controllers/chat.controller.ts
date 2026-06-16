import { Request, Response } from 'express';
import { llmService } from '../services/llm.service';
import { logger } from '../../shared/logger';

export class ChatController {
  public getModels(req: Request, res: Response): void {
    res.json({ data: [{ id: "hermes-ilma", object: "model" }] });
  }

  public async getCompletions(req: Request, res: Response): Promise<void> {
    const { messages, stream } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await llmService.chatStream({
        messages,
        onChunk: (delta) => {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
        },
        onDone: () => {
          res.write('data: [DONE]\n\n');
          res.end();
        },
        onError: (err) => {
          res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
          res.end();
        }
      });
    } else {
      try {
        const content = await llmService.chat(messages);
        res.json({ choices: [{ message: { role: 'assistant', content } }] });
      } catch (err: any) {
        const status = err.message.includes('LLM_UNAVAILABLE') ? 503 : 500;
        res.status(status).json({
          error: err.message,
          hint: err.message.includes('LLM_UNAVAILABLE') ? "Jalankan: ollama serve" : undefined
        });
      }
    }
  }
}

export const chatController = new ChatController();
