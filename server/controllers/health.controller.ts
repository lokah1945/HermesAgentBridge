import { Request, Response } from 'express';
import { gitStatus } from '../../tools/git';
import { config } from '../../shared/config';
import { llmService } from '../services/llm.service';

export const stats = {
  requestCount: 0,
  errorCount: 0,
  totalLatencyMs: 0,
  averageLatencyMs: 0
};

export class HealthController {
  public async getHealth(req: Request, res: Response): Promise<void> {
    const status: any = {
      server: 'ok',
      version: '1.0.0',
      profile: config.profile,
      uptime: Math.floor(process.uptime()),
      llm: { status: 'unknown', model: config.llm.model, baseUrl: config.llm.baseUrl }
    };

    try {
      const response = await fetch(`${config.llm.baseUrl.replace('/v1', '')}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      status.llm.status = response.ok ? 'ok' : 'degraded';
    } catch {
      status.llm.status = 'unavailable';
    }

    const httpStatus = status.llm.status === 'ok' ? 200 : 207;
    res.status(httpStatus).json(status);
  }

  public getWorkspaceContext(req: Request, res: Response): void {
    const workspace = req.body.workspace || process.cwd();
    gitStatus(workspace).then(gitStatusRes => {
      res.json({
        files: [],
        symbols: [],
        dependencies: { imports: [], exports: [] },
        git_status: gitStatusRes.success ? gitStatusRes.output : "Error fetching git status"
      });
    });
  }

  public handleResponsePlaceholder(req: Request, res: Response): void {
    res.json({ success: true });
  }

  public getStats(req: Request, res: Response): void {
    const uptime = Math.floor(process.uptime());
    res.json({
      uptime_seconds: uptime,
      request_count: stats.requestCount,
      error_count: stats.errorCount,
      average_latency_ms: stats.averageLatencyMs,
      llm_circuit_state: llmService.getCircuitState()
    });
  }
}

export const healthController = new HealthController();
