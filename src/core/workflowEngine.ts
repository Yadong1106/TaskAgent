import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Workflow Step Types
 */
export type StepType = 'action' | 'parallel' | 'conditional' | 'loop' | 'human-input' | 'delay';

/**
 * Workflow Step Definition
 */
export interface WorkflowStep {
    id: string;
    name: string;
    type: StepType;
    /** Agent to execute this step (for 'action' type) */
    agent?: string;
    /** Skill to use (optional) */
    skill?: string;
    /** Prompt/instruction for this step */
    prompt?: string;
    /** Tool to invoke */
    tool?: string;
    /** Tool parameters (can reference previous outputs via ${stepId.output}) */
    params?: Record<string, any>;
    /** Condition expression (for 'conditional' type) */
    condition?: string;
    /** Steps to run if condition is true */
    thenSteps?: WorkflowStep[];
    /** Steps to run if condition is false */
    elseSteps?: WorkflowStep[];
    /** Steps to run in parallel (for 'parallel' type) */
    parallelSteps?: WorkflowStep[];
    /** Max iterations (for 'loop' type) */
    maxIterations?: number;
    /** Loop condition (for 'loop' type) */
    loopCondition?: string;
    /** Loop body steps */
    loopSteps?: WorkflowStep[];
    /** Delay in ms (for 'delay' type) */
    delayMs?: number;
    /** Question for human (for 'human-input' type) */
    question?: string;
    /** Step dependencies (step IDs that must complete first) */
    dependsOn?: string[];
    /** Transform output before passing to next step */
    outputTransform?: string;
}

/**
 * Workflow Definition
 */
export interface WorkflowDefinition {
    id: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    /** Input parameters the workflow accepts */
    inputs?: { name: string; description: string; required: boolean; default?: any }[];
    /** Workflow steps */
    steps: WorkflowStep[];
    /** Tags for discovery */
    tags?: string[];
}

/**
 * Step Execution Result
 */
export interface StepResult {
    stepId: string;
    status: 'completed' | 'failed' | 'skipped';
    output: any;
    duration: number;
    error?: string;
}

/**
 * Workflow Execution State
 */
export interface WorkflowExecution {
    id: string;
    workflowId: string;
    workflowName: string;
    status: 'running' | 'completed' | 'failed' | 'paused';
    inputs: Record<string, any>;
    stepResults: Map<string, StepResult>;
    currentStepId?: string;
    startTime: number;
    endTime?: number;
    error?: string;
}

/**
 * WorkflowEngine - JSON-based workflow DSL engine
 * 
 * Supports:
 * - Sequential step execution
 * - Parallel execution
 * - Conditional branching
 * - Loops with conditions
 * - Human-in-the-loop input
 * - Variable interpolation between steps
 * - Built-in workflow templates
 * - Save/load from workspace
 */
export class WorkflowEngine {
    private workflows: Map<string, WorkflowDefinition> = new Map();
    private executions: Map<string, WorkflowExecution> = new Map();
    private workflowsDir: string = '';
    private _onExecutionUpdate = new vscode.EventEmitter<WorkflowExecution>();
    readonly onExecutionUpdate = this._onExecutionUpdate.event;

    /** External step executor - set by extension.ts to wire into orchestrator */
    public stepExecutor?: (step: WorkflowStep, context: Record<string, any>) => Promise<any>;

    constructor() {
        this.registerBuiltinWorkflows();
    }

    /**
     * Initialize workflows directory
     */
    initializeWorkflowsDir(workspaceRoot?: string) {
        if (workspaceRoot) {
            this.workflowsDir = path.join(workspaceRoot, '.taskagent', 'workflows');
            if (!fs.existsSync(this.workflowsDir)) {
                fs.mkdirSync(this.workflowsDir, { recursive: true });
            }
            this.loadWorkflowsFromDisk();
        }
    }

    // ===== Built-in Workflows =====

