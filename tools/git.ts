import { executeCommand } from './terminal';

export async function gitStatus(workspaceRoot: string): Promise<any> {
    const result = await executeCommand(workspaceRoot, 'git status -s');
    return result;
}

export async function gitCommit(workspaceRoot: string, message: string): Promise<any> {
    const addResult = await executeCommand(workspaceRoot, 'git add .');
    if (!addResult.success) return addResult;
    return await executeCommand(workspaceRoot, `git commit -m "${message.replace(/"/g, '\\"')}"`);
}

export async function gitDiff(workspaceRoot: string): Promise<any> {
    const result = await executeCommand(workspaceRoot, 'git diff');
    if (result.success && result.output.length > 2000) {
        result.output = result.output.substring(0, 2000) + '\n\n... [Git diff truncated to 2000 characters]';
    }
    return result;
}
