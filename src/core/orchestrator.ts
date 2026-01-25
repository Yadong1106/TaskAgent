import * as vscode from 'vscode';
import { TaskManager, Task, SubTask } from './taskManager';
import { AgentRegistry, AgentConfig } from './agentRegistry';

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

/**
 * Orchestrator - Task decomposition and multi-agent coordination engine
 * This is the core of TaskAgent, similar to Eigent's Workforce orchestration logic
 */
export class Orchestrator {
    constructor(
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry
    ) {}

    /**
     * Use LLM to decompose complex tasks into subtasks
     */
    async decomposeTask(
        userRequest: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<TaskDecomposition> {
        const agents = this.agentRegistry.getEnabledAgents();
        const agentDescriptions = agents.map(a => `- ${a.id}: ${a.description}`).join('\n');

        const prompt = [
            vscode.LanguageModelChatMessage.User(`You are a task orchestrator. Your job is to break down complex tasks into subtasks and assign them to the appropriate agents.

Available agents:
${agentDescriptions}

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
            const response = await model.sendRequest(prompt, {}, token);
            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
            }

            // Parse JSON from response
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as TaskDecomposition;
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
                // Check if there are still viable subtasks (not blocked by failed dependencies)
                if (this.hasRemainingSubtasks(subtaskStatus) && !this.hasViableSubtasks(decomposition, subtaskStatus)) {
                    // All remaining tasks are blocked by failed dependencies - not a deadlock, just cascade failure
                    stream.markdown('\n⚠️ **Remaining subtasks skipped due to dependency failures**\n');
                    break;
                } else if (this.hasRemainingSubtasks(subtaskStatus)) {
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
     * (not blocked by failed dependencies)
     */
    private hasViableSubtasks(
        decomposition: TaskDecomposition,
        status: Map<number, string>
    ): boolean {
        return decomposition.subtasks.some((subtask, index) => {
            if (status.get(index) !== 'pending') return false;
            
            // Check if any dependency has failed - if so, this subtask is not viable
            const hasFailedDependency = subtask.dependencies.some(
                depIndex => status.get(depIndex) === 'failed'
            );
            
            return !hasFailedDependency;
        });
    }

    private findRunnableSubtasks(
        decomposition: TaskDecomposition,
        status: Map<number, string>
    ): number[] {
        const runnable: number[] = [];
        
        decomposition.subtasks.forEach((subtask, index) => {
            if (status.get(index) !== 'pending') return;
            
            // Check if any dependency has failed - skip this subtask if so
            const hasFailedDependency = subtask.dependencies.some(
                depIndex => status.get(depIndex) === 'failed'
            );
            if (hasFailedDependency) {
                // Mark as failed due to dependency failure
                status.set(index, 'failed');
                return;
            }
            
            // Check if all dependencies are completed
            const depsCompleted = subtask.dependencies.every(
                depIndex => status.get(depIndex) === 'completed'
            );
            
            if (depsCompleted) {
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

            // Execute with agent's system prompt
            const messages = [
                vscode.LanguageModelChatMessage.User(agent.systemPrompt),
                vscode.LanguageModelChatMessage.User(`Task: ${subtask.description}${context}\n\nProvide your response and results.`)
            ];

            const response = await model.sendRequest(messages, {}, token);
            let result = '';
            for await (const chunk of response.text) {
                result += chunk;
                stream.markdown(chunk);
            }

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
}














