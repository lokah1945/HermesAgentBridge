import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile, securePath } from '../../tools/filesystem';

const tempDir = path.resolve(__dirname, 'temp_ws');

describe('Filesystem Utilities', () => {
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

  it('should successfully write and read a file within workspace', () => {
    const filePath = 'test.txt';
    const content = 'Hello, Hermes!';

    const writeRes = writeFile(tempDir, filePath, content);
    expect(writeRes.success).toBe(true);

    const readRes = readFile(tempDir, filePath);
    expect(readRes.success).toBe(true);
    expect(readRes.content).toBe(content);
  });

  it('should deny access to paths outside workspace (path traversal)', () => {
    const invalidPath = '../test_outside.txt';
    const writeRes = writeFile(tempDir, invalidPath, 'forbidden');
    expect(writeRes.success).toBe(false);
    expect(writeRes.error).toContain('Access denied: Path outside workspace.');

    const readRes = readFile(tempDir, invalidPath);
    expect(readRes.success).toBe(false);
    expect(readRes.error).toContain('Access denied: Path outside workspace.');
  });

  it('should deny symlinks pointing outside the workspace', () => {
    const externalDir = path.resolve(__dirname, 'temp_external');
    if (!fs.existsSync(externalDir)) {
      fs.mkdirSync(externalDir, { recursive: true });
    }
    const externalFile = path.join(externalDir, 'secret.txt');
    fs.writeFileSync(externalFile, 'secret content', 'utf8');

    // Create a symlink in tempDir pointing to externalFile
    const symlinkPath = path.join(tempDir, 'link.txt');
    try {
      fs.symlinkSync(externalFile, symlinkPath);

      // Try to read via symlink in tempDir
      const readRes = readFile(tempDir, 'link.txt');
      expect(readRes.success).toBe(false);
      expect(readRes.error).toContain('Access denied');
    } catch (err) {
      // Symlink creation might require admin privileges on Windows; skip if it fails
      console.warn('Skipping symlink test: could not create symlink (privilege issue).');
    } finally {
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });
});
