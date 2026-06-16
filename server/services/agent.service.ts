import { getSession, saveSession } from '../session-store';
import { sseService } from './sse.service';
import { gitStatus, gitDiff } from '../../tools/git';
import { executeStep } from '../../runtime/executor';
import { revisePlanForError } from '../../runtime/planner';
import { executeCommand } from '../../tools/terminal';
import { searchWorkspace } from '../../tools/search';
import { writeFile } from '../../tools/filesystem';
import { logger } from '../../shared/logger';
import fs from 'fs';
import path from 'path';

const EXECUTIONS_FILE = path.join(process.cwd(), 'data', 'executions.json');

export interface ActiveExecution {
  resolve: (action: 'approve' | 'reject') => void;
  pendingStep?: any;
}

class AgentService {
  public activeExecutions: Record<string, ActiveExecution> = {};

  constructor() {
    this.loadExecutions();
  }

  private loadExecutions(): void {
    try {
      if (fs.existsSync(EXECUTIONS_FILE)) {
        const data = fs.readFileSync(EXECUTIONS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.activeExecutions = parsed;
        logger.info(`[Agent Service] Loaded ${Object.keys(parsed).length} persisted executions`);
      }
    } catch (e) {
      logger.warn('[Agent Service] Failed to load executions file');
    }
  }

  private saveExecutions(): void {
    try {
      const dir = path.dirname(EXECUTIONS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serializable: Record<string, any> = {};
      for (const [key, value] of Object.entries(this.activeExecutions)) {
        serializable[key] = { pendingStep: value.pendingStep };
      }
      fs.writeFileSync(EXECUTIONS_FILE, JSON.stringify(serializable, null, 2));
      logger.debug(`[Agent Service] Saved ${Object.keys(serializable).length} executions to file`);
    } catch (e) {
      logger.warn('[Agent Service] Failed to save executions file');
    }
  }

  public async handleStepFailure(
    sessionId: string,
    failedStep: any,
    errorMsg: string,
    context: any
  ): Promise<boolean> {
    const session = getSession(sessionId);
    if (!session) return false;

    session.retryCount = session.retryCount || 0;
    if (session.retryCount >= 2) {
      logger.error(`[Agent Service] Max retries reached for session ${sessionId}. Error: ${errorMsg}`);
      sseService.send(sessionId, 'error', { error: `Max retries reached. Original error: ${errorMsg}` });
      return false;
    }

    session.retryCount++;
    logger.warn(`[Agent Service] Step ${failedStep.id} failed in session ${sessionId}. Retrying (Attempt ${session.retryCount}/2) via Self-Correction Loop...`);
    sseService.send(sessionId, 'info', { message: `Step ${failedStep.id} failed. Retrying (Attempt ${session.retryCount}/2) via Self-Correction Loop...` });

    try {
      const revisedPlan = await revisePlanForError(failedStep, errorMsg, context, session.history);
      const currentIdx = session.currentStepIndex || 0;
      const remainingSteps = session.plan.steps.slice(currentIdx + 1);

      session.plan.steps = [
        ...session.plan.steps.slice(0, currentIdx),
        ...revisedPlan.steps,
        ...remainingSteps
      ];

      session.currentStepIndex = currentIdx;
      session.pendingStep = undefined;
      saveSession(sessionId, session);

      sseService.send(sessionId, 'plan', session.plan);
      // Run the loop asynchronously
      this.runAgentLoop(sessionId);
      return true;
    } catch (e: any) {
      logger.error(`[Agent Service] Self-correction failed for session ${sessionId}: ${e.message}`);
      sseService.send(sessionId, 'error', { error: `Self-correction failed: ${e.message}` });
      return false;
    }
  }

  public async runAgentLoop(sessionId: string): Promise<void> {
    const session = getSession(sessionId);
    if (!session || !session.plan || session.currentStepIndex === undefined) {
      return;
    }

    const workspaceRoot = session.workspace?.root || session.workspace || process.cwd();
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

    const steps = session.plan.steps;
    const modifiedFiles: string[] = [];

    for (let i = session.currentStepIndex; i < steps.length; i++) {
      const currentSession = getSession(sessionId);
      if (!currentSession) break;
      currentSession.currentStepIndex = i;
      saveSession(sessionId, currentSession);

      const step = steps[i];

      try {
        const isAuto = step.mode === 'auto' || currentSession.mode === 'auto';

        if (isAuto) {
          const result = await executeStep(step, context, currentSession.history);
          if (result.status === 'success') {
            if (step.action === 'write_file' && result.diff) {
              modifiedFiles.push(result.diff.file);
            }
            sseService.send(sessionId, 'result', result);
            currentSession.history.push({ role: 'user', content: `Executed step ${step.id}: ${step.description}` });
            currentSession.history.push({ role: 'assistant', content: result.output || "Success" });
            saveSession(sessionId, currentSession);
          } else {
            const errorMsg = result.error || "Step execution failed";
            const handled = await this.handleStepFailure(sessionId, step, errorMsg, context);
            if (handled) return;
            sseService.send(sessionId, 'error', { error: errorMsg });
            return;
          }
        } else {
          // Review mode
          const result = await executeStep(step, context, currentSession.history);
          if (result.status === 'error') {
            const errorMsg = result.error || "Step preparation failed";
            const handled = await this.handleStepFailure(sessionId, step, errorMsg, context);
            if (handled) return;
            sseService.send(sessionId, 'error', { error: errorMsg });
            return;
          }

          if (step.action === 'write_file' && result.diff) {
            sseService.send(sessionId, 'diff', {
              stepId: step.id,
              file: step.target,
              unified: result.diff.unified || ""
            });
            currentSession.pendingStep = {
              stepId: step.id,
              action: step.action,
              target: step.target,
              after: result.diff.after
            };
            saveSession(sessionId, currentSession);
          } else if (step.action === 'run_command') {
            sseService.send(sessionId, 'diff', {
              stepId: step.id,
              file: step.target,
              unified: `Command to execute: ${step.target}`,
              action: 'run_command'
            });
            currentSession.pendingStep = {
              stepId: step.id,
              action: step.action,
              target: step.target,
              after: ''
            };
            saveSession(sessionId, currentSession);
          }

          sseService.send(sessionId, 'awaiting_approval', { session_id: sessionId, step_id: step.id, action: step.action });

          const approvalPromise = new Promise<'approve' | 'reject'>((resolve) => {
            this.activeExecutions[sessionId] = {
              resolve,
              pendingStep: step
            };
            this.saveExecutions();
          });

          const action = await approvalPromise;
          delete this.activeExecutions[sessionId];
          this.saveExecutions();

          const updatedSession = getSession(sessionId);
          if (!updatedSession) return;

          if (action === 'approve') {
            if (step.action === 'write_file' && result.diff) {
              const writeRes = writeFile(workspaceRoot, step.target, result.diff.after);
              if (writeRes.success) {
                modifiedFiles.push(result.diff.file);
                sseService.send(sessionId, 'applied', { file: step.target, stepId: step.id });
              } else {
                const errorMsg = writeRes.error || "Failed to write file";
                const handled = await this.handleStepFailure(sessionId, step, errorMsg, context);
                if (handled) return;
                sseService.send(sessionId, 'error', { error: errorMsg });
                return;
              }
            } else if (step.action === 'run_command') {
              const execResult = await executeCommand(workspaceRoot, step.target);
              if (execResult.success) {
                sseService.send(sessionId, 'result', { stepId: step.id, status: 'success', output: execResult.output });
              } else {
                const errorMsg = execResult.output || "Failed to execute command";
                const handled = await this.handleStepFailure(sessionId, step, errorMsg, context);
                if (handled) return;
                sseService.send(sessionId, 'error', { error: errorMsg });
                return;
              }
            } else {
              sseService.send(sessionId, 'result', result);
            }
            updatedSession.pendingStep = undefined;
            updatedSession.history.push({ role: 'user', content: `Executed step ${step.id}: ${step.description}` });
            updatedSession.history.push({ role: 'assistant', content: result.output || "Success" });
            saveSession(sessionId, updatedSession);
          } else {
            updatedSession.pendingStep = undefined;
            saveSession(sessionId, updatedSession);
            sseService.send(sessionId, 'rejected', { stepId: step.id });
          }
        }
      } catch (e: any) {
        logger.error(`[Agent Loop Error] sessionId: ${sessionId}`, e);
        const handled = await this.handleStepFailure(sessionId, step, e.message || "Failed during step execution", context);
        if (handled) return;
        sseService.send(sessionId, 'error', { error: e.message || "Failed during step execution" });
        return;
      }
    }

    const finalSession = getSession(sessionId);
    if (finalSession) {
      finalSession.currentStepIndex = steps.length;
      finalSession.retryCount = 0;
      saveSession(sessionId, finalSession);
    }
    sseService.send(sessionId, 'done', { summary: "Task completed", files_modified: modifiedFiles });
  }
}

export const agentService = new AgentService();
export const runAgentLoop = (sessionId: string) => agentService.runAgentLoop(sessionId);
