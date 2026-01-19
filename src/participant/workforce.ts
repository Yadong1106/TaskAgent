import * as vscode from 'vscode';
import { TaskManager } from '../core/taskManager';
import { AgentRegistry } from '../core/agentRegistry';
import { Orchestrator } from '../core/orchestrator';
import { BackendServer } from '../server/backendServer';

/**
 * WorkforceParticipant - Main Chat Participant entry point
 * Handles all @workforce interactions
 */
export class WorkforceParticipant {
    private orchestrator: Orchestrator;

    constructor(
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry,
        private backendServer: BackendServer
    ) {
        this.orchestrator = new Orchestrator(taskManager, agentRegistry);
    }

    async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const userPrompt = request.prompt;
        const command = request.command;

        try {
            // Handle specific commands
            if (command === 'research') {
                return await this.handleResearch(userPrompt, request, stream, token);
            } else if (command === 'code') {
                return await this.handleCode(userPrompt, request, stream, token);
            } else if (command === 'automate') {
                return await this.handleAutomate(userPrompt, request, stream, token);
            }

            // Default: auto-detect and orchestrate
            return await this.handleGeneral(userPrompt, request, stream, token);

        } catch (error) {
            stream.markdown(`\n\n❌ **Error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { metadata: { command: command || 'general', error: true } };
        }
    }

    private async handleGeneral(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const model = request.model;

        stream.markdown('## 🤖 TaskAgent Workforce\n\n');
        stream.progress('Analyzing your request...');

        // Create a new task
        const task = this.taskManager.createTask(prompt.slice(0, 50) + '...');
        
        // Decompose the task
        stream.progress('Breaking down the task...');
        const decomposition = await this.orchestrator.decomposeTask(prompt, model, token);

        stream.markdown(`**Goal:** ${decomposition.mainGoal}\n\n`);
        stream.markdown(`**Subtasks:** ${decomposition.subtasks.length}\n\n`);
        
        // Show planned subtasks
        stream.markdown('### 📋 Execution Plan\n\n');
        decomposition.subtasks.forEach((subtask, index) => {
            const agent = this.agentRegistry.getAgent(subtask.agentId);
            const deps = subtask.dependencies.length > 0 
                ? ` (depends on: ${subtask.dependencies.map(d => d + 1).join(', ')})` 
                : '';
            stream.markdown(`${index + 1}. **${agent?.name || subtask.agentId}**: ${subtask.description}${deps}\n`);
        });
        stream.markdown('\n---\n\n');

        // Execute the decomposed task
        await this.orchestrator.executeDecomposedTask(task, decomposition, model, stream, token);

        stream.markdown('\n\n---\n\n✅ **Task completed!**\n');

        return { 
            metadata: { 
                command: 'general',
                taskId: task.id
            } 
        };
    }

    private async handleResearch(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.markdown('## 🔍 Research Mode\n\n');
        
        // For research, we prioritize search agent
        const task = this.taskManager.createTask(`Research: ${prompt.slice(0, 30)}...`);
        
        const decomposition = {
            mainGoal: `Research: ${prompt}`,
            subtasks: [
                {
                    description: `Search the web for information about: ${prompt}`,
                    agentId: 'search',
                    priority: 10,
                    dependencies: []
                },
                {
                    description: 'Analyze and summarize the search results',
                    agentId: 'search',
                    priority: 8,
                    dependencies: [0]
                },
                {
                    description: 'Generate a structured research report',
                    agentId: 'document',
                    priority: 6,
                    dependencies: [1]
                }
            ]
        };

        await this.orchestrator.executeDecomposedTask(task, decomposition, request.model, stream, token);

        return { metadata: { command: 'research', taskId: task.id } };
    }

    private async handleCode(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.markdown('## 💻 Code Mode\n\n');
        
        const task = this.taskManager.createTask(`Code: ${prompt.slice(0, 30)}...`);
        
        // Use developer agent primarily
        const decomposition = await this.orchestrator.decomposeTask(
            `As a developer, ${prompt}`,
            request.model,
            token
        );

        // Ensure developer agent is primary
        decomposition.subtasks = decomposition.subtasks.map(st => ({
            ...st,
            agentId: st.agentId === 'developer' ? 'developer' : st.agentId
        }));

        await this.orchestrator.executeDecomposedTask(task, decomposition, request.model, stream, token);

        return { metadata: { command: 'code', taskId: task.id } };
    }

    private async handleAutomate(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.markdown('## ⚡ Automation Mode\n\n');
        stream.markdown('*This mode enables complex multi-step automation...*\n\n');
        
        const task = this.taskManager.createTask(`Automate: ${prompt.slice(0, 30)}...`);
        
        // Full orchestration with all available agents
        const decomposition = await this.orchestrator.decomposeTask(prompt, request.model, token);

        stream.markdown('### 🔄 Workflow\n\n');
        stream.markdown('```mermaid\n');
        stream.markdown('graph TD\n');
        decomposition.subtasks.forEach((st, i) => {
            stream.markdown(`    S${i}["${st.agentId}: ${st.description.slice(0, 30)}..."]\n`);
            st.dependencies.forEach(dep => {
                stream.markdown(`    S${dep} --> S${i}\n`);
            });
        });
        stream.markdown('```\n\n');

        await this.orchestrator.executeDecomposedTask(task, decomposition, request.model, stream, token);

        return { metadata: { command: 'automate', taskId: task.id } };
    }
}














