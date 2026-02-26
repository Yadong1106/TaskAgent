import * as vscode from 'vscode';
import { TaskManager, Task, SubTask } from './taskManager';
import { AgentRegistry, AgentConfig } from './agentRegistry';
import { AgentBus } from './agentBus';
import { UsageTracker } from './usageTracker';
import { McpBridge } from './mcpBridge';

export interface WorkflowStep {
    id: string;
    agentId: string;
    action: string;
    input: any;
    dependsOn: string[];  // IDs of steps this depends on
}

export interface Workflow {
    id: string;
    name: string;
    steps: WorkflowStep[];
}

export interface TaskDecomposition {
    mainGoal: string;
    subtasks: {
        description: string;
        agentId: string;
        priority: number;
        dependencies: number[];  // indices of dependent subtasks
    }[];
}

// ===== Hierarchical Agent Types =====

/** Delegation action emitted by the supervisor agent */
export interface DelegationAction {
    type: 'delegate';
    agentId: string;
    task: string;
    context?: string;
    /** If set, the supervisor expects this sub-agent to produce a specific kind of output */
    expectedOutput?: string;
}

/** Synthesis / final answer action emitted by the supervisor */
export interface SynthesisAction {
    type: 'synthesize';
    summary: string;
}

/** Revision action — supervisor asks a sub-agent to revise its output */
export interface RevisionAction {
    type: 'revise';
    agentId: string;
    feedback: string;
    originalOutput: string;
}

export type SupervisorAction = DelegationAction | SynthesisAction | RevisionAction;

/** Result returned by a sub-agent execution */
export interface SubAgentResult {
    agentId: string;
    agentName: string;
    task: string;
    output: string;
    success: boolean;
    duration: number;
    /** Nested sub-agent calls (if the sub-agent itself delegated) */
    children?: SubAgentResult[];
}

/** Full result of a hierarchical execution */
export interface HierarchicalResult {
    goal: string;
    supervisorThoughts: string[];
    delegations: SubAgentResult[];
    finalSynthesis: string;
    totalRounds: number;
}

/**
 * Orchestrator - Task decomposition and multi-agent coordination engine
 * 
 * Supports two execution modes:
 * 1. **Parallel** (existing) — Pre-plan all subtasks, execute in parallel respecting deps
 * 2. **Hierarchical** (new) — Supervisor agent thinks step-by-step, dynamically delegates
 *    to sub-agents at runtime, reviews results, can ask for revisions, and synthesizes
 *    a final answer. Sub-agents can recursively delegate to their own sub-agents.
 */
export class Orchestrator {
    private mcpBridge: McpBridge;
    private agentBus?: AgentBus;

    constructor(
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry,
        private usageTracker?: UsageTracker
    ) {
        this.mcpBridge = new McpBridge();
    }

    /** Inject AgentBus for inter-agent communication during hierarchical execution */
    setAgentBus(bus: AgentBus) {
        this.agentBus = bus;
    }

    /**
     * Use LLM to decompose complex tasks into subtasks
     */
    async decomposeTask(
        userRequest: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<TaskDecomposition> {
        const agents = this.agentRegistry.getEnabledAgents();
        const agentDescriptions = agents.map(a => `- ${a.id}: ${a.description} [tools: ${a.tools.join(', ')}]`).join('\n');

        // Discover external MCP tools
        const externalToolDesc = await this.mcpBridge.buildToolDescription();

        const prompt = [
            vscode.LanguageModelChatMessage.User(`You are a task orchestrator. Your job is to break down complex tasks into subtasks and assign them to the appropriate agents.

Available agents:
${agentDescriptions}
${externalToolDesc}
User's request: "${userRequest}"

Analyze this request and break it down into subtasks. For each subtask, specify:
1. A clear description of what needs to be done
2. Which agent should handle it (use agent ID)
3. Priority (1-10, higher = more important)
4. Dependencies (which other subtasks must complete first)

Respond in this exact JSON format:
{
    "mainGoal": "summary of the main goal",
    "subtasks": [
        {
            "description": "what this subtask does",
            "agentId": "agent_id",
            "priority": 8,
            "dependencies": []
        }
    ]
}

Only output valid JSON, no other text.`)
        ];

        try {
            const decomposeStart = Date.now();
            const response = await model.sendRequest(prompt, {}, token);
            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
            }

            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: 'orchestrator:decompose',
                purpose: 'Task decomposition',
                inputText: userRequest,
                outputText: fullResponse,
                duration: Date.now() - decomposeStart,
                success: true
            });

