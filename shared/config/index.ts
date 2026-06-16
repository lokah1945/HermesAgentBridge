import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const configSchema = z.object({
  profile: z.string().default("ILMA"),
  server: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.number().int().default(3000),
    editable: z.boolean().default(true)
  }),
  agent: z.object({
    default_mode: z.enum(["auto", "review"]).default("review"),
    stream: z.boolean().default(true),
    session_ttl_minutes: z.number().int().default(60)
  }),
  auth: z.object({
    enabled: z.boolean().default(false),
    strategy: z.string().default("none"),
    future_pluggable: z.boolean().default(true)
  }),
  multiUser: z.object({
    enabled: z.boolean().default(false),
    future_multitenant: z.boolean().default(true)
  }),
  localMode: z.boolean().default(true),
  tools: z.object({
    filesystem: z.boolean().default(true),
    terminal: z.boolean().default(true),
    git: z.boolean().default(true),
    search: z.boolean().default(true)
  }),
  llm: z.object({
    baseUrl: z.string().default("http://localhost:11434/v1"),
    apiKey: z.string().default("ollama"),
    model: z.string().default("llama3.2"),
    timeout: z.number().int().default(60000)
  })
});

export type HermesConfig = z.infer<typeof configSchema>;

function loadConfig(): HermesConfig {
  const possiblePaths = [
    path.join(__dirname, '../../config/hermes.config.json'),
    path.join(__dirname, '../config/hermes.config.json'),
    path.join(process.cwd(), 'config/hermes.config.json'),
    path.join(process.cwd(), '../config/hermes.config.json')
  ];

  let rawConfig: any = {};
  let found = false;

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      try {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        rawConfig = JSON.parse(fileContent);
        found = true;
        break;
      } catch (err: any) {
        throw new Error(`Failed to parse config file at ${configPath}: ${err.message}`);
      }
    }
  }

  if (!found) {
    console.warn("[Hermes] Warning: hermes.config.json not found, using default configurations.");
  }

  // Apply environment variable overrides
  if (process.env.HERMES_PORT) {
    rawConfig.server = rawConfig.server || {};
    rawConfig.server.port = parseInt(process.env.HERMES_PORT, 10);
  }
  if (process.env.HERMES_HOST) {
    rawConfig.server = rawConfig.server || {};
    rawConfig.server.host = process.env.HERMES_HOST;
  }
  if (process.env.HERMES_MODEL) {
    rawConfig.llm = rawConfig.llm || {};
    rawConfig.llm.model = process.env.HERMES_MODEL;
  }
  if (process.env.HERMES_LLM_BASE_URL) {
    rawConfig.llm = rawConfig.llm || {};
    rawConfig.llm.baseUrl = process.env.HERMES_LLM_BASE_URL;
  }

  const result = configSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new Error(`Configuration validation failed: ${result.error.message}`);
  }

  return result.data;
}

export const config = loadConfig();
