import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.ico',
  '*.svg',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.mp4',
  '*.mp3',
  '*.vsix',
  '*.zip',
  '*.gz',
  '*.tar',
  '*.exe',
  '*.dll',
  '*.bin',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml'
];

export function generateFileTree(rootDir: string, maxDepth: number = 4): string {
    const ig = ignore();
    ig.add(DEFAULT_IGNORE);

    const gitignorePath = path.join(rootDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        try {
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            const lines = gitignoreContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            ig.add(lines);
        } catch (e) {
            console.error('[Hermes] [Workspace] Error reading .gitignore:', e);
        }
    }

    function buildTree(currentDir: string, depth: number, prefix: string = ''): string {
        if (depth > maxDepth) return '';
        
        let result = '';
        let items: string[] = [];
        try {
            items = fs.readdirSync(currentDir);
        } catch (e) {
            return '';
        }

        const filteredItems = items.filter(item => {
            const fullPath = path.join(currentDir, item);
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            
            if (ig.ignores(relativePath) || ig.ignores(relativePath + '/')) {
                return false;
            }
            return true;
        });

        filteredItems.sort((a, b) => {
            let aStat;
            let bStat;
            try {
                aStat = fs.statSync(path.join(currentDir, a));
                bStat = fs.statSync(path.join(currentDir, b));
            } catch (e) {
                return a.localeCompare(b);
            }
            if (aStat.isDirectory() && !bStat.isDirectory()) return -1;
            if (!aStat.isDirectory() && bStat.isDirectory()) return 1;
            return a.localeCompare(b);
        });

        for (let i = 0; i < filteredItems.length; i++) {
            const item = filteredItems[i];
            const fullPath = path.join(currentDir, item);
            const isLast = i === filteredItems.length - 1;
            let isDir = false;
            try {
                isDir = fs.statSync(fullPath).isDirectory();
            } catch (e) {
                // Ignore errors
            }

            const marker = isLast ? '└── ' : '├── ';
            result += `${prefix}${marker}${item}${isDir ? '/' : ''}\n`;

            if (isDir) {
                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                result += buildTree(fullPath, depth + 1, newPrefix);
            }
        }
        return result;
    }

    return buildTree(rootDir, 1);
}
