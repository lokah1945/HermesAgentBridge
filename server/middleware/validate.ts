export function requireFields(...fields: string[]) {
  return (req: any, res: any, next: any) => {
    const missing = fields.filter(f => !req.body?.[f]);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'MISSING_FIELDS', fields: missing });
    }
    next();
  };
}
