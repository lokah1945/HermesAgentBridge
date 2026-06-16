import { describe, it, expect, vi } from 'vitest';
import { searchWorkspace } from '../../tools/search';
import * as terminal from '../../tools/terminal';

vi.mock('../../tools/terminal', () => ({
  executeCommand: vi.fn()
}));

describe('Search Utilities', () => {
  it('should call executeCommand with proper OS-specific command', async () => {
    const mockExecute = vi.spyOn(terminal, 'executeCommand');
    mockExecute.mockResolvedValue({ success: true, output: 'match found' });

    const res = await searchWorkspace('/workspace', 'test-query');
    expect(res.success).toBe(true);
    expect(res.output).toBe('match found');

    const expectedCmd = process.platform === 'win32'
      ? `findstr /s /i /n "test-query" "/workspace\\*"`
      : `grep -rn "test-query" "/workspace"`;

    expect(mockExecute).toHaveBeenCalledWith('/workspace', expectedCmd);
  });
});