    private registerBuiltinWorkflows() {
        this.registerWorkflow({
            id: 'pr-review-pipeline',
            name: 'PR Review Pipeline',
            description: 'Multi-perspective pull request review workflow',
            version: '1.0.0',
            inputs: [
                { name: 'files', description: 'Files or folder to review', required: true },
                { name: 'focus', description: 'Focus areas (security, performance, etc.)', required: false, default: 'all' }
            ],
            steps: [
                {
                    id: 'scan-code',
                    name: 'Scan Code Structure',
                    type: 'action',
                    agent: 'developer',
                    prompt: 'Analyze the code structure and identify key components in: ${inputs.files}'
                },
                {
                    id: 'parallel-review',
                    name: 'Multi-Perspective Review',
                    type: 'parallel',
                    dependsOn: ['scan-code'],
                    parallelSteps: [
                        {
                            id: 'security-check',
                            name: 'Security Review',
                            type: 'action',
                            agent: 'security',
                            prompt: 'Review security aspects: ${scan-code.output}'
                        },
                        {
                            id: 'code-quality',
                            name: 'Code Quality Review',
                            type: 'action',
                            agent: 'codereview',
                            prompt: 'Review code quality: ${scan-code.output}'
                        },
                        {
                            id: 'architecture-review',
                            name: 'Architecture Review',
                            type: 'action',
                            agent: 'developer',
                            prompt: 'Review architecture and design patterns: ${scan-code.output}'
                        }
                    ]
                },
                {
                    id: 'consolidate',
                    name: 'Consolidate Reviews',
                    type: 'action',
                    agent: 'document',
                    dependsOn: ['parallel-review'],
                    prompt: 'Consolidate all review findings into a single report:\nSecurity: ${security-check.output}\nQuality: ${code-quality.output}\nArchitecture: ${architecture-review.output}'
                }
            ],
            tags: ['review', 'pr', 'pipeline']
        });

        this.registerWorkflow({
            id: 'bug-triage',
            name: 'Bug Triage Pipeline',
            description: 'Systematic bug analysis, classification, and fix suggestion',
            version: '1.0.0',
            inputs: [
                { name: 'description', description: 'Bug description or error message', required: true },
                { name: 'files', description: 'Related files', required: false }
            ],
            steps: [
                {
                    id: 'search-code',
                    name: 'Search Related Code',
                    type: 'action',
                    agent: 'search',
                    prompt: 'Search for code related to this bug: ${inputs.description}'
                },
                {
                    id: 'analyze-bug',
                    name: 'Analyze Root Cause',
                    type: 'action',
                    agent: 'developer',
                    dependsOn: ['search-code'],
                    prompt: 'Analyze the root cause of the bug based on search results:\nBug: ${inputs.description}\nRelated code: ${search-code.output}'
                },
                {
                    id: 'suggest-fix',
                    name: 'Suggest Fix',
                    type: 'action',
                    agent: 'developer',
                    dependsOn: ['analyze-bug'],
                    prompt: 'Suggest a fix for the bug:\nAnalysis: ${analyze-bug.output}'
                },
                {
                    id: 'generate-test',
                    name: 'Generate Regression Test',
                    type: 'action',
                    agent: 'developer',
                    dependsOn: ['suggest-fix'],
                    prompt: 'Generate a regression test for this bug fix:\nFix: ${suggest-fix.output}'
                }
            ],
            tags: ['bug', 'triage', 'debug']
        });

        this.registerWorkflow({
            id: 'research-report',
            name: 'Research Report Generator',
            description: 'Research a topic and generate a structured report',
            version: '1.0.0',
            inputs: [
                { name: 'topic', description: 'Research topic', required: true },
                { name: 'depth', description: 'Research depth (quick/standard/deep)', required: false, default: 'standard' }
            ],
            steps: [
                {
                    id: 'web-research',
                    name: 'Web Research',
                    type: 'action',
                    agent: 'search',
                    prompt: 'Research the topic thoroughly: ${inputs.topic}'
                },
                {
                    id: 'code-examples',
                    name: 'Find Code Examples',
                    type: 'action',
                    agent: 'search',
                    prompt: 'Find relevant code examples and implementations for: ${inputs.topic}'
                },
                {
                    id: 'compile-report',
                    name: 'Compile Report',
                    type: 'action',
                    agent: 'document',
                    dependsOn: ['web-research', 'code-examples'],
                    prompt: 'Compile a comprehensive research report:\nTopic: ${inputs.topic}\nResearch: ${web-research.output}\nCode Examples: ${code-examples.output}'
                }
            ],
            tags: ['research', 'report']
        });
    }

    // ===== Workflow CRUD =====

    registerWorkflow(workflow: WorkflowDefinition) {
        this.workflows.set(workflow.id, workflow);
    }

    getWorkflow(id: string): WorkflowDefinition | undefined {
        return this.workflows.get(id);
    }

    getAllWorkflows(): WorkflowDefinition[] {
        return Array.from(this.workflows.values());
    }

    removeWorkflow(id: string) {
        this.workflows.delete(id);
    }

    findWorkflowsByTag(tag: string): WorkflowDefinition[] {
        return this.getAllWorkflows().filter(w => w.tags?.includes(tag));
    }

    // ===== Workflow Execution =====

