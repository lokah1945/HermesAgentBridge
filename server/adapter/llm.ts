import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const configPath = fs.existsSync(path.join(process.cwd(), 'config', 'hermes.config.json'))
    ? path.join(process.cwd(), 'config', 'hermes.config.json')
    : path.join(__dirname, '../../config/hermes.config.json');
let llmConfig = {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    timeout: 60000
};

try {
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.llm) {
            llmConfig = { ...llmConfig, ...config.llm };
        }
    }
} catch (e) {
    console.error("Failed to load llm config:", e);
}

const openai = new OpenAI({
    baseURL: llmConfig.baseUrl,
    apiKey: llmConfig.apiKey,
    timeout: llmConfig.timeout
});

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

export async function chat(messages: LLMMessage[]): Promise<string> {
    try {
        const completion = await openai.chat.completions.create({
            model: llmConfig.model,
            messages: messages,
            stream: false
        });
        const responseContent = completion.choices[0]?.message?.content || "";
        console.log(`[LLM Chat] Model: ${llmConfig.model} | Completion successful`);
        return responseContent;
    } catch (err: any) {
        console.error("[LLM Chat Error]", err);
        if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed') || err.cause?.code === 'ECONNREFUSED') {
            throw new Error('LLM_UNAVAILABLE: Ollama tidak berjalan di ' + llmConfig.baseUrl);
        }
        if (err.status === 404) {
            throw new Error('LLM_MODEL_NOT_FOUND: Model ' + llmConfig.model + ' belum di-pull di Ollama');
        }
        throw new Error('LLM_ERROR: ' + err.message);
    }
}

export async function chatStream(options: LLMStreamOptions): Promise<void> {
    try {
        const stream = await openai.chat.completions.create({
            model: llmConfig.model,
            messages: options.messages,
            stream: true
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                options.onChunk(content);
            }
        }
        console.log(`[LLM ChatStream] Model: ${llmConfig.model} | Stream completed`);
        options.onDone();
    } catch (err: any) {
        console.error("[LLM ChatStream Error]", err);
        let errorToReport = err;
        if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed') || err.cause?.code === 'ECONNREFUSED') {
            errorToReport = new Error('LLM_UNAVAILABLE: Ollama tidak berjalan di ' + llmConfig.baseUrl);
        } else if (err.status === 404) {
            errorToReport = new Error('LLM_MODEL_NOT_FOUND: Model ' + llmConfig.model + ' belum di-pull di Ollama');
        } else {
            errorToReport = new Error('LLM_ERROR: ' + err.message);
        }
        options.onError(errorToReport);
    }
}
