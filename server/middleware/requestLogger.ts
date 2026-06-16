import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import { stats } from '../controllers/health.controller';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  logger.info(`Incoming Request: ${method} ${originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;

    // Update statistics metrics
    stats.requestCount++;
    stats.totalLatencyMs += duration;
    stats.averageLatencyMs = Math.round(stats.totalLatencyMs / stats.requestCount);

    if (status >= 400) {
      stats.errorCount++;
      logger.warn(`Request Finished with Error: ${method} ${originalUrl} | status: ${status} | duration: ${duration}ms`);
    } else {
      logger.info(`Request Finished: ${method} ${originalUrl} | status: ${status} | duration: ${duration}ms`);
    }
  });

  next();
}
export default requestLogger;
