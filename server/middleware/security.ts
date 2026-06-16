import { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, { count: number; resetTime: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 100;

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = requestCounts.get(ip);
  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return next();
  }
  record.count++;
  if (record.count > MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too Many Requests', retryAfter: Math.ceil((record.resetTime - now) / 1000) });
  }
  next();
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

export function corsHardening(req: Request, res: Response, next: NextFunction) {
  const allowedOrigin = process.env.HERMES_CORS_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
