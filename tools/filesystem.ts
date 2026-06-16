import fs from 'fs';
import path from 'path';
import { createTwoFilesPatch } from 'diff';

export function securePath(workspaceRoot: string, targetPath: string): { success: boolean; path?: string; error?: string } {
  try {
    const resolvedRoot = path.resolve(workspaceRoot);
    const absoluteTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(resolvedRoot, targetPath);

    const relative = path.relative(resolvedRoot, absoluteTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { success: false, error: 'Access denied: Path outside workspace.' };
    }

    if (fs.existsSync(absoluteTarget)) {
      const lstat = fs.lstatSync(absoluteTarget);
      if (lstat.isSymbolicLink()) {
        const realTarget = fs.realpathSync(absoluteTarget);
        const relativeReal = path.relative(resolvedRoot, realTarget);
        if (relativeReal.startsWith('..') || path.isAbsolute(relativeReal)) {
          return { success: false, error: 'Access denied: Symlink points outside workspace.' };
        }
      }
    }

    return { success: true, path: absoluteTarget };
  } catch (e: any) {
    return { success: false, error: 'Invalid path: ' + e.message };
  }
}

export function readFile(workspaceRoot: string, targetPath: string): { success: boolean; content?: string; error?: string } {
  const securityCheck = securePath(workspaceRoot, targetPath);
  if (!securityCheck.success || !securityCheck.path) {
    return { success: false, error: securityCheck.error };
  }

  try {
    const content = fs.readFileSync(securityCheck.path, 'utf8');
    return { success: true, content };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function writeFile(workspaceRoot: string, targetPath: string, content: string): { success: boolean; error?: string } {
  const securityCheck = securePath(workspaceRoot, targetPath);
  if (!securityCheck.success || !securityCheck.path) {
    return { success: false, error: securityCheck.error };
  }

  try {
    const dir = path.dirname(securityCheck.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(securityCheck.path, content, 'utf8');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function generateDiff(
  filePath: string,
  before: string,
  after: string
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    before,
    after,
    'before',
    'after'
  );
}
