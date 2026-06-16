import express from 'express';
import { logger } from '../../shared/logger';

class SSEService {
  private sseConnections: Record<string, express.Response> = {};

  public register(sessionId: string, res: express.Response): void {
    this.sseConnections[sessionId] = res;
    logger.info(`[SSE] Client connected to session stream: ${sessionId}`);
  }

  public unregister(sessionId: string, res: express.Response): void {
    if (this.sseConnections[sessionId] === res) {
      delete this.sseConnections[sessionId];
      logger.info(`[SSE] Client disconnected from session stream: ${sessionId}`);
    }
  }

  public send(sessionId: string, event: string, data: any): void {
    const res = this.sseConnections[sessionId];
    if (res) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } else {
      logger.debug(`[SSE] Failed to send event "${event}" to session "${sessionId}" - no connection found`);
    }
  }
}

export const sseService = new SSEService();
