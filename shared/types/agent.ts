export interface WorkspaceContext {
    root: string;
    files?: string[];
    symbols?: string[];
    dependencies?: { imports: string[]; exports: string[] };
    git_status?: string;
}

export interface AgentStep {
    id: string;
    action: 'read_file' | 'write_file' | 'run_command' | 'search' | 'explain';
    target: string;
    description: string;
    mode: 'auto' | 'review';
}

export interface AgentPlan {
    goal: string;
    steps: AgentStep[];
}

export interface Diff {
    before: string;
    after: string;
    file: string;
    unified?: string;
}

export interface ExecutionResult {
    stepId: string;
    status: 'success' | 'error' | 'pending_approval';
    output?: string;
    diff?: Diff;
    error?: string;
}
