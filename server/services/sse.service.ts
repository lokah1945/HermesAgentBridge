import express from 'express';
import { logger } from '../../shared/logger';

class SSEService {
  private sseConnections: Record<string, express.Response> = {};
  private eventHistory: Record<string, Array<{ id: string; event: string; data: any }>> = {};
  private eventCounter: Record<string, number> = {};

  public register(sessionId: string, res: express.Response, lastEventId?: string): void {
    this.sseConnections[sessionId] = res;
    logger.info(`[SSE] Client connected to session stream: ${sessionId}`);

    // If lastEventId is provided, replay missed events
    if (lastEventId) {
      const history = this.eventHistory[sessionId] || [];
      const index = history.findIndex(h => h.id === lastEventId);
      if (index !== -1) {
        const missed = history.slice(index + 1);
        logger.info(`[SSE] Replaying ${missed.length} missed events for session: ${sessionId}`);
        for (const item of missed) {
          res.write(`id: ${item.id}\nevent: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
        }
      }
    }
  }

  public unregister(sessionId: string, res: express.Response): void {
    if (this.sseConnections[sessionId] === res) {
      delete this.sseConnections[sessionId];
      logger.info(`[SSE] Client disconnected from session stream: ${sessionId}`);
    }
  }

  public send(sessionId: string, event: string, data: any): void {
    const res = this.sseConnections[sessionId];
    
    if (!this.eventCounter[sessionId]) {
      this.eventCounter[sessionId] = 0;
    }
    this.eventCounter[sessionId]++;
    const eventId = String(this.eventCounter[sessionId]);

    if (!this.eventHistory[sessionId]) {
      this.eventHistory[sessionId] = [];
    }
    this.eventHistory[sessionId].push({ id: eventId, event, data });
    
    // Limit history size to 100 events to prevent memory leak
    if (this.eventHistory[sessionId].length > 100) {
      this.eventHistory[sessionId].shift();
    }

    if (res) {
      res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } else {
      logger.debug(`[SSE] Failed to send event "${event}" to session "${sessionId}" - no connection found`);
    }
  }
}

export const sseService = new SSEService();
