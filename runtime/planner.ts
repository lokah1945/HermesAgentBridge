import { chat, LLMMessage } from '../server/adapter/llm';
import { WorkspaceContext, AgentPlan } from '../shared/types/agent';
import { generateFileTree } from '../tools/workspace';

const PLANNER_SYSTEM_PROMPT = `You are ILMA, a coding agent embedded in the Hermes platform.
You receive a user task and workspace context.
Your response MUST be valid JSON only. No markdown, no explanation.

Response format:
{
  "goal": "one-sentence summary of what will be done",
  "steps": [
    {
      "id": "1",
      "action": "read_file | write_file | run_command | search | explain",
      "target": "file path or command string",
      "description": "what this step does",
      "mode": "auto | review"
    }
  ]
}

Rules:
- read_file and search are always mode: auto
- write_file, run_command are always mode: review
- Maximum 6 steps per plan
- Target paths must be relative to workspace root
- Never include credential exposure or system-level destructive actions`;

export async function createPlan(
  task: string,
  workspaceContext: WorkspaceContext,
  sessionId: string
): Promise<AgentPlan> {
  const rootDir = workspaceContext.root;
  const fileTree = generateFileTree(rootDir);

  const customSystemPrompt = `${PLANNER_SYSTEM_PROMPT}

Here is the current directory tree of the workspace:
${fileTree}`;

  const userPrompt = `Task: ${task}
Workspace Context:
${JSON.stringify(workspaceContext, null, 2)}`;

  const messages: LLMMessage[] = [
    { role: 'system', content: customSystemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let attempts = 2;
  while (attempts > 0) {
    try {
      const response = await chat(messages);
      
      // Clean up response if there are markdown code blocks
      let cleanResponse = response.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.substring(7);
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.substring(3);
      }
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
      }
      cleanResponse = cleanResponse.trim();

      const parsedPlan: AgentPlan = JSON.parse(cleanResponse);
      
      // Basic validation of keys
      if (!parsedPlan.goal || !Array.isArray(parsedPlan.steps)) {
        throw new Error('Parsed object does not conform to AgentPlan schema.');
      }
      
      // Ensure constraints
      parsedPlan.steps = parsedPlan.steps.map(step => {
        let mode = step.mode;
        if (step.action === 'read_file' || step.action === 'search') {
          mode = 'auto';
        } else if (step.action === 'write_file' || step.action === 'run_command') {
          mode = 'review';
        }
        return {
          ...step,
          mode
        };
      });

      return parsedPlan;
    } catch (e: any) {
      attempts--;
      console.warn(`[Planner] Parsing JSON failed (Attempt ${2 - attempts}/2). Error: ${e.message}`);
      if (attempts === 0) {
        throw new Error(`Failed to generate a valid plan JSON: ${e.message}`);
      }
    }
  }

  throw new Error('Failed to generate a valid plan.');
}

export async function revisePlanForError(
  failedStep: any,
  errorMessage: string,
  workspaceContext: WorkspaceContext,
  conversationHistory: LLMMessage[]
): Promise<AgentPlan> {
  const rootDir = workspaceContext.root;
  const fileTree = generateFileTree(rootDir);

  const customSystemPrompt = `${PLANNER_SYSTEM_PROMPT}

Here is the current directory tree of the workspace:
${fileTree}`;

  const userPrompt = `A previous step failed during execution.
Failed Step: ${JSON.stringify(failedStep, null, 2)}
Error: ${errorMessage}

Analyze the error and provide a corrected step or a new set of steps to fix this error and complete the goal.
Response MUST be valid JSON conforming to the AgentPlan schema.`;

  const messages: LLMMessage[] = [
    { role: 'system', content: customSystemPrompt },
    ...conversationHistory,
    { role: 'user', content: userPrompt }
  ];

  let attempts = 2;
  while (attempts > 0) {
    try {
      const response = await chat(messages);
      let cleanResponse = response.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.substring(7);
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.substring(3);
      }
      if (cleanResponse.endsWith('```')) {
        cleanResponse = cleanResponse.substring(0, cleanResponse.length - 3);
      }
      cleanResponse = cleanResponse.trim();

      const parsedPlan: AgentPlan = JSON.parse(cleanResponse);
      if (!parsedPlan.goal || !Array.isArray(parsedPlan.steps)) {
        throw new Error('Parsed object does not conform to AgentPlan schema.');
      }

      parsedPlan.steps = parsedPlan.steps.map(step => {
        let mode = step.mode;
        if (step.action === 'read_file' || step.action === 'search') {
          mode = 'auto';
        } else if (step.action === 'write_file' || step.action === 'run_command') {
          mode = 'review';
        }
        return { ...step, mode };
      });

      return parsedPlan;
    } catch (e: any) {
      attempts--;
      if (attempts === 0) {
        throw new Error(`Failed to generate a revised plan JSON: ${e.message}`);
      }
    }
  }
  throw new Error('Failed to generate a revised plan.');
}

