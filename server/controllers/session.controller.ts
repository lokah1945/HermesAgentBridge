import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getSession, saveSession, deleteSession } from '../session-store';
import { sseService } from '../services/sse.service';
import { logger } from '../../shared/logger';

export class SessionController {
  public startSession(req: Request, res: Response): void {
    const sessionId = uuidv4();
    const workspace = req.body.workspace || process.cwd();
    const sessionData = {
      id: sessionId,
      workspace,
      profile: req.body.profile || 'ILMA',
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    saveSession(sessionId, sessionData);
    logger.info(`[Session Controller] Session started: ${sessionId}`);
    res.json({ session_id: sessionId });
  }

  public endSession(req: Request, res: Response): void {
    const { session_id } = req.body;
    deleteSession(session_id);
    logger.info(`[Session Controller] Session ended: ${session_id}`);
    res.json({ success: true });
  }

  public getStream(req: Request, res: Response): void {
    const { sessionId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseService.register(sessionId, res);

    // If session has a pending step when connecting, emit awaiting_approval immediately
    const session = getSession(sessionId);
    if (session && session.pendingStep) {
      setTimeout(() => {
        sseService.send(sessionId, 'awaiting_approval', {
          session_id: sessionId,
          step_id: session.pendingStep.stepId,
          action: session.pendingStep.action
        });
      }, 500);
    }

    req.on('close', () => {
      sseService.unregister(sessionId, res);
    });
  }
}

export const sessionController = new SessionController();
