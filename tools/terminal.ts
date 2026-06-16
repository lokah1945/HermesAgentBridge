import { exec } from 'child_process';

const FORBIDDEN_TOKENS = [
  'cd', 'chdir', 'set-location', 'sl',
  'rmdir', 'del', 'format', 'shutdown', 'poweroff', 'reboot',
  'init 0', 'mkfs'
];

const FORBIDDEN_SUBSTRINGS = [
  'rm -rf',
  'del /s',
  'del /f',
  'dd if=',
  ':(){ :|:& };:',
  'format c:',
  'format d:'
];

export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const lowerCommand = command.trim().toLowerCase();

  for (const pattern of FORBIDDEN_SUBSTRINGS) {
    if (lowerCommand.includes(pattern)) {
      return { safe: false, reason: `Command contains forbidden pattern: "${pattern}"` };
    }
  }

  // Tokenize by space and common separators (; && || | &)
  const tokens = lowerCommand.split(/[\s;|&]+/).map(t => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (FORBIDDEN_TOKENS.includes(token)) {
      return { safe: false, reason: `Command contains forbidden token: "${token}"` };
    }
  }

  return { safe: true };
}

export function executeCommand(workspaceRoot: string, command: string): Promise<{ success: boolean; output: string }> {
  const safetyCheck = isCommandSafe(command);
  if (!safetyCheck.safe) {
    return Promise.resolve({
      success: false,
      output: `Security block: ${safetyCheck.reason}`
    });
  }

  return new Promise((resolve) => {
    // Limit execution time to 30 seconds (30000ms)
    exec(command, { cwd: workspaceRoot, timeout: 30000 }, (error, stdout, stderr) => {
      const combinedOutput = (stdout || '') + (stderr || '');
      let finalOutput = combinedOutput.trim();

      if (finalOutput.length > 2000) {
        finalOutput = finalOutput.substring(0, 2000) + '\n\n... [Output truncated to 2000 characters]';
      }

      if (error) {
        if (error.killed) {
          resolve({
            success: false,
            output: `Process timed out after 30 seconds.\n\n${finalOutput}`.trim()
          });
        } else {
          resolve({
            success: false,
            output: finalOutput || error.message
          });
        }
      } else {
        resolve({ success: true, output: finalOutput });
      }
    });
  });
}
