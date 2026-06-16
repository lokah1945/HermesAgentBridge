import { describe, it, expect, vi } from 'vitest';
import { gitStatus, gitCommit, gitDiff } from '../../tools/git';
import * as terminal from '../../tools/terminal';

vi.mock('../../tools/terminal', () => ({
  executeCommand: vi.fn()
}));

describe('Git Utilities', () => {
  it('should call executeCommand for gitStatus', async () => {
    const mockExecute = vi.spyOn(terminal, 'executeCommand');
    mockExecute.mockResolvedValue({ success: true, output: 'M file.txt' });

    const res = await gitStatus('/workspace');
    expect(res.success).toBe(true);
    expect(res.output).toBe('M file.txt');
    expect(mockExecute).toHaveBeenCalledWith('/workspace', 'git status -s');
  });

  it('should call executeCommand for gitCommit', async () => {
    const mockExecute = vi.spyOn(terminal, 'executeCommand');
    mockExecute.mockResolvedValueOnce({ success: true, output: 'staged' });
    mockExecute.mockResolvedValueOnce({ success: true, output: 'committed' });

    const res = await gitCommit('/workspace', 'feat: update file');
    expect(res.success).toBe(true);
    expect(res.output).toBe('committed');
  });

  it('should call executeCommand for gitDiff and truncate if needed', async () => {
    const mockExecute = vi.spyOn(terminal, 'executeCommand');
    const longDiff = 'a'.repeat(2500);
    mockExecute.mockResolvedValue({ success: true, output: longDiff });

    const res = await gitDiff('/workspace');
    expect(res.success).toBe(true);
    expect(res.output.length).toBeLessThan(2500);
    expect(res.output).toContain('Git diff truncated');
  });
});