    /**
     * Execute a workflow with given inputs
     */
    async executeWorkflow(workflowId: string, inputs: Record<string, any> = {}): Promise<WorkflowExecution> {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

        // Validate required inputs
        for (const input of workflow.inputs || []) {
            if (input.required && !(input.name in inputs)) {
                if (input.default !== undefined) {
                    inputs[input.name] = input.default;
                } else {
                    throw new Error(`Missing required input: ${input.name}`);
                }
            }
        }

        const execution: WorkflowExecution = {
            id: `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            workflowId,
            workflowName: workflow.name,
            status: 'running',
            inputs,
            stepResults: new Map(),
            startTime: Date.now()
        };

        this.executions.set(execution.id, execution);
        this._onExecutionUpdate.fire(execution);

        try {
            await this.executeSteps(execution, workflow.steps, inputs);
            execution.status = 'completed';
        } catch (error: any) {
            execution.status = 'failed';
            execution.error = error.message || String(error);
        }

        execution.endTime = Date.now();
        this._onExecutionUpdate.fire(execution);
        return execution;
    }

    /**
     * Execute a list of steps sequentially (respecting dependencies)
     */
    private async executeSteps(
        execution: WorkflowExecution,
        steps: WorkflowStep[],
        context: Record<string, any>
    ): Promise<void> {
        // Build full context including step outputs
        const buildContext = (): Record<string, any> => {
            const ctx: Record<string, any> = { inputs: context };
            for (const [stepId, result] of execution.stepResults) {
                ctx[stepId] = { output: result.output };
            }
            return ctx;
        };

        for (const step of steps) {
            // Check dependencies
            if (step.dependsOn) {
                for (const dep of step.dependsOn) {
                    const depResult = execution.stepResults.get(dep);
                    if (!depResult || depResult.status === 'failed') {
                        execution.stepResults.set(step.id, {
                            stepId: step.id,
                            status: 'skipped',
                            output: null,
                            duration: 0,
                            error: `Dependency ${dep} not met`
                        });
                        continue;
                    }
                }
            }

            execution.currentStepId = step.id;
            this._onExecutionUpdate.fire(execution);

            const startTime = Date.now();

            try {
                const result = await this.executeStep(execution, step, buildContext());
                execution.stepResults.set(step.id, {
                    stepId: step.id,
                    status: 'completed',
                    output: result,
                    duration: Date.now() - startTime
                });
            } catch (error: any) {
                execution.stepResults.set(step.id, {
                    stepId: step.id,
                    status: 'failed',
                    output: null,
                    duration: Date.now() - startTime,
                    error: error.message || String(error)
                });
                throw error; // Propagate to stop workflow
            }
        }
    }

    /**
     * Execute a single step based on its type
     */
    private async executeStep(
        execution: WorkflowExecution,
        step: WorkflowStep,
        context: Record<string, any>
    ): Promise<any> {
        switch (step.type) {
            case 'action':
                return this.executeActionStep(step, context);

            case 'parallel':
                return this.executeParallelStep(execution, step, context);

            case 'conditional':
                return this.executeConditionalStep(execution, step, context);

            case 'loop':
                return this.executeLoopStep(execution, step, context);

            case 'human-input':
                return this.executeHumanInputStep(step);

            case 'delay':
                await new Promise(resolve => setTimeout(resolve, step.delayMs || 1000));
                return { delayed: step.delayMs };

            default:
                throw new Error(`Unknown step type: ${step.type}`);
        }
    }

    private async executeActionStep(step: WorkflowStep, context: Record<string, any>): Promise<any> {
        const prompt = this.interpolate(step.prompt || '', context);

        if (this.stepExecutor) {
            return this.stepExecutor({ ...step, prompt }, context);
        }

        // Fallback: return prompt as-is (for testing)
        return { agent: step.agent, prompt, note: 'No step executor configured' };
    }

    private async executeParallelStep(
        execution: WorkflowExecution,
        step: WorkflowStep,
        context: Record<string, any>
    ): Promise<any> {
        const parallelSteps = step.parallelSteps || [];
        const results = await Promise.allSettled(
            parallelSteps.map(async (subStep) => {
                const startTime = Date.now();
                try {
                    const result = await this.executeStep(execution, subStep, context);
                    execution.stepResults.set(subStep.id, {
                        stepId: subStep.id,
                        status: 'completed',
                        output: result,
                        duration: Date.now() - startTime
                    });
                    return result;
                } catch (error: any) {
                    execution.stepResults.set(subStep.id, {
                        stepId: subStep.id,
                        status: 'failed',
                        output: null,
                        duration: Date.now() - startTime,
                        error: error.message
                    });
                    throw error;
                }
            })
        );

        return results.map((r, i) => ({
            step: parallelSteps[i].id,
            status: r.status,
            value: r.status === 'fulfilled' ? r.value : (r as PromiseRejectedResult).reason
        }));
    }

    private async executeConditionalStep(
        execution: WorkflowExecution,
        step: WorkflowStep,
        context: Record<string, any>
    ): Promise<any> {
        const conditionStr = this.interpolate(step.condition || 'true', context);
        let conditionResult = false;
        try {
            // Simple condition evaluation (safe subset)
            conditionResult = this.evaluateCondition(conditionStr, context);
        } catch {
            conditionResult = false;
        }

        const branchSteps = conditionResult ? (step.thenSteps || []) : (step.elseSteps || []);
        if (branchSteps.length > 0) {
            await this.executeSteps(execution, branchSteps, context);
        }
        return { condition: conditionStr, result: conditionResult };
    }

    private async executeLoopStep(
        execution: WorkflowExecution,
        step: WorkflowStep,
        context: Record<string, any>
    ): Promise<any> {
        const maxIterations = step.maxIterations || 10;
        const results: any[] = [];

        for (let i = 0; i < maxIterations; i++) {
            // Check loop condition
            if (step.loopCondition) {
                const condStr = this.interpolate(step.loopCondition, { ...context, iteration: i });
                if (!this.evaluateCondition(condStr, context)) break;
            }

            const loopContext = { ...context, iteration: i };
            if (step.loopSteps) {
                await this.executeSteps(execution, step.loopSteps, loopContext);
            }
            results.push({ iteration: i });
        }

        return results;
    }

    private async executeHumanInputStep(step: WorkflowStep): Promise<any> {
        const answer = await vscode.window.showInputBox({
            prompt: step.question || 'Workflow needs your input:',
            placeHolder: 'Type your response...'
        });
        return { input: answer || '' };
    }

    // ===== Template Interpolation =====

    /**
     * Interpolate ${variable} references in a string
     */
    private interpolate(template: string, context: Record<string, any>): string {
        return template.replace(/\$\{([^}]+)\}/g, (_, expr) => {
            try {
                const parts = expr.trim().split('.');
                let value: any = context;
                for (const part of parts) {
                    value = value?.[part];
                }
                return value !== undefined ? String(value) : `\${${expr}}`;
            } catch {
                return `\${${expr}}`;
            }
        });
    }

    /**
     * Simple condition evaluator (safe)
     */
    private evaluateCondition(condition: string, _context: Record<string, any>): boolean {
        const trimmed = condition.trim().toLowerCase();
        if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
        if (trimmed === 'false' || trimmed === '0' || trimmed === 'no' || trimmed === '') return false;
        // Default true for non-empty
        return trimmed.length > 0;
    }

    // ===== Disk Operations =====

    /**
     * Save a workflow to disk
     */
    saveWorkflow(workflow: WorkflowDefinition) {
        if (!this.workflowsDir) return;
        const filePath = path.join(this.workflowsDir, `${workflow.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));
    }

