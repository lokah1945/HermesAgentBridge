import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: result.error.issues.map((err: any) => ({
          path: err.path.join('.'),
          message: err.message
        }))
      });
    }
    req.body = result.data;
    next();
  };
}

export function requireFields(...fields: string[]) {
  return (req: any, res: any, next: any) => {
    const missing = fields.filter(f => !req.body?.[f]);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'MISSING_FIELDS', fields: missing });
    }
    next();
  };
}
