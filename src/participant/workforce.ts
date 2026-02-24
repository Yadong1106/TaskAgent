import * as vscode from 'vscode';
import { TaskManager } from '../core/taskManager';
import { AgentRegistry } from '../core/agentRegistry';
import { Orchestrator } from '../core/orchestrator';
import { BackendServer } from '../server/backendServer';
import { MemoryModule } from '../core/memory';
import { RolePlayEngine } from '../core/rolePlay';
import { FeedbackCollector } from '../core/feedback';
import { SkillRegistry } from '../core/skillRegistry';
import { AgentBus } from '../core/agentBus';
import { WorkflowEngine } from '../core/workflowEngine';
import { UsageTracker } from '../core/usageTracker';

/**
 * WorkforceParticipant - Main Chat Participant entry point
 * Handles all @taskagent interactions
 */
export class WorkforceParticipant {
    private orchestrator: Orchestrator;

    constructor(
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry,
        private backendServer: BackendServer,
        private memoryModule?: MemoryModule,
        private rolePlayEngine?: RolePlayEngine,
        private feedbackCollector?: FeedbackCollector,
        private skillRegistry?: SkillRegistry,
        private agentBus?: AgentBus,
        private workflowEngine?: WorkflowEngine,
        private usageTracker?: UsageTracker
    ) {
        this.orchestrator = new Orchestrator(taskManager, agentRegistry, usageTracker);
    }

    async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const userPrompt = request.prompt;
        const command = request.command;

        // Record in memory
        this.memoryModule?.addMemory('conversation', userPrompt, {
            context: 'user_request'
        });

