import { Request, Response } from 'express';
import { getSession, saveSession } from '../session-store';
import { gitStatus, gitDiff } from '../../tools/git';
import { createPlan } from '../../runtime/planner';
import { sseService } from '../services/sse.service';
import { agentService } from '../services/agent.service';
import { writeFile } from '../../tools/filesystem';
import { logger } from '../../shared/logger';

export class AgentController {
  public async runAgent(req: Request, res: Response): Promise<void> {
    const { session_id, task, workspace, mode } = req.body;
    const workspaceRoot = workspace.root;

    let session = getSession(session_id);
    if (!session) {
      session = {
        id: session_id,
        workspace,
        profile: 'ILMA',
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    } else {
      session.workspace = workspace;
    }
    session.mode = mode || 'review';
    saveSession(session_id, session);

    const gitStatusRes = await gitStatus(workspaceRoot);
    const gitDiffRes = await gitDiff(workspaceRoot);
    const context = {
      root: workspaceRoot,
      files: [],
      symbols: [],
      dependencies: { imports: [], exports: [] },
      git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status",
      git_diff: gitDiffRes.success ? gitDiffRes.output : "Error fetching git diff"
    };

    try {
      const plan = await createPlan(task, context, session_id);

      session.plan = plan;
      session.currentStepIndex = 0;
      session.pendingStep = undefined;
      saveSession(session_id, session);

      sseService.send(session_id, 'plan', plan);

      // Run agent in background
      agentService.runAgentLoop(session_id);

      res.json({ success: true, message: "Agent started" });
    } catch (e: any) {
      logger.error(`[Agent Run Controller Error] sessionId: ${session_id}`, e);
      sseService.send(session_id, 'error', { error: e.message || "Failed to create plan" });
      const status = e.message.includes('LLM_UNAVAILABLE') ? 503 : 500;
      res.status(status).json({
        error: e.message || "Failed to create plan",
        hint: e.message.includes('LLM_UNAVAILABLE') ? "Jalankan: ollama serve" : undefined
      });
    }
  }

  public approveStep(req: Request, res: Response): void {
    const sessionId = req.params.sessionId as string;
    const stepId = req.params.stepId as string;
    const execution = agentService.activeExecutions[sessionId];

    if (execution && execution.pendingStep?.id === stepId) {
      execution.resolve('approve');
      res.json({ success: true });
    } else {
      const session = getSession(sessionId);
      if (session && session.pendingStep && session.pendingStep.stepId === stepId) {
        const { target, after } = session.pendingStep;
        const workspaceRoot = session.workspace?.root || session.workspace || process.cwd();
        const writeRes = writeFile(workspaceRoot, target, after);
        if (writeRes.success) {
          session.pendingStep = undefined;
          session.currentStepIndex = (session.currentStepIndex ?? 0) + 1;
          saveSession(sessionId, session);

          sseService.send(sessionId, 'applied', { file: target, stepId });
          agentService.runAgentLoop(sessionId);
          res.json({ success: true });
        } else {
          res.status(500).json({ error: writeRes.error || "Failed to write file" });
        }
      } else {
        res.status(400).json({ error: `No active review step found for session ${sessionId} and step ${stepId}` });
      }
    }
  }

  public rejectStep(req: Request, res: Response): void {
    const sessionId = req.params.sessionId as string;
    const stepId = req.params.stepId as string;
    const execution = agentService.activeExecutions[sessionId];

    if (execution && execution.pendingStep?.id === stepId) {
      execution.resolve('reject');
      res.json({ success: true });
    } else {
      const session = getSession(sessionId);
      if (session && session.pendingStep && session.pendingStep.stepId === stepId) {
        session.pendingStep = undefined;
        session.currentStepIndex = (session.currentStepIndex ?? 0) + 1;
        saveSession(sessionId, session);

        sseService.send(sessionId, 'rejected', { stepId });
        agentService.runAgentLoop(sessionId);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: `No active review step found for session ${sessionId} and step ${stepId}` });
      }
    }
  }
}

export const agentController = new AgentController();
