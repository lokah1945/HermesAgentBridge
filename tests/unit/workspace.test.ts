import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { generateFileTree } from '../../tools/workspace';

const tempDir = path.resolve(__dirname, 'temp_workspace_tree');

describe('Workspace Utilities', () => {
  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate a correct file tree structure', () => {
    // Create folders and files
    fs.mkdirSync(path.join(tempDir, 'folder1'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'folder2'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'hello', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'folder1', 'file2.txt'), 'hello', 'utf8');

    // Also create an ignored folder
    fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'some-dep.js'), 'code', 'utf8');

    const tree = generateFileTree(tempDir);
    expect(tree).toContain('├── folder1/');
    expect(tree).toContain('│   └── file2.txt');
    expect(tree).toContain('├── folder2/');
    expect(tree).toContain('└── file1.txt');
    expect(tree).not.toContain('node_modules');
  });

  it('should respect maxDepth parameter', () => {
    // Create nested structure: folder1 -> nested1 -> nested2
    fs.mkdirSync(path.join(tempDir, 'folder1', 'nested1', 'nested2'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'folder1', 'nested1', 'nested2', 'deep.txt'), 'deep', 'utf8');

    // Run with depth limit of 2
    const tree = generateFileTree(tempDir, 2);
    expect(tree).toContain('├── folder1/');
    expect(tree).toContain('└── nested1/');
    expect(tree).not.toContain('nested2/');
    expect(tree).not.toContain('deep.txt');
  });
});
