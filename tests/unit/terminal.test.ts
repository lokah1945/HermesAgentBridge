import { describe, it, expect } from 'vitest';
import { executeCommand, isCommandSafe } from '../../tools/terminal';

describe('Terminal Command Safety', () => {
  it('should allow safe commands', () => {
    expect(isCommandSafe('npm run build').safe).toBe(true);
    expect(isCommandSafe('git status').safe).toBe(true);
    expect(isCommandSafe('echo "cd into directory"').safe).toBe(true);
  });

  it('should block commands with forbidden substrings', () => {
    expect(isCommandSafe('rm -rf /').safe).toBe(false);
    expect(isCommandSafe('dd if=/dev/urandom').safe).toBe(false);
  });

  it('should block commands with forbidden tokens (cd, del, etc.)', () => {
    expect(isCommandSafe('cd ..').safe).toBe(false);
    expect(isCommandSafe('chdir ..').safe).toBe(false);
    expect(isCommandSafe('del important.txt').safe).toBe(false);
    expect(isCommandSafe('echo test; cd /').safe).toBe(false);
  });

  it('should return error output when executing blocked command', async () => {
    const res = await executeCommand(process.cwd(), 'cd ..');
    expect(res.success).toBe(false);
    expect(res.output).toContain('Security block');
  });

  it('should successfully execute echo command', async () => {
    const res = await executeCommand(process.cwd(), 'echo hello_hermes');
    expect(res.success).toBe(true);
    expect(res.output).toContain('hello_hermes');
  });
});
