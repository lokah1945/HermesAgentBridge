import { Request, Response, NextFunction } from 'express';
import { logger } from '../../shared/logger';
import { stats } from '../controllers/health.controller';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  stats.errorCount++;
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(`Unhandled Express Error: ${message}`, err, {
    method: req.method,
    url: req.originalUrl,
    body: req.body
  });

  res.status(status).json({
    error: {
      message,
      code: err.code || 'INTERNAL_SERVER_ERROR',
      status
    }
  });
}

export default errorHandler;
