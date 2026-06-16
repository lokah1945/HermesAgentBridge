import { Request, Response } from 'express';
import { readFile, writeFile } from '../../tools/filesystem';
import { logger } from '../../shared/logger';

export class FilesController {
  public readFile(req: Request, res: Response): void {
    const { path: targetPath, workspace } = req.body;
    const result = readFile(workspace, targetPath);
    if (result.success) {
      res.json({ content: result.content });
    } else {
      logger.warn(`[Files Controller] Failed to read file: ${targetPath}. Error: ${result.error}`);
      res.status(400).json({ error: result.error });
    }
  }

  public writeFile(req: Request, res: Response): void {
    const { path: targetPath, content, workspace, diff_preview } = req.body;

    if (diff_preview) {
      const existing = readFile(workspace, targetPath);
      const before = existing.success ? (existing.content || "") : "";
      res.json({ success: true, diff: { before, after: content, file: targetPath } });
      return;
    }

    const result = writeFile(workspace, targetPath, content);
    if (result.success) {
      res.json({ success: true });
    } else {
      logger.error(`[Files Controller] Failed to write file: ${targetPath}. Error: ${result.error}`);
      res.status(400).json({ error: result.error });
    }
  }
}

export const filesController = new FilesController();
