import OpenAI from 'openai';
import { config } from '../../shared/config';
import { logger } from '../../shared/logger';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStreamOptions {
  messages: LLMMessage[];
  onChunk: (delta: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class LLMService {
  private openai!: OpenAI;
  private circuitState: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastStateChange: number = Date.now();
  private readonly failureThreshold = 3;
  private readonly cooldownPeriodMs = 30000; // 30 seconds

  constructor() {
    this.initClient();
  }

  public initClient() {
    this.openai = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      timeout: config.llm.timeout
    });
  }

  private updateCircuitState() {
    const now = Date.now();
    if (this.circuitState === 'OPEN' && now - this.lastStateChange > this.cooldownPeriodMs) {
      this.circuitState = 'HALF_OPEN';
      this.lastStateChange = now;
      logger.info('[LLM Service] Circuit state transitioned to HALF_OPEN. Attempting recovery.');
    }
  }

  private handleFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.circuitState = 'OPEN';
      this.lastStateChange = Date.now();
      logger.error(`[LLM Service] Circuit state transitioned to OPEN. LLM connection has failed ${this.failureCount} times.`);
    }
  }

  private handleSuccess() {
    this.failureCount = 0;
    if (this.circuitState !== 'CLOSED') {
      this.circuitState = 'CLOSED';
      this.lastStateChange = Date.now();
      logger.info('[LLM Service] Circuit state restored to CLOSED. Connection recovered.');
    }
  }

  public getCircuitState(): CircuitState {
    this.updateCircuitState();
    return this.circuitState;
  }

  private checkCircuit() {
    this.updateCircuitState();
    if (this.circuitState === 'OPEN') {
      throw new Error('LLM_UNAVAILABLE: Circuit Breaker is OPEN. Ollama connection is currently degraded.');
    }
  }

  private cleanErrorMessage(err: any): Error {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed') || err.cause?.code === 'ECONNREFUSED' || err.name === 'APIConnectionError' || err.name === 'ConnectionError' || err.message?.includes('Connection error')) {
      return new Error('LLM_UNAVAILABLE: Ollama tidak berjalan di ' + config.llm.baseUrl);
    }
    if (err.status === 404) {
      return new Error('LLM_MODEL_NOT_FOUND: Model ' + config.llm.model + ' belum di-pull di Ollama');
    }
    return new Error('LLM_ERROR: ' + err.message);
  }

  public async chat(messages: LLMMessage[]): Promise<string> {
    this.checkCircuit();
    try {
      const completion = await this.openai.chat.completions.create({
        model: config.llm.model,
        messages: messages,
        stream: false
      });
      this.handleSuccess();
      const responseContent = completion.choices[0]?.message?.content || "";
      logger.debug(`[LLM Chat] Model: ${config.llm.model} | Completion successful`);
      return responseContent;
    } catch (err: any) {
      this.handleFailure();
      const cleanErr = this.cleanErrorMessage(err);
      logger.error("[LLM Chat Error]", cleanErr);
      throw cleanErr;
    }
  }

  public async chatStream(options: LLMStreamOptions): Promise<void> {
    try {
      this.checkCircuit();
    } catch (err: any) {
      options.onError(err);
      return;
    }

    try {
      const stream = await this.openai.chat.completions.create({
        model: config.llm.model,
        messages: options.messages,
        stream: true
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          options.onChunk(content);
        }
      }
      this.handleSuccess();
      logger.debug(`[LLM ChatStream] Model: ${config.llm.model} | Stream completed`);
      options.onDone();
    } catch (err: any) {
      this.handleFailure();
      const cleanErr = this.cleanErrorMessage(err);
      logger.error("[LLM ChatStream Error]", cleanErr);
      options.onError(cleanErr);
    }
  }
}

export const llmService = new LLMService();
export const chat = (messages: LLMMessage[]) => llmService.chat(messages);
export const chatStream = (options: LLMStreamOptions) => llmService.chatStream(options);