        try {
            // Handle specific commands
            if (command === 'research') {
                return await this.handleResearch(userPrompt, request, stream, token);
            } else if (command === 'code') {
                return await this.handleCode(userPrompt, request, stream, token);
            } else if (command === 'automate') {
                return await this.handleAutomate(userPrompt, request, stream, token);
            } else if (command === 'roleplay') {
                return await this.handleRolePlay(userPrompt, request, stream, token);
            } else if (command === 'review') {
                return await this.handleMultiPerspectiveReview(userPrompt, request, stream, token);
            } else if (command === 'ui') {
                return await this.handleUIPreview(userPrompt, request, stream, token);
            } else if (command === 'skills') {
                return await this.handleSkills(userPrompt, stream);
            } else if (command === 'workflow') {
                return await this.handleWorkflow(userPrompt, request, stream, token);
            } else if (command === 'pr') {
                return await this.handlePullRequest(userPrompt, request, stream, token);
            } else if (command === 'test') {
                return await this.handlePlaywrightTest(userPrompt, request, stream, token);
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

    /**
     * Handle security review / scenario analysis directly
     * Extracts scenario name from prompt and invokes the analyzer tool
     */
    private async handleSecurityReview(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.markdown('## 🔒 Security Review Analysis\n\n');
        
        // Extract scenario name from prompt
        const scenarioName = this.extractScenarioName(prompt);
        
        if (!scenarioName) {
            stream.markdown(`⚠️ Could not extract scenario name from your request.\n\n`);
            stream.markdown(`**Usage**: Please specify the scenario name, for example:\n`);
            stream.markdown(`- "analyze scenario GroupSiteManagerEnsureTeamForGroup"\n`);
            stream.markdown(`- "security review for clienttype.EnsureTeam"\n`);
            return { metadata: { command: 'security', error: true } };
        }

        stream.markdown(`**Scenario**: \`${scenarioName}\`\n\n`);
        stream.progress('Analyzing scenario in current file...');

        // Get the tools
        const tools = vscode.lm.tools.filter(tool => tool.name === 'taskagent_analyzeScenario');
        
        if (tools.length === 0) {
            stream.markdown(`❌ Security analyzer tool not available.\n`);
            return { metadata: { command: 'security', error: true } };
        }

        try {
            // Import the ScenarioSecurityAnalyzer and invoke it directly
            const { ScenarioSecurityAnalyzer } = await import('../tools/scenarioSecurityAnalyzer');
            const analyzer = new ScenarioSecurityAnalyzer();
            
            const toolOptions = {
                input: {
                    scenarioName: scenarioName,
                    scenarioDescription: prompt
                },
                toolInvocationToken: undefined
            } as vscode.LanguageModelToolInvocationOptions<{ scenarioName: string; scenarioDescription?: string }>;

            const result = await analyzer.invoke(toolOptions, token);

            // Stream the result
            if (result) {
                for (const part of result.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        stream.markdown(part.value);
                    }
                }
            }

            stream.markdown('\n\n---\n\n✅ **Security review completed!**\n');

            return { metadata: { command: 'security', scenarioName } };

        } catch (error) {
            stream.markdown(`\n\n❌ **Error analyzing scenario:** ${error instanceof Error ? error.message : 'Unknown error'}\n`);
            return { metadata: { command: 'security', error: true } };
        }
    }

    /**
     * Extract scenario name from user prompt
     */
    private extractScenarioName(prompt: string): string | null {
        // Common patterns for scenario names
        const patterns = [
            /(?:analyze|analyse)\s+(?:scenario|the\s+scenario)\s+["']?([A-Za-z0-9_.]+)["']?/i,
            /(?:security\s+review)\s+(?:for\s+)?["']?([A-Za-z0-9_.]+)["']?/i,
            /clienttype[.\s]+([A-Za-z0-9_]+)/i,
            /scenario\s+["']?([A-Za-z0-9_.]+)["']?/i,
            // Camel case names like GroupSiteManagerEnsureTeamForGroup
            /\b([A-Z][a-z]+(?:[A-Z][a-z]+){2,})\b/,
        ];

        for (const pattern of patterns) {
            const match = prompt.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        // Fallback: look for any PascalCase word with 3+ parts
        const pascalMatch = prompt.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+){2,})\b/);
        if (pascalMatch) {
            return pascalMatch[1];
        }

        return null;
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

    /**
     * Handle role-playing sessions
     * Allows multiple AI personas to discuss a topic
     */
    private async handleRolePlay(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.rolePlayEngine) {
            stream.markdown('Role-play engine not available.');
            return { metadata: { command: 'roleplay', error: true } };
        }

        // Parse roles from prompt (format: "topic | role1, role2, role3")
        const parts = prompt.split('|').map(p => p.trim());
        const topic = parts[0];
        const roleNames = parts[1] 
            ? parts[1].split(',').map(r => r.trim().toLowerCase().replace(/\s+/g, '_'))
            : ['security_expert', 'architect', 'developer'];

        // Create and run session
        const session = this.rolePlayEngine.createSession(roleNames, topic, 2);
        await this.rolePlayEngine.runSession(session, request.model, stream, token);

        return { metadata: { command: 'roleplay', sessionId: session.id } };
    }

    /**
     * Handle multi-perspective code review
     * Uses Security Expert, Architect, Developer, and QA perspectives
     */
    private async handleMultiPerspectiveReview(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.rolePlayEngine) {
            stream.markdown('Role-play engine not available.');
            return { metadata: { command: 'review', error: true } };
        }

        // Get the current file content as context
        const editor = vscode.window.activeTextEditor;
        let codeContext = '';
        if (editor) {
            const selection = editor.selection;
            codeContext = selection.isEmpty 
                ? editor.document.getText()
                : editor.document.getText(selection);
        }

        const reviewTopic = codeContext 
            ? `Review this code:\n\`\`\`\n${codeContext.slice(0, 3000)}\n\`\`\`\n\n${prompt}`
            : prompt;

        // Use specialized review roles
        const reviewRoles = ['security_expert', 'architect', 'developer', 'qa_engineer'];
        
        await this.rolePlayEngine.quickAnalysis(
            reviewTopic,
            reviewRoles,
            request.model,
            stream,
            token
        );

        // Generate consolidated recommendations
        stream.markdown('\n---\n\n## 📋 Consolidated Recommendations\n\n');
        
        const summaryPrompt = `Based on the multi-perspective review above, provide:
1. Top 3 priority issues to address
2. Quick wins (easy fixes)
3. Long-term improvements

Be concise and actionable.`;

        const messages = [vscode.LanguageModelChatMessage.User(summaryPrompt)];
        try {
            const startTime = Date.now();
            const response = await request.model.sendRequest(messages, {}, token);
            let fullText = '';
            for await (const chunk of response.text) {
                fullText += chunk;
                stream.markdown(chunk);
            }
            this.usageTracker?.recordCall({
                modelId: request.model.id || 'unknown',
                modelFamily: request.model.family || 'unknown',
                caller: 'workforce:review',
                purpose: 'Consolidated review summary',
                inputText: summaryPrompt,
                outputText: fullText,
                duration: Date.now() - startTime,
                success: true
            });
        } catch (error) {
            stream.markdown(`*Summary generation failed*`);
        }

        return { metadata: { command: 'review' } };
    }

    /**
     * Handle UI development with live preview
     * Creates frontend components and shows them in a preview panel
     */
    private async handleUIPreview(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.markdown('## 🎨 Frontend UI Development\n\n');
        stream.markdown('*Creating UI with live preview...*\n\n');

        // Get the Frontend agent
        const frontendAgent = this.agentRegistry.getAgent('frontend');
        if (!frontendAgent) {
            stream.markdown('❌ Frontend agent not available.');
            return { metadata: { command: 'ui', error: true } };
        }

        // Build the prompt for UI generation
        const uiPrompt = `You are a frontend UI developer. The user wants you to create:

${prompt}

IMPORTANT: After writing the HTML/CSS/JavaScript code, you MUST use the taskagent_previewUI tool to show a live preview.

Steps:
1. Create the HTML structure
2. Add CSS styles
3. Add JavaScript if needed
4. Call taskagent_previewUI with html, css, javascript, and framework parameters

Available frameworks: vanilla, react, vue, tailwind

Now create the UI and show the preview:`;

        const messages = [
            vscode.LanguageModelChatMessage.User(frontendAgent.systemPrompt),
            vscode.LanguageModelChatMessage.User(uiPrompt)
        ];

        // Get the preview tool
        const tools = await vscode.lm.tools;
        const previewTool = tools.filter(t => t.name === 'taskagent_previewUI');

        try {
            const uiStartTime = Date.now();
            const response = await request.model.sendRequest(messages, {
                tools: previewTool.length > 0 ? previewTool : undefined
            }, token);

            let result = '';
            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    result += part.value;
                    stream.markdown(part.value);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    this.usageTracker?.recordCall({
                        modelId: request.model.id || 'unknown',
                        modelFamily: request.model.family || 'unknown',
                        caller: 'workforce:ui',
                        purpose: 'UI component generation',
                        inputText: uiPrompt,
                        outputText: result,
                        duration: Date.now() - uiStartTime,
                        success: true
                    });
                    // Handle the preview tool call
                    stream.markdown(`\n\n📺 **Opening live preview...**\n\n`);
                    try {
                        const toolResult = await vscode.lm.invokeTool(part.name, {
                            input: part.input,
                            toolInvocationToken: undefined
                        }, token);

                        if (toolResult && 'content' in toolResult) {
                            for (const content of toolResult.content as any[]) {
                                if (content.value) {
                                    stream.markdown(`${content.value}\n`);
                                }
                            }
                        }
                    } catch (toolError) {
                        stream.markdown(`\n⚠️ Preview error: ${toolError}\n`);
                    }
                }
            }

            stream.markdown('\n\n---\n\n💡 **Tips:**\n');
            stream.markdown('- Ask me to modify colors, layout, or add features\n');
            stream.markdown('- Say "add a button" or "make it responsive"\n');
            stream.markdown('- Use `/ui` command again to iterate on the design\n');

        } catch (error) {
            stream.markdown(`\n❌ Error: ${error}\n`);
        }

