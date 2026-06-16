import { exec } from 'child_process';

const BLOCK_LIST = [
  'rm -rf /',
  'rm -rf  /',
  'rm -rf *',
  'rmdir /s',
  'del /s',
  'del /f',
  'mkfs',
  'dd if=',
  'shutdown',
  'poweroff',
  'reboot',
  'init 0',
  'format c:',
  'format d:',
  ':(){ :|:& };:'
];

export function executeCommand(workspaceRoot: string, command: string): Promise<{ success: boolean; output: string }> {
    const trimmedCommand = command.trim().toLowerCase();
    
    // Check security blocklist
    for (const blocked of BLOCK_LIST) {
        if (trimmedCommand.includes(blocked)) {
            return Promise.resolve({
                success: false,
                output: `Security block: Command "${command}" contains forbidden pattern "${blocked}"`
            });
        }
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
