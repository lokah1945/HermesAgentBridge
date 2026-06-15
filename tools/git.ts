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
