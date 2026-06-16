import { chat, LLMMessage } from '../server/adapter/llm';
import { WorkspaceContext, AgentStep, ExecutionResult } from '../shared/types/agent';
import { readFile, writeFile, generateDiff } from '../tools/filesystem';
import { executeCommand } from '../tools/terminal';
import { searchWorkspace } from '../tools/search';
import { truncateToLimit } from '../shared/utils/tokenizer';


const CODE_GEN_SYSTEM_PROMPT = `You are ILMA, a coding agent. You are executing a specific file write step.
Generate the complete file content that fulfills the step description.
Respond with ONLY the file content. No explanation, no markdown fences.
The content will be written directly to the file system.
Use the language/framework inferred from the file extension and workspace context.`;

export async function executeStep(
  step: AgentStep,
  workspaceContext: WorkspaceContext,
  conversationHistory: LLMMessage[]
): Promise<ExecutionResult> {
  const root = workspaceContext.root;
  try {
    switch (step.action) {
      case 'read_file': {
        const result = readFile(root, step.target);
        if (result.success) {
          const content = result.content || "";
          if (content.length > 50000) {
            return {
              stepId: step.id,
              status: 'error',
              error: `File too large (${(content.length / 1024).toFixed(1)}KB), please use search tool.`
            };
          }
          return {
            stepId: step.id,
            status: 'success',
            output: content
          };
        } else {
          return {
            stepId: step.id,
            status: 'error',
            error: result.error
          };
        }
      }

      case 'search': {
        const result = await searchWorkspace(root, step.target);
        if (result.success) {
          return {
            stepId: step.id,
            status: 'success',
            output: result.output
          };
        } else {
          return {
            stepId: step.id,
            status: 'error',
            error: result.output
          };
        }
      }

      case 'run_command': {
        if (step.mode === 'review') {
          return {
            stepId: step.id,
            status: 'pending_approval',
            output: `Command to execute: ${step.target}`
          };
        } else {
          const result = await executeCommand(root, step.target);
          if (result.success) {
            return {
              stepId: step.id,
              status: 'success',
              output: result.output
            };
          } else {
            return {
              stepId: step.id,
              status: 'error',
              error: result.output
            };
          }
        }
      }

      case 'explain': {
        const userPrompt = `Explain step: ${step.description}\nTarget: ${step.target}`;
        const messages: LLMMessage[] = [
          { role: 'system', content: 'You are ILMA, a coding assistant. Provide a concise explanation.' },
          ...conversationHistory,
          { role: 'user', content: userPrompt }
        ];
        const output = await chat(messages);
        return {
          stepId: step.id,
          status: 'success',
          output
        };
      }

      case 'write_file': {
        // Read before content
        const beforeResult = readFile(root, step.target);
        const before = beforeResult.success ? (beforeResult.content || "") : "";

        // Construct LLM prompt for code generation
        const userPrompt = `File target: ${step.target}
Step Description: ${step.description}
Workspace Context:
${JSON.stringify(workspaceContext, null, 2)}
Existing File Content (if any):
${before}`;

        const messages: LLMMessage[] = [
          { role: 'system', content: CODE_GEN_SYSTEM_PROMPT },
          ...conversationHistory,
          { role: 'user', content: userPrompt }
        ];

        const afterRaw = await chat(messages);
        // Clean markdown code blocks from the generated content
        let after = afterRaw.trim();
        if (after.startsWith('```')) {
          const firstLineEnd = after.indexOf('\n');
          if (firstLineEnd !== -1) {
            after = after.substring(firstLineEnd + 1);
          } else {
            after = after.substring(3);
          }
        }
        if (after.endsWith('```')) {
          after = after.substring(0, after.length - 3);
        }
        after = after.trim();

        const unified = generateDiff(step.target, before, after);
        const diff = {
          before,
          after,
          file: step.target,
          unified
        };

        if (step.mode === 'review') {
          return {
            stepId: step.id,
            status: 'pending_approval',
            diff,
            output: after
          };
        } else {
          // auto mode: write directly
          const writeResult = writeFile(root, step.target, after);
          if (writeResult.success) {
            return {
              stepId: step.id,
              status: 'success',
              diff,
              output: 'File written successfully'
            };
          } else {
            return {
              stepId: step.id,
              status: 'error',
              error: writeResult.error
            };
          }
        }
      }

      default:
        return {
          stepId: step.id,
          status: 'error',
          error: `Unsupported action: ${step.action}`
        };
    }
  } catch (e: any) {
    return {
      stepId: step.id,
      status: 'error',
      error: e.message
    };
  }
}
