import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const configPath = path.join(__dirname, '../../config/hermes.config.json');
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
    } catch (error: any) {
        console.error("[LLM Chat Error]", error);
        throw error;
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
    } catch (error: any) {
        console.error("[LLM ChatStream Error]", error);
        options.onError(error);
    }
}