    /**
     * Load workflows from disk
     */
    loadWorkflowsFromDisk() {
        if (!this.workflowsDir || !fs.existsSync(this.workflowsDir)) return;

        const files = fs.readdirSync(this.workflowsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(this.workflowsDir, file), 'utf-8');
                const workflow = JSON.parse(content) as WorkflowDefinition;
                this.registerWorkflow(workflow);
            } catch (error) {
                console.error(`Failed to load workflow ${file}:`, error);
            }
        }
    }

    // ===== Execution Info =====

    getExecution(id: string): WorkflowExecution | undefined {
        return this.executions.get(id);
    }

    getAllExecutions(): WorkflowExecution[] {
        return Array.from(this.executions.values());
    }

    getActiveExecutions(): WorkflowExecution[] {
        return this.getAllExecutions().filter(e => e.status === 'running' || e.status === 'paused');
    }

    // ===== Summary =====

    getWorkflowsSummary(): string {
        const workflows = this.getAllWorkflows();
        if (workflows.length === 0) return 'No workflows registered.';

        return workflows.map(w => {
            const inputs = w.inputs?.map(i => `${i.name}${i.required ? '*' : ''}`).join(', ') || 'none';
            const tags = w.tags?.length ? ` [${w.tags.join(', ')}]` : '';
            return `📋 **${w.name}** (${w.id}) v${w.version}${tags}\n   ${w.description}\n   Inputs: ${inputs} | Steps: ${w.steps.length}`;
        }).join('\n\n');
    }

    getExecutionSummary(executionId: string): string {
        const exec = this.executions.get(executionId);
        if (!exec) return 'Execution not found.';

        const duration = exec.endTime ? ((exec.endTime - exec.startTime) / 1000).toFixed(1) : 'running';
        const stepSummaries = Array.from(exec.stepResults.entries()).map(([id, r]) => {
            const icon = r.status === 'completed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
            return `  ${icon} ${id}: ${r.status} (${(r.duration / 1000).toFixed(1)}s)`;
        });

        return `Workflow: ${exec.workflowName}\nStatus: ${exec.status}\nDuration: ${duration}s\n\nSteps:\n${stepSummaries.join('\n')}`;
    }
}
