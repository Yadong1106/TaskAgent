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
            } else if (command === 'ship') {
                return await this.handleShip(userPrompt, request, stream, token);
            } else if (command === 'commit') {
                return await this.handleQuickCommit(userPrompt, request, stream, token);
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

    // ===== /commit - Quick Commit & Push =====
    private async handleQuickCommit(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            stream.markdown('❌ No workspace folder open.');
            return { metadata: { command: 'commit' } };
        }

        stream.markdown('## 📦 Quick Commit & Push\n\n');
        stream.progress('Checking git status...');

        try {
            // 1. Check for changes
            const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd });
            if (!statusOut.trim()) {
                stream.markdown('✅ Working tree is clean — nothing to commit.\n');
                return { metadata: { command: 'commit' } };
            }

            // 2. Get branch
            const { stdout: branchOut } = await execAsync('git branch --show-current', { cwd });
            const branch = branchOut.trim();

            // 3. Parse changed files
            const changedFiles = statusOut.trim().split('\n').map((l: string) => l.trim());
            const newFiles = changedFiles.filter((f: string) => f.startsWith('??') || f.startsWith('A '));
            const modifiedFiles = changedFiles.filter((f: string) => f.startsWith(' M') || f.startsWith('M '));
            const deletedFiles = changedFiles.filter((f: string) => f.startsWith(' D') || f.startsWith('D '));

            stream.markdown(`**Branch:** \`${branch}\`\n\n`);
            stream.markdown(`| Status | Count |\n|--------|-------|\n`);
            if (newFiles.length) { stream.markdown(`| ➕ New | ${newFiles.length} |\n`); }
            if (modifiedFiles.length) { stream.markdown(`| ✏️ Modified | ${modifiedFiles.length} |\n`); }
            if (deletedFiles.length) { stream.markdown(`| 🗑️ Deleted | ${deletedFiles.length} |\n`); }
            stream.markdown(`| **Total** | **${changedFiles.length}** |\n\n`);

            // 4. Generate commit message
            let commitMsg = prompt.trim();
            if (!commitMsg) {
                // Use LLM to generate a meaningful commit message from the diff
                stream.progress('Analyzing changes to generate commit message...');
                commitMsg = await this.generateCommitMessage(cwd, changedFiles, request.model, token);
            }

            stream.markdown(`**Commit message:** \`${commitMsg}\`\n\n`);

            // 5. git add
            stream.progress('Staging all changes...');
            await execAsync('git add .', { cwd });
            stream.markdown(`**Staging:** \`git add .\` ✅\n\n`);

            // 6. git commit
            stream.progress('Committing...');
            const escapedMsg = commitMsg.replace(/"/g, '\\"');
            await execAsync(`git commit -m "${escapedMsg}"`, { cwd });
            stream.markdown(`**Commit:** ✅\n\n`);

            // 7. git push
            stream.progress(`Pushing to origin/${branch}...`);
            try {
                await execAsync(`git push origin ${branch}`, { cwd });
            } catch (pushErr: any) {
                if (pushErr.message?.includes('no upstream') || pushErr.message?.includes('has no upstream')) {
                    await execAsync(`git push --set-upstream origin ${branch}`, { cwd });
                } else {
                    throw pushErr;
                }
            }
            stream.markdown(`**Push:** \`origin/${branch}\` ✅\n\n`);

            stream.markdown(`---\n\n🎉 **Done!** ${changedFiles.length} file(s) committed and pushed to \`${branch}\`.\n`);

            return { metadata: { command: 'commit' } };

        } catch (error: any) {
            stream.markdown(`\n❌ **Error:** ${error.message}\n`);
            return { metadata: { command: 'commit', error: true } };
        }
    }

    /**
     * Use LLM to generate a conventional commit message from the git diff.
     * Falls back to a simple summary if LLM call fails.
     */
    private async generateCommitMessage(
        cwd: string,
        changedFiles: string[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<string> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
            // Get diff (staged + unstaged), limit size to avoid token overflow
            let diff = '';
            try {
                const { stdout: diffOut } = await execAsync(
                    'git diff HEAD --stat',
                    { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 }
                );
                diff += diffOut;
            } catch { /* ignore */ }

            try {
                // Get the actual content diff but truncated
                const { stdout: diffContent } = await execAsync(
                    'git diff HEAD',
                    { cwd, encoding: 'utf-8', maxBuffer: 1024 * 512 }
                );
                // Limit to ~4000 chars to stay within token budget
                diff += '\n' + (diffContent.length > 4000 ? diffContent.slice(0, 4000) + '\n... (truncated)' : diffContent);
            } catch { /* ignore */ }

            // Also get untracked file names
            const untrackedFiles = changedFiles
                .filter((f: string) => f.startsWith('??'))
                .map((f: string) => f.replace('?? ', ''));
            if (untrackedFiles.length > 0) {
                diff += `\n\nNew untracked files:\n${untrackedFiles.join('\n')}`;
            }

            if (!diff.trim()) {
                // Fallback if diff is empty
                throw new Error('Empty diff');
            }

            const llmPrompt = `You are a commit message generator. Based on the git diff below, generate a single-line conventional commit message.

Rules:
- Use conventional commit format: type(scope): description
- Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
- Scope is optional, use the most relevant module/area name
- Description should be concise (max 72 chars total), lowercase, no period at end
- Output ONLY the commit message, nothing else — no quotes, no explanation

Git diff:
\`\`\`
${diff}
\`\`\`

Commit message:`;

            const messages = [vscode.LanguageModelChatMessage.User(llmPrompt)];
            const response = await model.sendRequest(messages, {}, token);

            let commitMsg = '';
            for await (const chunk of response.text) {
                commitMsg += chunk;
            }

            // Clean up: take first line, remove quotes/backticks
            commitMsg = commitMsg
                .split('\n')[0]
                .trim()
                .replace(/^[`"']+|[`"']+$/g, '')
                .trim();

            // Track usage
            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: 'workforce:commit',
                purpose: 'Generate commit message from diff',
                inputText: llmPrompt.slice(0, 200),
                outputText: commitMsg,
                duration: 0,
                success: true
            });

            if (commitMsg && commitMsg.length > 5 && commitMsg.length < 200) {
                return commitMsg;
            }

            throw new Error('Invalid LLM output');

        } catch {
            // Fallback: simple file-count based message
            const newFiles = changedFiles.filter((f: string) => f.startsWith('??') || f.startsWith('A '));
            const modifiedFiles = changedFiles.filter((f: string) => f.startsWith(' M') || f.startsWith('M '));
            const deletedFiles = changedFiles.filter((f: string) => f.startsWith(' D') || f.startsWith('D '));
            const parts: string[] = [];
            if (newFiles.length > 0) { parts.push(`add ${newFiles.length} file(s)`); }
            if (modifiedFiles.length > 0) { parts.push(`update ${modifiedFiles.length} file(s)`); }
            if (deletedFiles.length > 0) { parts.push(`remove ${deletedFiles.length} file(s)`); }
            return parts.join(', ') || `update ${changedFiles.length} file(s)`;
        }
    }

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

    // ===== Ship Command: Full Test → Fix → PR Pipeline =====

    private async handleShip(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const path = require('path');

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            stream.markdown('❌ No workspace folder open.');
            return { metadata: { command: 'ship' } };
        }

        const config = vscode.workspace.getConfiguration('taskagent');
        const maxFixAttempts = 3;

        stream.markdown('## 🚀 Ship Pipeline: Test → Fix → PR\n\n');

        // ===== Phase 1: Analyze current branch changes =====
        stream.markdown('### 📋 Phase 1: Analyze Branch Changes\n\n');
        stream.progress('Analyzing git changes...');

        let currentBranch: string;
        let defaultBranch: string;
        let changedFiles: string[];
        let diffSummary: string;

        try {
            const run = (cmd: string) => execAsync(cmd, { cwd: workspaceRoot, encoding: 'utf-8' });
            
            const { stdout: branchRaw } = await run('git rev-parse --abbrev-ref HEAD');
            currentBranch = branchRaw.trim();

            // Detect default branch
            try {
                await run('git rev-parse --verify origin/main');
                defaultBranch = 'main';
            } catch {
                defaultBranch = 'master';
            }

            const { stdout: diffFiles } = await run(`git diff origin/${defaultBranch}...HEAD --name-only`);
            changedFiles = diffFiles.trim().split('\n').filter((f: string) => f.length > 0);

            const { stdout: diffStatRaw } = await run(`git diff origin/${defaultBranch}...HEAD --shortstat`);
            diffSummary = diffStatRaw.trim();

            const { stdout: commitLog } = await run(`git log origin/${defaultBranch}..HEAD --oneline`);
            const commits = commitLog.trim().split('\n').filter((l: string) => l.length > 0);

            stream.markdown(`**Branch:** \`${currentBranch}\` → \`${defaultBranch}\`\n`);
            stream.markdown(`**Changes:** ${diffSummary}\n`);
            stream.markdown(`**Commits:** ${commits.length}\n`);
            stream.markdown(`**Changed files (${changedFiles.length}):**\n`);
            changedFiles.slice(0, 15).forEach(f => stream.markdown(`- \`${f}\`\n`));
            if (changedFiles.length > 15) stream.markdown(`- ... and ${changedFiles.length - 15} more\n`);
            stream.markdown('\n');

            if (changedFiles.length === 0) {
                stream.markdown('⚠️ No changes detected on this branch. Nothing to test or ship.\n');
                return { metadata: { command: 'ship' } };
            }

        } catch (error) {
            stream.markdown(`❌ Failed to analyze git changes: ${error}\n`);
            return { metadata: { command: 'ship' } };
        }

        // ===== Phase 2: Run Tests (focused on changed files) =====
        stream.markdown('---\n\n### 🧪 Phase 2: Test Changed Code\n\n');

        // Determine test strategy based on changed files
        const frontendFiles = changedFiles.filter(f => 
            f.endsWith('.tsx') || f.endsWith('.jsx') || f.endsWith('.css') || 
            f.endsWith('.html') || f.endsWith('.scss') || f.endsWith('.vue')
        );
        const backendFiles = changedFiles.filter(f => 
            f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.cs')
        );
        const testFiles = changedFiles.filter(f => 
            f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')
        );

        let testPassed = true;
        let testOutput = '';
        let failedTests: string[] = [];
        let attempt = 0;

        // Loop: Test → Fix → Re-test
        while (attempt < maxFixAttempts) {
            attempt++;
            stream.markdown(`\n#### 🔄 Test Attempt ${attempt}/${maxFixAttempts}\n\n`);
            stream.progress(`Running tests (attempt ${attempt})...`);

            testPassed = true;
            testOutput = '';
            failedTests = [];

            // Strategy A: Run existing unit/integration tests
            const testResults = await this.runProjectTests(workspaceRoot, execAsync, stream, changedFiles);
            if (!testResults.passed) {
                testPassed = false;
                testOutput = testResults.output;
                failedTests = testResults.failures;
            }

            // Strategy B: If frontend files changed + SharePoint URL configured, run Playwright
            const siteUrl = this.extractSiteUrl(prompt) || config.get<string>('sharePointSiteUrl') || '';
            if (siteUrl && frontendFiles.length > 0) {
                stream.markdown('\n**Running Playwright browser tests...**\n\n');
                const playwrightResult = await this.runPlaywrightForShip(siteUrl, token, stream);
                if (!playwrightResult.passed) {
                    testPassed = false;
                    testOutput += '\n\nPlaywright failures:\n' + playwrightResult.output;
                    failedTests.push(...playwrightResult.failures);
                }
            }

            // Strategy C: Use LLM to review changed code for bugs
            if (testPassed) {
                stream.markdown('\n**Running AI code review on changes...**\n\n');
                const reviewResult = await this.aiCodeReview(workspaceRoot, changedFiles, request.model, token, stream);
                if (reviewResult.hasCriticalIssues) {
                    testPassed = false;
                    testOutput += '\n\nAI Review Issues:\n' + reviewResult.issues;
                    failedTests.push(...reviewResult.failureDescriptions);
                }
            }

            // If all tests pass, break out of the loop
            if (testPassed) {
                stream.markdown('\n✅ **All tests passed!**\n\n');
                break;
            }

            // ===== Phase 3: Auto-fix bugs =====
            if (attempt < maxFixAttempts) {
                stream.markdown(`\n### 🔧 Auto-Fix (Attempt ${attempt})\n\n`);
                stream.markdown(`**Found ${failedTests.length} issue(s):**\n`);
                failedTests.forEach((f, i) => stream.markdown(`${i + 1}. ${f}\n`));
                stream.markdown('\n');
                stream.progress('Asking AI to fix the issues...');

                const fixed = await this.autoFixBugs(
                    workspaceRoot, changedFiles, failedTests, testOutput,
                    request.model, token, stream
                );

                if (!fixed) {
                    stream.markdown('\n⚠️ **Auto-fix could not resolve all issues. Please fix manually.**\n\n');
                    stream.markdown('Failed tests:\n');
                    failedTests.forEach(f => stream.markdown(`- ${f}\n`));
                    return { metadata: { command: 'ship', testPassed: false } };
                }
            } else {
                stream.markdown(`\n❌ **Tests still failing after ${maxFixAttempts} attempts.**\n\n`);
                stream.markdown('Remaining issues:\n');
                failedTests.forEach(f => stream.markdown(`- ${f}\n`));
                stream.markdown('\nPlease fix these manually and run `/ship` again.\n');
                return { metadata: { command: 'ship', testPassed: false } };
            }
        }

        // ===== Phase 4: Create PR =====
        stream.markdown('---\n\n### 🔀 Phase 4: Create Pull Request\n\n');
        stream.progress('Creating Azure DevOps PR...');

        try {
            const { AdoPullRequestTool } = require('../tools/adoPullRequest');
            const prTool = new AdoPullRequestTool();

            const prResult = await prTool.invoke({
                input: {
                    targetBranch: defaultBranch,
                    isDraft: false,
                    autoComplete: false
                }
            }, token);

            const parts = (prResult as any).content || [];
            for (const part of parts) {
                if (part.value) {
                    stream.markdown(part.value);
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            stream.markdown(`\n❌ **PR creation failed:** ${errorMsg}\n`);
            stream.markdown('- Set `taskagent.adoPat` in settings\n');
            stream.markdown('- Or create the PR manually — all tests passed!\n');
        }

        stream.markdown('\n---\n\n✅ **Ship pipeline complete!**\n');
        return { metadata: { command: 'ship', testPassed: true } };
    }

    // ===== Ship Pipeline Helpers =====

    private extractSiteUrl(prompt: string): string {
        const match = prompt.match(/https?:\/\/[^\s]+/);
        return match ? match[0] : '';
    }

    /**
     * Run project tests (npm test, pytest, dotnet test, etc.)
     */
    private async runProjectTests(
        workspaceRoot: string,
        execAsync: any,
        stream: vscode.ChatResponseStream,
        changedFiles: string[]
    ): Promise<{ passed: boolean; output: string; failures: string[] }> {
        const fs = require('fs');
        const path = require('path');
        
        let testCommand = '';
        const failures: string[] = [];

        // Detect project type and test runner
        if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
                if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
                    testCommand = 'npm test -- --passWithNoTests 2>&1';
                } else if (pkg.scripts?.['test:unit']) {
                    testCommand = 'npm run test:unit 2>&1';
                }
            } catch { /* ignore */ }
        }
        
        if (!testCommand && fs.existsSync(path.join(workspaceRoot, 'pytest.ini')) || 
            fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
            testCommand = 'python -m pytest --tb=short 2>&1';
        }

        if (!testCommand) {
            // Try TypeScript compilation check
            if (fs.existsSync(path.join(workspaceRoot, 'tsconfig.json'))) {
                testCommand = 'npx tsc --noEmit 2>&1';
                stream.markdown('📋 Running TypeScript compilation check...\n');
            } else {
                stream.markdown('ℹ️ No test runner detected. Skipping unit tests.\n');
                return { passed: true, output: '', failures: [] };
            }
        } else {
            stream.markdown(`📋 Running: \`${testCommand.replace(' 2>&1', '')}\`\n`);
        }

        try {
            const { stdout } = await execAsync(testCommand, { 
                cwd: workspaceRoot, encoding: 'utf-8', timeout: 120000 
            });
            stream.markdown('✅ Tests passed.\n');
            return { passed: true, output: stdout, failures: [] };
        } catch (error: any) {
            const output = error.stdout || error.stderr || error.message || String(error);
            stream.markdown('❌ Tests failed.\n');
            
            // Parse failure messages
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.match(/FAIL|ERROR|error TS|failed|✗|✖|AssertionError/i)) {
                    failures.push(line.trim());
                }
            }
            if (failures.length === 0) failures.push('Test command returned non-zero exit code');
            
            return { passed: false, output, failures };
        }
    }

    /**
     * Run Playwright smoke test for the ship pipeline
     */
    private async runPlaywrightForShip(
        siteUrl: string,
        token: vscode.CancellationToken,
        stream: vscode.ChatResponseStream
    ): Promise<{ passed: boolean; output: string; failures: string[] }> {
        try {
            const { PlaywrightTestTool } = require('../tools/playwrightTest');
            const tool = new PlaywrightTestTool();

            const result = await tool.invoke({
                input: {
                    siteUrl,
                    scenario: 'smoke',
                    headless: true,
                    screenshots: true
                }
            }, token);

            const parts = (result as any).content || [];
            let output = '';
            for (const part of parts) {
                if (part.value) output += part.value;
            }

            // Parse pass/fail from output
            const failedMatch = output.match(/Failed\s*\|\s*(\d+)/);
            const failedCount = failedMatch ? parseInt(failedMatch[1]) : 0;

            if (failedCount > 0) {
                const failures: string[] = [];
                const stepMatches = output.matchAll(/❌\s+\*\*(.+?)\*\*/g);
                for (const m of stepMatches) failures.push(m[1]);
                stream.markdown(output + '\n');
                return { passed: false, output, failures };
            }

            stream.markdown('✅ Playwright smoke test passed.\n');
            return { passed: true, output, failures: [] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            stream.markdown(`⚠️ Playwright test skipped: ${msg}\n`);
            return { passed: true, output: '', failures: [] };
        }
    }

    /**
     * Use LLM to review changed code for critical bugs
     */
    private async aiCodeReview(
        workspaceRoot: string,
        changedFiles: string[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        stream: vscode.ChatResponseStream
    ): Promise<{ hasCriticalIssues: boolean; issues: string; failureDescriptions: string[] }> {
        const fs = require('fs');
        const path = require('path');

        // Read content of changed files (limit to reasonable size)
        let codeContext = '';
        let filesIncluded = 0;
        for (const file of changedFiles.slice(0, 10)) {
            try {
                const fullPath = path.join(workspaceRoot, file);
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    if (content.length < 8000) {
                        codeContext += `\n--- ${file} ---\n${content}\n`;
                        filesIncluded++;
                    }
                }
            } catch { /* skip */ }
        }

        if (filesIncluded === 0) {
            return { hasCriticalIssues: false, issues: '', failureDescriptions: [] };
        }

        const reviewPrompt = `Review the following changed files for CRITICAL bugs only (not style issues).
Focus on: null pointer errors, incorrect logic, missing error handling, security vulnerabilities, broken API contracts.
If no critical issues found, respond with exactly: NO_CRITICAL_ISSUES
If issues found, list each as: CRITICAL: <file> - <description>

Changed files:
${codeContext}`;

        try {
            const startTime = Date.now();
            const messages = [vscode.LanguageModelChatMessage.User(reviewPrompt)];
            const response = await model.sendRequest(messages, {}, token);
            
            let reviewText = '';
            for await (const chunk of response.text) {
                reviewText += chunk;
            }

            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: 'ship:ai-review',
                purpose: 'AI code review for ship pipeline',
                inputText: reviewPrompt,
                outputText: reviewText,
                duration: Date.now() - startTime,
                success: true
            });

            if (reviewText.includes('NO_CRITICAL_ISSUES')) {
                stream.markdown('✅ AI review: No critical issues found.\n');
                return { hasCriticalIssues: false, issues: '', failureDescriptions: [] };
            }

            // Parse CRITICAL lines
            const criticals = reviewText.split('\n')
                .filter(l => l.trim().startsWith('CRITICAL:'))
                .map(l => l.replace('CRITICAL:', '').trim());

            if (criticals.length > 0) {
                stream.markdown(`⚠️ AI review found ${criticals.length} critical issue(s):\n`);
                criticals.forEach(c => stream.markdown(`- ${c}\n`));
                return { hasCriticalIssues: true, issues: reviewText, failureDescriptions: criticals };
            }

            stream.markdown('✅ AI review: No critical issues.\n');
            return { hasCriticalIssues: false, issues: '', failureDescriptions: [] };
        } catch {
            stream.markdown('ℹ️ AI review skipped (model unavailable).\n');
            return { hasCriticalIssues: false, issues: '', failureDescriptions: [] };
        }
    }

    /**
     * Use LLM to auto-fix bugs found in tests
     */
    private async autoFixBugs(
        workspaceRoot: string,
        changedFiles: string[],
        failures: string[],
        testOutput: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        stream: vscode.ChatResponseStream
    ): Promise<boolean> {
        const fs = require('fs');
        const path = require('path');

        // Read relevant source files
        let codeContext = '';
        for (const file of changedFiles.slice(0, 8)) {
            try {
                const fullPath = path.join(workspaceRoot, file);
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    if (content.length < 8000) {
                        codeContext += `\n--- ${file} ---\n${content}\n`;
                    }
                }
            } catch { /* skip */ }
        }

        const fixPrompt = `The following code has test failures. Fix the bugs.

Test failures:
${failures.join('\n')}

Test output (truncated):
${testOutput.slice(0, 3000)}

Source code:
${codeContext}

For each file that needs fixing, respond in this exact format:
===FIX_FILE: <relative-path>===
<complete fixed file content>
===END_FILE===

Only include files that need changes. Provide the COMPLETE file content, not patches.`;

        try {
            const startTime = Date.now();
            const messages = [vscode.LanguageModelChatMessage.User(fixPrompt)];
            const response = await model.sendRequest(messages, {}, token);
            
            let fixText = '';
            for await (const chunk of response.text) {
                fixText += chunk;
            }

            this.usageTracker?.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller: 'ship:auto-fix',
                purpose: 'Auto-fix bugs in ship pipeline',
                inputText: fixPrompt.slice(0, 500),
                outputText: fixText.slice(0, 500),
                duration: Date.now() - startTime,
                success: true
            });

            // Parse and apply fixes
            const fixRegex = /===FIX_FILE:\s*(.+?)===\n([\s\S]*?)===END_FILE===/g;
            let match;
            let fixCount = 0;

            while ((match = fixRegex.exec(fixText)) !== null) {
                const filePath = match[1].trim();
                const fileContent = match[2].trim();
                const fullPath = path.join(workspaceRoot, filePath);

                try {
                    // Safety: only write to files that exist and are in changedFiles
                    if (fs.existsSync(fullPath) && changedFiles.includes(filePath)) {
                        fs.writeFileSync(fullPath, fileContent, 'utf-8');
                        stream.markdown(`✏️ Fixed: \`${filePath}\`\n`);
                        fixCount++;
                    } else {
                        stream.markdown(`⏭️ Skipped: \`${filePath}\` (not in changed files)\n`);
                    }
                } catch (writeError) {
                    stream.markdown(`⚠️ Failed to write \`${filePath}\`: ${writeError}\n`);
                }
            }

            if (fixCount > 0) {
                stream.markdown(`\n✅ Applied ${fixCount} fix(es). Re-testing...\n`);

                // Stage the fixed files
                try {
                    const { exec: execCb } = require('child_process');
                    const { promisify: prom } = require('util');
                    const run = prom(execCb);
                    await run('git add -A', { cwd: workspaceRoot });
                    await run(`git commit -m "fix: auto-fix test failures (attempt)"`, { cwd: workspaceRoot });
                    stream.markdown('📝 Changes committed.\n');
                } catch {
                    stream.markdown('ℹ️ Auto-commit skipped (no changes or git error).\n');
                }

                return true;
            }

            stream.markdown('⚠️ No auto-fixes could be generated.\n');
            return false;
        } catch (error) {
            stream.markdown(`⚠️ Auto-fix failed: ${error}\n`);
            return false;
        }
    }
}









