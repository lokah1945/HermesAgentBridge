import { describe, it, expect, beforeEach, vi } from 'vitest';
import { llmService } from '../../server/services/llm.service';

describe('LLM Service & Circuit Breaker', () => {
  beforeEach(() => {
    // Reset LLM Service state
    (llmService as any).failureCount = 0;
    (llmService as any).circuitState = 'CLOSED';
  });

  it('should successfully complete a chat request in CLOSED state', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'mocked response' } }]
    });
    (llmService as any).openai = {
      chat: {
        completions: {
          create: mockCreate
        }
      }
    } as any;

    const res = await llmService.chat([{ role: 'user', content: 'hello' }]);
    expect(res).toBe('mocked response');
    expect(llmService.getCircuitState()).toBe('CLOSED');
  });

  it('should open the circuit breaker after 3 failures', async () => {
    const mockError = new Error('Connection failed');
    const mockCreate = vi.fn().mockRejectedValue(mockError);
    (llmService as any).openai = {
      chat: {
        completions: {
          create: mockCreate
        }
      }
    } as any;

    // Fail 1
    await expect(llmService.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow();
    expect(llmService.getCircuitState()).toBe('CLOSED');

    // Fail 2
    await expect(llmService.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow();
    expect(llmService.getCircuitState()).toBe('CLOSED');

    // Fail 3 -> Circuit opens
    await expect(llmService.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow();
    expect(llmService.getCircuitState()).toBe('OPEN');

    // Call 4 -> immediately throws circuit breaker error without calling openai
    await expect(llmService.chat([{ role: 'user', content: 'hello' }])).rejects.toThrow('Circuit Breaker is OPEN');
    expect(mockCreate).toHaveBeenCalledTimes(3); // only called 3 times total
  });
});
