import fs from 'fs';
import path from 'path';

export function readFile(workspaceRoot: string, targetPath: string): { success: boolean; content?: string; error?: string } {
    try {
        const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(workspaceRoot, targetPath);
        if (!fullPath.startsWith(workspaceRoot)) {
            return { success: false, error: 'Access denied: Path outside workspace.' };
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        return { success: true, content };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export function writeFile(workspaceRoot: string, targetPath: string, content: string): { success: boolean; error?: string } {
    try {
        const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(workspaceRoot, targetPath);
        if (!fullPath.startsWith(workspaceRoot)) {
            return { success: false, error: 'Access denied: Path outside workspace.' };
        }
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
