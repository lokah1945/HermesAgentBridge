import { executeCommand } from './terminal';

export async function searchWorkspace(workspaceRoot: string, query: string): Promise<any> {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows
        ? `findstr /s /i /n "${query}" "${workspaceRoot}\\*"`
        : `grep -rn "${query}" "${workspaceRoot}"`;
    return await executeCommand(workspaceRoot, cmd);
}