        return { metadata: { command: 'ui' } };
    }

    // ===== Skills Command =====

    private async handleSkills(
        prompt: string,
        stream: vscode.ChatResponseStream
    ): Promise<vscode.ChatResult> {
        if (!this.skillRegistry) {
            stream.markdown('❌ Skills system not initialized.');
            return { metadata: { command: 'skills' } };
        }

        const lower = prompt.toLowerCase().trim();

        if (lower === '' || lower === 'list' || lower === 'show') {
            // List all skills
            stream.markdown('## 🧩 Skills Registry\n\n');
            stream.markdown(this.skillRegistry.getSkillsSummary());
            stream.markdown('\n\n---\n');
            stream.markdown('💡 **Commands:**\n');
            stream.markdown('- `/skills list` - Show all skills\n');
            stream.markdown('- `/skills enable <id>` - Enable a skill\n');
            stream.markdown('- `/skills disable <id>` - Disable a skill\n');
            stream.markdown('- `/skills create <id> <name> <description>` - Create a custom skill\n');
            stream.markdown('- `/skills find <tag>` - Find skills by tag\n');
        } else if (lower.startsWith('enable ')) {
            const id = lower.replace('enable ', '').trim();
            this.skillRegistry.setSkillEnabled(id, true);
            stream.markdown(`✅ Skill **${id}** enabled.`);
        } else if (lower.startsWith('disable ')) {
            const id = lower.replace('disable ', '').trim();
            this.skillRegistry.setSkillEnabled(id, false);
            stream.markdown(`⬜ Skill **${id}** disabled.`);
        } else if (lower.startsWith('create ')) {
            const parts = prompt.replace(/^create\s+/i, '').split(/\s+/);
            const id = parts[0] || 'custom-skill';
            const name = parts[1] || 'Custom Skill';
            const desc = parts.slice(2).join(' ') || 'A custom skill';
            try {
                const skill = await this.skillRegistry.createSkill(id, name, desc);
                stream.markdown(`✅ Created skill **${skill.name}** at \`${skill.sourcePath}\`\n\nEdit SKILL.json or INSTRUCTIONS.md to customize the skill instructions.`);
            } catch (error) {
                stream.markdown(`❌ Error creating skill: ${error}`);
            }
        } else if (lower.startsWith('find ')) {
            const tag = lower.replace('find ', '').trim();
            const results = this.skillRegistry.findSkillsByTag(tag);
            stream.markdown(`## 🔍 Skills tagged "${tag}"\n\n`);
            if (results.length > 0) {
                results.forEach(s => {
                    stream.markdown(`- **${s.name}** (${s.id}): ${s.description}\n`);
                });
            } else {
                stream.markdown('No skills found with that tag.');
            }
        } else {
            // Auto-find relevant skills
            const relevant = this.skillRegistry.findRelevantSkills(prompt);
            if (relevant.length > 0) {
                stream.markdown(`## 🧩 Relevant Skills\n\n`);
                relevant.forEach(s => {
                    const status = s.enabled ? '✅' : '⬜';
                    stream.markdown(`${status} **${s.name}**: ${s.description}\n`);
                });
            } else {
                stream.markdown(`No matching skills found for "${prompt}". Use \`/skills list\` to see all.`);
            }
        }

        return { metadata: { command: 'skills' } };
    }

    // ===== Workflow Command =====

    private async handleWorkflow(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.workflowEngine) {
            stream.markdown('❌ Workflow engine not initialized.');
            return { metadata: { command: 'workflow' } };
        }

        const lower = prompt.toLowerCase().trim();

        if (lower === '' || lower === 'list' || lower === 'show') {
            stream.markdown('## 📋 Workflow Engine\n\n');
            stream.markdown(this.workflowEngine.getWorkflowsSummary());
            stream.markdown('\n\n---\n');
            stream.markdown('💡 **Commands:**\n');
            stream.markdown('- `/workflow list` - Show all workflows\n');
            stream.markdown('- `/workflow run <id>` - Run a workflow\n');
            stream.markdown('- `/workflow status` - Show active executions\n');
            stream.markdown('- `/workflow describe <id>` - Show workflow details\n');
        } else if (lower.startsWith('run ')) {
            const id = lower.replace('run ', '').trim();
            const workflow = this.workflowEngine.getWorkflow(id);
            if (!workflow) {
                stream.markdown(`❌ Workflow not found: ${id}\n\nAvailable: ${this.workflowEngine.getAllWorkflows().map(w => w.id).join(', ')}`);
                return { metadata: { command: 'workflow' } };
            }

            // Collect inputs
            const inputs: Record<string, any> = {};
            if (workflow.inputs) {
                for (const input of workflow.inputs) {
                    if (input.required) {
                        const value = await vscode.window.showInputBox({
                            prompt: `${input.name}: ${input.description}`,
                            placeHolder: input.default ? String(input.default) : undefined
                        });
                        inputs[input.name] = value || input.default || '';
                    } else {
                        inputs[input.name] = input.default || '';
                    }
                }
            }

            stream.markdown(`## ▶️ Running: ${workflow.name}\n\n`);
            stream.progress('Executing workflow...');

            try {
                const execution = await this.workflowEngine.executeWorkflow(id, inputs);
                stream.markdown(this.workflowEngine.getExecutionSummary(execution.id));
            } catch (error) {
                stream.markdown(`❌ Workflow execution failed: ${error}`);
            }
        } else if (lower === 'status') {
            const active = this.workflowEngine.getActiveExecutions();
            const all = this.workflowEngine.getAllExecutions();
            stream.markdown(`## 📊 Workflow Status\n\nActive: ${active.length} | Total: ${all.length}\n\n`);
            for (const exec of all.slice(-5).reverse()) {
                stream.markdown(this.workflowEngine.getExecutionSummary(exec.id) + '\n\n---\n\n');
            }
        } else if (lower.startsWith('describe ')) {
            const id = lower.replace('describe ', '').trim();
            const workflow = this.workflowEngine.getWorkflow(id);
            if (!workflow) {
                stream.markdown(`❌ Workflow not found: ${id}`);
                return { metadata: { command: 'workflow' } };
            }

            stream.markdown(`## 📋 ${workflow.name}\n\n`);
            stream.markdown(`**Description:** ${workflow.description}\n\n`);
            stream.markdown(`**Version:** ${workflow.version}\n\n`);
            if (workflow.inputs?.length) {
                stream.markdown('**Inputs:**\n');
                workflow.inputs.forEach(i => {
                    stream.markdown(`- \`${i.name}\`${i.required ? '*' : ''}: ${i.description}\n`);
                });
            }
            stream.markdown('\n**Steps:**\n');
            workflow.steps.forEach((s, i) => {
                const deps = s.dependsOn?.length ? ` ← depends on: ${s.dependsOn.join(', ')}` : '';
                stream.markdown(`${i + 1}. **${s.name}** (${s.type}) → agent: ${s.agent || 'N/A'}${deps}\n`);
            });
        } else {
            stream.markdown(`Unknown workflow command. Use \`/workflow list\` to see available commands.`);
        }

        return { metadata: { command: 'workflow' } };
    }

    // ===== Pull Request Command =====

    private async handlePullRequest(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            stream.markdown('❌ No workspace folder open.');
            return { metadata: { command: 'pr' } };
        }

        stream.markdown('## 🔀 Create Azure DevOps Pull Request\n\n');
        stream.progress('Gathering git information...');

        try {
            // Get current branch
            const { stdout: branchRaw } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot });
            const currentBranch = branchRaw.trim();

            // Get remote info
            const { stdout: remoteRaw } = await execAsync('git remote -v', { cwd: workspaceRoot });
            stream.markdown(`**Branch:** \`${currentBranch}\`\n`);

            // Get diff stats
            let diffTarget = 'main';
            try {
                await execAsync('git rev-parse --verify origin/main', { cwd: workspaceRoot });
            } catch {
                diffTarget = 'master';
            }

            const { stdout: diffStat } = await execAsync(
                `git diff origin/${diffTarget}...HEAD --shortstat`, { cwd: workspaceRoot }
            );
            const { stdout: commitLog } = await execAsync(
                `git log origin/${diffTarget}..HEAD --oneline`, { cwd: workspaceRoot }
            );

            stream.markdown(`**Changes:** ${diffStat.trim()}\n`);
            stream.markdown(`**Commits:**\n${commitLog.trim().split('\n').map((c: string) => `- ${c}`).join('\n')}\n\n`);

            // Parse target branch from prompt
            const lower = prompt.toLowerCase();
            let targetBranch: string | undefined;
            const targetMatch = lower.match(/(?:to|into|target)\s+(\S+)/);
            if (targetMatch) targetBranch = targetMatch[1];

            const isDraft = lower.includes('draft');
            const autoComplete = lower.includes('auto-complete') || lower.includes('autocomplete');

            // Parse work item IDs
            const wiMatch = prompt.match(/#(\d+)/g);
            const workItemIds = wiMatch ? wiMatch.map(w => parseInt(w.replace('#', ''))) : undefined;

            stream.progress('Generating PR title and description with AI...');

            // Use the tool to create the PR
            const { AdoPullRequestTool } = require('../tools/adoPullRequest');
            const tool = new AdoPullRequestTool();

            const result = await tool.invoke({
                input: {
                    targetBranch,
                    isDraft,
                    autoComplete,
                    workItemIds
                }
            }, token);

            // Display result
            const parts = (result as any).content || [];
            for (const part of parts) {
                if (part.value) {
                    stream.markdown(part.value);
                }
            }

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            stream.markdown(`\n❌ **Error:** ${errorMsg}\n`);
            stream.markdown('\n💡 **Troubleshooting:**\n');
            stream.markdown('- Set `taskagent.adoPat` in VS Code settings with your Azure DevOps PAT\n');
            stream.markdown('- Or set the `AZURE_DEVOPS_PAT` environment variable\n');
            stream.markdown('- PAT needs **Code (Read & Write)** scope\n');
            stream.markdown('- Make sure your git remote points to Azure DevOps\n');
        }

        return { metadata: { command: 'pr' } };
    }

    // ===== Playwright Test Command =====

    private async handlePlaywrightTest(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        stream.markdown('## 🧪 Playwright Frontend Test\n\n');

        const config = vscode.workspace.getConfiguration('taskagent');
        const defaultSiteUrl = config.get<string>('sharePointSiteUrl') || '';

        // Parse URL from prompt
        const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
        const siteUrl = urlMatch ? urlMatch[0] : defaultSiteUrl;

        if (!siteUrl) {
            stream.markdown('❌ No site URL provided.\n\n');
            stream.markdown('**Usage:**\n');
            stream.markdown('- `/test https://contoso.sharepoint.com/sites/mysite` — Run smoke test\n');
            stream.markdown('- `/test https://... smoke` — Smoke test (default)\n');
            stream.markdown('- `/test https://... navigation` — Test navigation links\n');
            stream.markdown('- `/test https://... crud` — Test CRUD operations\n');
            stream.markdown('- Or set `taskagent.sharePointSiteUrl` in settings\n');
            return { metadata: { command: 'test' } };
        }

        // Parse scenario from prompt
        const lower = prompt.toLowerCase();
        let scenario = 'smoke';
        if (lower.includes('navigation') || lower.includes('nav')) scenario = 'navigation';
        else if (lower.includes('crud') || lower.includes('create') || lower.includes('edit')) scenario = 'crud';
        else if (lower.includes('custom')) scenario = 'custom';

        const headless = lower.includes('headless');

        stream.markdown(`**Site:** ${siteUrl}\n`);
        stream.markdown(`**Scenario:** ${scenario}\n`);
        stream.markdown(`**Mode:** ${headless ? 'Headless' : 'Visible browser'}\n\n`);
        stream.progress('Launching Playwright browser...');

        try {
            const { PlaywrightTestTool } = require('../tools/playwrightTest');
            const tool = new PlaywrightTestTool();

            const result = await tool.invoke({
                input: {
                    siteUrl,
                    scenario,
                    headless,
                    screenshots: true
                }
            }, token);

            const parts = (result as any).content || [];
            for (const part of parts) {
                if (part.value) {
                    stream.markdown(part.value);
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            stream.markdown(`\n❌ **Error:** ${errorMsg}\n`);
            stream.markdown('\n💡 **Troubleshooting:**\n');
            stream.markdown('- Run `npx playwright install chromium` to install browsers\n');
            stream.markdown('- Set `taskagent.sharePointUsername` and `taskagent.sharePointPassword` for auto-login\n');
            stream.markdown('- Make sure the site URL is accessible from your network\n');
        }

        return { metadata: { command: 'test' } };
    }
}









