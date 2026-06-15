import { exec } from 'child_process';

export function executeCommand(workspaceRoot: string, command: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
        exec(command, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, output: stderr || error.message });
            } else {
                resolve({ success: true, output: stdout });
            }
        });
    });
}