            // Parse JSON from response
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as TaskDecomposition;
                
                // Validate and fix dependencies
                const maxIndex = parsed.subtasks.length - 1;
                parsed.subtasks.forEach((subtask, index) => {
                    // Remove invalid dependencies (out of range or self-reference)
                    subtask.dependencies = subtask.dependencies.filter(dep => 
                        dep >= 0 && dep <= maxIndex && dep !== index
                    );
                    
                    // Detect circular dependencies - simple check
                    // If A depends on B and B depends on A, remove one
                    subtask.dependencies = subtask.dependencies.filter(dep => {
                        const depSubtask = parsed.subtasks[dep];
                        return !depSubtask.dependencies.includes(index);
                    });
                });
                
                return parsed;
            }
            
            // Fallback: single task to developer agent
            return {
                mainGoal: userRequest,
                subtasks: [{
                    description: userRequest,
                    agentId: 'developer',
                    priority: 5,
                    dependencies: []
                }]
            };
        } catch (error) {
            console.error('Task decomposition failed:', error);
            return {
                mainGoal: userRequest,
                subtasks: [{
                    description: userRequest,
                    agentId: 'developer',
                    priority: 5,
                    dependencies: []
                }]
            };
        }
    }

    /**
     * Execute decomposed task
     */
    async executeDecomposedTask(
        task: Task,
        decomposition: TaskDecomposition,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const results: Map<number, any> = new Map();
        const subtaskStatus: Map<number, 'pending' | 'running' | 'completed' | 'failed'> = new Map();
        
        // Initialize all subtasks as pending
        decomposition.subtasks.forEach((_, index) => {
            subtaskStatus.set(index, 'pending');
        });

        this.taskManager.updateTaskStatus(task.id, 'running', 0);
        stream.progress(`Starting task: ${decomposition.mainGoal}`);

        // Process subtasks respecting dependencies
        while (this.hasRemainingSubtasks(subtaskStatus)) {
            if (token.isCancellationRequested) {
                throw new Error('Task cancelled');
            }

            // Find subtasks that can run (dependencies satisfied)
            const runnableIndices = this.findRunnableSubtasks(decomposition, subtaskStatus);
            
            if (runnableIndices.length === 0) {
                // Debug: Log current status
                const statusSummary = Array.from(subtaskStatus.entries())
                    .map(([idx, status]) => `Task ${idx}: ${status}`)
                    .join(', ');
                console.log(`[Orchestrator] No runnable tasks. Status: ${statusSummary}`);
                
                // Check if all remaining pending tasks have unmet dependencies that are still running
                const pendingWithRunningDeps = decomposition.subtasks.some((subtask, index) => {
                    if (subtaskStatus.get(index) !== 'pending') return false;
                    return subtask.dependencies.some(dep => subtaskStatus.get(dep) === 'running');
                });
                
                if (pendingWithRunningDeps) {
                    // This shouldn't happen in parallel execution, but if it does, wait
                    console.log('[Orchestrator] Waiting for running tasks to complete...');
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }
                
                // Check if there are still viable subtasks (not blocked by failed dependencies)
                if (this.hasRemainingSubtasks(subtaskStatus) && !this.hasViableSubtasks(decomposition, subtaskStatus)) {
                    // All remaining tasks are blocked by failed dependencies - not a deadlock, just cascade failure
                    stream.markdown('\n⚠️ **Remaining subtasks skipped due to dependency failures**\n');
                    break;
                } else if (this.hasRemainingSubtasks(subtaskStatus)) {
                    // Log more details for debugging
                    const pendingTasks = decomposition.subtasks
                        .map((st, i) => ({ index: i, ...st, status: subtaskStatus.get(i) }))
                        .filter(st => st.status === 'pending');
                    
                    console.error('[Orchestrator] Deadlock details:', JSON.stringify(pendingTasks, null, 2));
                    
                    // Instead of throwing, try to run the first pending task anyway
                    if (pendingTasks.length > 0) {
                        stream.markdown(`\n⚠️ **Dependency issue detected, forcing execution of remaining tasks**\n`);
                        // Force-add the first pending task
                        const forcedTask = pendingTasks[0];
                        subtaskStatus.set(forcedTask.index, 'pending');
                        // Clear its dependencies
                        decomposition.subtasks[forcedTask.index].dependencies = [];
                        continue;
                    }
                    
                    throw new Error('Deadlock detected: no runnable subtasks but task not complete');
                }
                break;
            }

            // Run subtasks in parallel (like Eigent's parallel execution)
            stream.progress(`Running ${runnableIndices.length} subtask(s) in parallel...`);
            
            const parallelPromises = runnableIndices.map(async (index) => {
                const subtask = decomposition.subtasks[index];
                subtaskStatus.set(index, 'running');
                
                try {
                    const result = await this.executeSubtask(
                        task,
                        index,
                        subtask,
                        results,
                        model,
                        stream,
                        token
                    );
                    results.set(index, result);
                    subtaskStatus.set(index, 'completed');
                    return { index, success: true, result };
                } catch (error) {
                    subtaskStatus.set(index, 'failed');
                    return { index, success: false, error };
                }
            });

            const parallelResults = await Promise.all(parallelPromises);
            
            // Update progress
            const completed = Array.from(subtaskStatus.values()).filter(s => s === 'completed').length;
            const progress = Math.round((completed / decomposition.subtasks.length) * 100);
            this.taskManager.updateTaskStatus(task.id, 'running', progress);

            // Check for failures
            const failures = parallelResults.filter(r => !r.success);
            if (failures.length > 0) {
                stream.markdown(`\n⚠️ ${failures.length} subtask(s) failed\n`);
            }
        }

        // Aggregate results
        const finalResult = this.aggregateResults(decomposition, results);
        this.taskManager.completeTask(task.id, finalResult);
    }

    private hasRemainingSubtasks(status: Map<number, string>): boolean {
        return Array.from(status.values()).some(s => s === 'pending' || s === 'running');
    }

    /**
     * Check if there are any subtasks that can still potentially run
     * (dependencies are resolved - either completed or failed)
     */
    private hasViableSubtasks(
        decomposition: TaskDecomposition,
        status: Map<number, string>
    ): boolean {
        return decomposition.subtasks.some((subtask, index) => {
            if (status.get(index) !== 'pending') return false;
            
            // Check if all dependencies are resolved (completed or failed)
            const depsResolved = subtask.dependencies.every(depIndex => {
                const depStatus = status.get(depIndex);
                return depStatus === 'completed' || depStatus === 'failed';
            });
            
            return depsResolved;
        });
    }

    private findRunnableSubtasks(
        decomposition: TaskDecomposition,
        status: Map<number, string>
    ): number[] {
        const runnable: number[] = [];
        
        decomposition.subtasks.forEach((subtask, index) => {
            if (status.get(index) !== 'pending') return;
            
            // Check if all dependencies are satisfied (completed OR failed)
            // We still run tasks even if dependencies failed - they may still provide value
            const depsResolved = subtask.dependencies.every(
                depIndex => {
                    const depStatus = status.get(depIndex);
                    return depStatus === 'completed' || depStatus === 'failed';
                }
            );
            
            if (depsResolved) {
                runnable.push(index);
            }
        });

        // Sort by priority (higher first)
        runnable.sort((a, b) => 
            decomposition.subtasks[b].priority - decomposition.subtasks[a].priority
        );

        return runnable;
    }

    private async executeSubtask(
        parentTask: Task,
        index: number,
        subtask: TaskDecomposition['subtasks'][0],
        previousResults: Map<number, any>,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<any> {
        const agent = this.agentRegistry.getAgent(subtask.agentId);
        if (!agent) {
            throw new Error(`Agent ${subtask.agentId} not found`);
        }

        // Create subtask in task manager
        const managedSubtask = this.taskManager.addSubtask(
            parentTask.id,
            subtask.agentId,
            subtask.description,
            { previousResults: Object.fromEntries(previousResults) }
        );

        stream.markdown(`\n### 🤖 ${agent.name}\n`);
        stream.markdown(`*${subtask.description}*\n\n`);

        this.taskManager.updateSubtaskStatus(parentTask.id, managedSubtask.id, 'running');

        try {
            // Build context from dependent results
            let context = '';
            if (subtask.dependencies.length > 0) {
                context = '\n\nContext from previous steps:\n';
                subtask.dependencies.forEach(depIdx => {
                    const result = previousResults.get(depIdx);
                    if (result) {
                        context += `- Step ${depIdx + 1} result: ${JSON.stringify(result).slice(0, 500)}...\n`;
                    }
                });
            }

            // Find relevant tools for this agent + task (including MCP tools)
            const relevantTools = await this.mcpBridge.findToolsForAgent(subtask.agentId, subtask.description);
            const hasTools = relevantTools.length > 0;

            const toolInstruction = hasTools
                ? `You have tools available. Use them when needed to complete the task. If no tool is needed, just respond with your analysis directly.`
                : `Analyze and provide your response based on the context provided.`;

            const messages = [
                vscode.LanguageModelChatMessage.User(agent.systemPrompt),
                vscode.LanguageModelChatMessage.User(`Task: ${subtask.description}${context}\n\n${toolInstruction}`)
            ];

            const requestOptions: vscode.LanguageModelChatRequestOptions = hasTools
                ? { tools: relevantTools }
                : {};

            const subtaskStart = Date.now();
            let result = '';

            // May need multiple rounds if LLM calls tools
            let currentMessages = [...messages];
            const maxToolRounds = 5;

            for (let round = 0; round <= maxToolRounds; round++) {
                const response = await model.sendRequest(currentMessages, requestOptions, token);
                let hasToolCall = false;

                for await (const part of response.stream) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        result += part.value;
                        stream.markdown(part.value);
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        hasToolCall = true;
                        stream.markdown(`\n🔧 *Calling tool: ${part.name}...*\n`);

                        try {
                            const toolResult = await vscode.lm.invokeTool(part.name, {
                                input: part.input,
                                toolInvocationToken: undefined
                            }, token);

                            // Extract text from tool result
                            let toolOutput = '';
                            if (toolResult && (toolResult as any).content) {
                                for (const content of (toolResult as any).content) {
                                    if (content.value) toolOutput += content.value;
                                }
                            } else {
                                toolOutput = String(toolResult);
                            }

                            result += `\n[Tool ${part.name} result]: ${toolOutput.slice(0, 500)}\n`;
                            stream.markdown(`\n> **${part.name}** returned ${toolOutput.length} chars\n\n`);

                            // Add tool result to conversation for next round
                            currentMessages.push(
                                vscode.LanguageModelChatMessage.User(
                                    `Tool ${part.name} returned:\n${toolOutput.slice(0, 2000)}`
                                )
                            );
                        } catch (toolError) {
                            const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
                            stream.markdown(`\n⚠️ Tool ${part.name} failed: ${errMsg}\n`);
                            currentMessages.push(
                                vscode.LanguageModelChatMessage.User(`Tool ${part.name} failed: ${errMsg}`)
                            );
                        }
                    }
                }

                // If no tool was called, we're done
                if (!hasToolCall) break;
            }

            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: `orchestrator:agent:${subtask.agentId}`,
                purpose: `Subtask: ${subtask.description.slice(0, 80)}`,
                inputText: subtask.description + (context || ''),
                outputText: result,
                duration: Date.now() - subtaskStart,
                success: true
            });

            this.taskManager.updateSubtaskStatus(parentTask.id, managedSubtask.id, 'completed', result);
            return result;

        } catch (error) {
            this.taskManager.updateSubtaskStatus(parentTask.id, managedSubtask.id, 'failed');
            throw error;
        }
    }

    private aggregateResults(
        decomposition: TaskDecomposition,
        results: Map<number, any>
    ): any {
        return {
            goal: decomposition.mainGoal,
            subtaskResults: decomposition.subtasks.map((subtask, index) => ({
                description: subtask.description,
                agentId: subtask.agentId,
                result: results.get(index) ?? 'No result'
            }))
        };
    }

    // =================================================================
    //  HIERARCHICAL EXECUTION — Main Agent + Sub-Agent Architecture
    // =================================================================

    /**
     * Execute a task using hierarchical (supervisor) mode.
     *
     * Flow:
     * 1. Supervisor agent receives the user's goal
     * 2. Supervisor thinks step-by-step, emits DelegationActions
     * 3. Each delegation spawns a sub-agent that executes and returns
     * 4. Supervisor reviews the sub-agent result, may:
     *    - Delegate more work
     *    - Ask for revision (RevisionAction)
     *    - Synthesize the final answer (SynthesisAction)
     * 5. Recursive: sub-agents can also delegate (up to maxDepth)
     */
    async executeHierarchical(
        task: Task,
        userGoal: string,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
        options?: {
            supervisorAgentId?: string;
            maxRounds?: number;
            maxDepth?: number;
        }
    ): Promise<HierarchicalResult> {
        const maxRounds = options?.maxRounds ?? 8;
        const maxDepth = options?.maxDepth ?? 3;
        const supervisorId = options?.supervisorAgentId ?? 'developer';

        const supervisorAgent = this.agentRegistry.getAgent(supervisorId) 
            ?? this.agentRegistry.getAgent('developer')!;

        const agents = this.agentRegistry.getEnabledAgents();
        const agentList = agents.map(a => `- **${a.id}**: ${a.description}`).join('\n');

        this.taskManager.updateTaskStatus(task.id, 'running', 0);

        stream.markdown('## 🧠 Hierarchical Agent Execution\n\n');
        stream.markdown(`**Supervisor:** ${supervisorAgent.name}\n\n`);
        stream.markdown(`**Goal:** ${userGoal}\n\n`);
        stream.markdown('---\n\n');

        const result: HierarchicalResult = {
            goal: userGoal,
            supervisorThoughts: [],
            delegations: [],
            finalSynthesis: '',
            totalRounds: 0
        };

        // Conversation history for the supervisor
        const supervisorHistory: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.User(this.buildSupervisorSystemPrompt(supervisorAgent, agentList))
        ];

        // Initial user goal
        supervisorHistory.push(
            vscode.LanguageModelChatMessage.User(`User's goal:\n${userGoal}\n\nThink about how to approach this. What steps do you need? Which agents should handle each part? Respond with your plan and first action.`)
        );

        for (let round = 1; round <= maxRounds; round++) {
            if (token.isCancellationRequested) break;

            result.totalRounds = round;
            const progress = Math.round((round / maxRounds) * 100);
            this.taskManager.updateTaskStatus(task.id, 'running', progress);

            stream.markdown(`### 🔄 Round ${round}/${maxRounds}\n\n`);
            stream.progress(`Supervisor thinking (round ${round})...`);

            // Ask supervisor to think & decide
            const supervisorStart = Date.now();
            const supervisorResponse = await model.sendRequest(supervisorHistory, {}, token);
            let supervisorText = '';
            for await (const chunk of supervisorResponse.text) {
                supervisorText += chunk;
            }

            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: 'orchestrator:supervisor',
                purpose: `Supervisor round ${round}`,
                inputText: userGoal.slice(0, 200),
                outputText: supervisorText.slice(0, 200),
                duration: Date.now() - supervisorStart,
                success: true
            });

            // Parse supervisor actions from response
            const actions = this.parseSupervisorActions(supervisorText);

            // Show supervisor's thinking (text outside actions)
            const thoughtText = this.extractThoughts(supervisorText);
            if (thoughtText) {
                result.supervisorThoughts.push(thoughtText);
                stream.markdown(`**💭 Supervisor:**\n${thoughtText}\n\n`);
            }

            // If supervisor emits SYNTHESIZE — we're done
            const synthesis = actions.find((a): a is SynthesisAction => a.type === 'synthesize');
            if (synthesis) {
                result.finalSynthesis = synthesis.summary;
                stream.markdown(`### ✅ Final Synthesis\n\n${synthesis.summary}\n`);
                // Add assistant message to history
                supervisorHistory.push(vscode.LanguageModelChatMessage.Assistant(supervisorText));
                break;
            }

            // Process delegation actions (can run in parallel within a round)
            const delegations = actions.filter((a): a is DelegationAction => a.type === 'delegate');
            const revisions = actions.filter((a): a is RevisionAction => a.type === 'revise');

            if (delegations.length === 0 && revisions.length === 0) {
                // No structured actions — treat the whole response as the final synthesis
                result.finalSynthesis = supervisorText;
                stream.markdown(`*(Supervisor provided direct answer — no delegation needed)*\n\n`);
                supervisorHistory.push(vscode.LanguageModelChatMessage.Assistant(supervisorText));
                break;
            }

            // Execute delegations
            const delegationResults: SubAgentResult[] = [];
            
            if (delegations.length > 0) {
                stream.markdown(`**📋 Delegating ${delegations.length} task(s)...**\n\n`);

                const delegationPromises = delegations.map(async (delegation) => {
                    return this.executeSubAgent(
                        task, delegation.agentId, delegation.task,
                        delegation.context || '', model, stream, token,
                        1, maxDepth
                    );
                });

                const results = await Promise.all(delegationPromises);
                delegationResults.push(...results);
                result.delegations.push(...results);
            }

            // Execute revisions
            if (revisions.length > 0) {
                stream.markdown(`**🔄 Requesting ${revisions.length} revision(s)...**\n\n`);

                for (const revision of revisions) {
                    const revResult = await this.executeSubAgent(
                        task, revision.agentId,
                        `Revise your previous output based on this feedback:\n\nFeedback: ${revision.feedback}\n\nOriginal output:\n${revision.originalOutput.slice(0, 2000)}`,
                        '', model, stream, token, 1, maxDepth
                    );
                    delegationResults.push(revResult);
                    result.delegations.push(revResult);
                }
            }

            // Feed results back to supervisor
            supervisorHistory.push(vscode.LanguageModelChatMessage.Assistant(supervisorText));

            const resultsSummary = delegationResults.map(r =>
                `### Sub-Agent: ${r.agentName} (${r.agentId})\n**Task:** ${r.task}\n**Status:** ${r.success ? '✅ Success' : '❌ Failed'}\n**Output:**\n${r.output.slice(0, 3000)}\n`
            ).join('\n---\n');

            supervisorHistory.push(
                vscode.LanguageModelChatMessage.User(
                    `Sub-agent results:\n\n${resultsSummary}\n\nReview these results. You can:\n1. DELEGATE more tasks if needed\n2. REVISE a sub-agent's output if not satisfactory\n3. SYNTHESIZE a final answer if all work is complete\n\nWhat's your next action?`
                )
            );

            // Broadcast progress via AgentBus
            this.agentBus?.broadcast('supervisor', `round-${round}-complete`, {
                round,
                delegations: delegationResults.length,
                success: delegationResults.filter(r => r.success).length
            });
        }

        // If we exhausted rounds without synthesis, generate one
        if (!result.finalSynthesis) {
            stream.markdown('\n⚠️ Max rounds reached. Generating final synthesis...\n\n');
            result.finalSynthesis = await this.generateForcedSynthesis(
                userGoal, result.delegations, model, token
            );
            stream.markdown(`### 📝 Final Synthesis\n\n${result.finalSynthesis}\n`);
        }

        this.taskManager.completeTask(task.id, result);

        stream.markdown(`\n---\n\n📊 **Stats:** ${result.totalRounds} round(s), ${result.delegations.length} delegation(s)\n`);

        return result;
    }

    /**
     * Execute a single sub-agent with its tools, supporting recursive delegation.
     */
    private async executeSubAgent(
        parentTask: Task,
        agentId: string,
        taskDescription: string,
        context: string,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
        currentDepth: number,
        maxDepth: number
    ): Promise<SubAgentResult> {
        const agent = this.agentRegistry.getAgent(agentId);
        if (!agent) {
            return {
                agentId,
                agentName: agentId,
                task: taskDescription,
                output: `Agent "${agentId}" not found. Available: ${this.agentRegistry.getEnabledAgents().map(a => a.id).join(', ')}`,
                success: false,
                duration: 0
            };
        }

        const startTime = Date.now();
        stream.markdown(`\n#### 🤖 ${agent.name} (depth: ${currentDepth})\n`);
        stream.markdown(`*${taskDescription.slice(0, 150)}${taskDescription.length > 150 ? '...' : ''}*\n\n`);

        // Log delegation via AgentBus
        this.agentBus?.sendMessage('supervisor', agentId, 'delegation', {
            task: taskDescription,
            depth: currentDepth
        }, 'delegate');

        // Track in TaskManager
        const managedSubtask = this.taskManager.addSubtask(
            parentTask.id, agentId, taskDescription,
            { depth: currentDepth, context }
        );
        this.taskManager.updateSubtaskStatus(parentTask.id, managedSubtask.id, 'running');

        try {
            // Find relevant tools
            const relevantTools = await this.mcpBridge.findToolsForAgent(agentId, taskDescription);
            const hasTools = relevantTools.length > 0;

            // Build agent prompt
            const canDelegate = currentDepth < maxDepth;
            const delegateInstruction = canDelegate
                ? `\n\nYou may delegate sub-tasks to other agents using DELEGATE blocks if needed. Available agents:\n${this.agentRegistry.getEnabledAgents().map(a => `- ${a.id}: ${a.description}`).join('\n')}\n\nFormat: <<<DELEGATE agentId: task description>>>`
                : '';

            const messages = [
                vscode.LanguageModelChatMessage.User(agent.systemPrompt),
                vscode.LanguageModelChatMessage.User(
                    `Task: ${taskDescription}` +
                    (context ? `\n\nContext:\n${context}` : '') +
                    delegateInstruction +
                    `\n\nComplete this task thoroughly. Use tools if available.`
                )
            ];

            const requestOptions: vscode.LanguageModelChatRequestOptions = hasTools
                ? { tools: relevantTools }
                : {};

            // Execute with tool loop
            let output = '';
            let currentMessages = [...messages];
            const maxToolRounds = 5;
            const childResults: SubAgentResult[] = [];

            for (let toolRound = 0; toolRound <= maxToolRounds; toolRound++) {
                const response = await model.sendRequest(currentMessages, requestOptions, token);
                let hasToolCall = false;

                for await (const part of response.stream) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        output += part.value;
                        stream.markdown(part.value);
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        hasToolCall = true;
                        stream.markdown(`\n🔧 *${part.name}...*\n`);

                        try {
                            const toolResult = await vscode.lm.invokeTool(part.name, {
                                input: part.input,
                                toolInvocationToken: undefined
                            }, token);

                            let toolOutput = '';
                            if (toolResult && (toolResult as any).content) {
                                for (const content of (toolResult as any).content) {
                                    if (content.value) toolOutput += content.value;
                                }
                            } else {
                                toolOutput = String(toolResult);
                            }

                            output += `\n[Tool ${part.name}]: ${toolOutput.slice(0, 500)}\n`;
                            stream.markdown(`\n> **${part.name}** → ${toolOutput.length} chars\n\n`);

                            currentMessages.push(
                                vscode.LanguageModelChatMessage.User(`Tool ${part.name} returned:\n${toolOutput.slice(0, 2000)}`)
                            );
                        } catch (toolError) {
                            const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
                            stream.markdown(`\n⚠️ ${part.name} failed: ${errMsg}\n`);
                            currentMessages.push(
                                vscode.LanguageModelChatMessage.User(`Tool ${part.name} failed: ${errMsg}`)
                            );
                        }
                    }
                }

                if (!hasToolCall) break;
            }

            // Check if sub-agent wants to delegate further (recursive)
            if (canDelegate) {
                const nestedDelegations = this.parseNestedDelegations(output);
                if (nestedDelegations.length > 0) {
                    stream.markdown(`\n📎 *${agent.name} is delegating ${nestedDelegations.length} sub-task(s)...*\n`);
                    
                    for (const nested of nestedDelegations) {
                        const childResult = await this.executeSubAgent(
                            parentTask, nested.agentId, nested.task,
                            output.slice(0, 1000), model, stream, token,
                            currentDepth + 1, maxDepth
                        );
                        childResults.push(childResult);
                        output += `\n\n[Sub-agent ${childResult.agentName}]: ${childResult.output.slice(0, 1000)}`;
                    }
                }
            }

            const duration = Date.now() - startTime;

            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: `orchestrator:subagent:${agentId}`,
                purpose: `SubAgent: ${taskDescription.slice(0, 80)}`,
                inputText: taskDescription,
                outputText: output.slice(0, 200),
                duration,
                success: true
            });

            // Notify completion via AgentBus
            this.agentBus?.sendMessage(agentId, 'supervisor', 'task-complete', {
                task: taskDescription,
                outputLength: output.length,
                duration
            }, 'response');

            this.taskManager.updateSubtaskStatus(parentTask.id, managedSubtask.id, 'completed', output);

            return {
                agentId,
                agentName: agent.name,
                task: taskDescription,
                output,
                success: true,
                duration,
                children: childResults.length > 0 ? childResults : undefined
            };

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.taskManager.updateSubtaskStatus(parentTask.id, managedSubtask.id, 'failed');

            return {
                agentId,
                agentName: agent.name,
                task: taskDescription,
                output: `Error: ${errMsg}`,
                success: false,
                duration: Date.now() - startTime
            };
        }
    }

    // ===== Supervisor Prompt =====

    private buildSupervisorSystemPrompt(supervisor: AgentConfig, agentList: string): string {
        return `You are a **Supervisor Agent** (${supervisor.name}). Your role is to:
1. Understand the user's goal
2. Break it down into concrete steps
3. Delegate each step to the most appropriate sub-agent
4. Review sub-agent results and decide next steps
5. Synthesize a final comprehensive answer

## Available Sub-Agents
${agentList}

## Action Format
Use these structured blocks in your response to direct actions:

### To delegate a task to a sub-agent:
\`\`\`
<<<DELEGATE agentId>>>
Task description that the sub-agent should complete.
Optional context or constraints.
<<<END_DELEGATE>>>
\`\`\`

### To request a revision from a sub-agent:
\`\`\`
<<<REVISE agentId>>>
Feedback on what needs to be improved.
===ORIGINAL===
The original output to revise (or a summary).
<<<END_REVISE>>>
\`\`\`

### To provide the final synthesized answer:
\`\`\`
<<<SYNTHESIZE>>>
Your comprehensive final answer combining all sub-agent results.
<<<END_SYNTHESIZE>>>
\`\`\`

## Guidelines
- Think step-by-step about what needs to be done
- Delegate to specialized agents rather than doing everything yourself
- You can delegate to multiple agents in one round (they run in parallel)
- Review sub-agent results carefully — request revisions if quality is insufficient
- When all work is complete, SYNTHESIZE a final answer
- Be efficient — don't over-delegate simple tasks
- Explain your reasoning before each action`;
    }

    // ===== Parsing Supervisor Actions =====

    private parseSupervisorActions(text: string): SupervisorAction[] {
        const actions: SupervisorAction[] = [];

        // Parse DELEGATE blocks
        const delegateRegex = /<<<DELEGATE\s+(\w+)>>>\s*([\s\S]*?)<<<END_DELEGATE>>>/g;
        let match;
        while ((match = delegateRegex.exec(text)) !== null) {
            actions.push({
                type: 'delegate',
                agentId: match[1].trim(),
                task: match[2].trim()
            });
        }

        // Parse REVISE blocks
        const reviseRegex = /<<<REVISE\s+(\w+)>>>\s*([\s\S]*?)===ORIGINAL===\s*([\s\S]*?)<<<END_REVISE>>>/g;
        while ((match = reviseRegex.exec(text)) !== null) {
            actions.push({
                type: 'revise',
                agentId: match[1].trim(),
                feedback: match[2].trim(),
                originalOutput: match[3].trim()
            });
        }

        // Parse SYNTHESIZE block
        const synthesizeRegex = /<<<SYNTHESIZE>>>\s*([\s\S]*?)<<<END_SYNTHESIZE>>>/;
        const synthMatch = text.match(synthesizeRegex);
        if (synthMatch) {
            actions.push({
                type: 'synthesize',
                summary: synthMatch[1].trim()
            });
        }

        return actions;
    }

    /** Extract the "thinking" text that's outside structured action blocks */
    private extractThoughts(text: string): string {
        return text
            .replace(/<<<DELEGATE\s+\w+>>>[\s\S]*?<<<END_DELEGATE>>>/g, '')
            .replace(/<<<REVISE\s+\w+>>>[\s\S]*?<<<END_REVISE>>>/g, '')
            .replace(/<<<SYNTHESIZE>>>[\s\S]*?<<<END_SYNTHESIZE>>>/g, '')
            .trim();
    }

    /** Parse nested <<<DELEGATE>>> blocks from sub-agent output */
    private parseNestedDelegations(output: string): DelegationAction[] {
        const actions: DelegationAction[] = [];
        const regex = /<<<DELEGATE\s+(\w+)(?::\s*(.*?))?>>>/g;
        let match;
        while ((match = regex.exec(output)) !== null) {
            actions.push({
                type: 'delegate',
                agentId: match[1].trim(),
                task: match[2]?.trim() || ''
            });
        }
        return actions;
    }

    /** Generate a synthesis when max rounds are exhausted */
    private async generateForcedSynthesis(
        goal: string,
        delegations: SubAgentResult[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<string> {
        const resultsSummary = delegations.map(r =>
            `- ${r.agentName}: ${r.task.slice(0, 100)} → ${r.success ? 'Success' : 'Failed'}: ${r.output.slice(0, 300)}`
        ).join('\n');

        const messages = [
            vscode.LanguageModelChatMessage.User(
                `Synthesize a final comprehensive answer for the user's goal.\n\nGoal: ${goal}\n\nSub-agent results:\n${resultsSummary}\n\nProvide a clear, well-structured summary.`
            )
        ];

        const response = await model.sendRequest(messages, {}, token);
        let synthesis = '';
        for await (const chunk of response.text) {
            synthesis += chunk;
        }
        return synthesis;
    }
}














