import express from 'express';
import cors from 'cors';
import { config } from '../shared/config';
import { logger } from '../shared/logger';
import requestLogger from './middleware/requestLogger';
import errorHandler from './middleware/errorHandler';

import sessionRouter from './routes/session';
import chatRouter from './routes/chat';
import agentRouter from './routes/agent';
import filesRouter from './routes/files';
import toolsRouter from './routes/tools';
import healthRouter from './routes/health';

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Mount Modular Routes
app.use('/v1/session', sessionRouter);
app.use('/v1/chat', chatRouter);
app.use('/v1/agent', agentRouter);
app.use('/v1/files', filesRouter);
app.use('/v1/tools', toolsRouter);
app.use('/v1', healthRouter); // For /v1/workspace/context and /v1/responses
app.use('/', healthRouter); // For /health and /stats

// Global Error Handler Middleware
app.use(errorHandler);

const host = config.server.host;
const port = config.server.port;

const server = app.listen(port, host, () => {
  logger.info(`[Hermes] ● Server running at http://${host}:${port}`);
  logger.info(`[Hermes] Profile: ${config.profile} | LLM Model: ${config.llm.model}`);
});

const shutdown = (signal: string) => {
  logger.info(`[Hermes] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    logger.info('[Hermes] Server stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
