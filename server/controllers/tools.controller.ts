import { Request, Response } from 'express';
import { getSession } from '../session-store';
import { executeCommand } from '../../tools/terminal';
import { gitStatus, gitCommit } from '../../tools/git';
import { searchWorkspace } from '../../tools/search';
import { logger } from '../../shared/logger';

export class ToolsController {
  public async executeTool(req: Request, res: Response): Promise<void> {
    const { tool, action, params, session_id } = req.body;
    const session = getSession(session_id);
    const workspace = session?.workspace?.root || session?.workspace || process.cwd();

    if (tool === 'terminal') {
      if (!params || !params.command) {
        res.status(400).json({ error: "Missing parameter 'command'" });
        return;
      }
      const result = await executeCommand(workspace, params.command);
      res.json(result);
    } else if (tool === 'git') {
      if (action === 'status') {
        const result = await gitStatus(workspace);
        res.json(result);
      } else if (action === 'commit') {
        if (!params || !params.message) {
          res.status(400).json({ error: "Missing parameter 'message'" });
          return;
        }
        const result = await gitCommit(workspace, params.message);
        res.json(result);
      } else {
        res.status(400).json({ error: 'Git action not supported' });
      }
    } else if (tool === 'search') {
      if (!params || !params.query) {
        res.status(400).json({ error: "Missing parameter 'query'" });
        return;
      }
      const result = await searchWorkspace(workspace, params.query);
      res.json(result);
    } else {
      res.status(400).json({ error: 'Tool not supported' });
    }
  }
}

export const toolsController = new ToolsController();
