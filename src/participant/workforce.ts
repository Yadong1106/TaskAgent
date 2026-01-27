import * as vscode from 'vscode';
import { TaskManager } from '../core/taskManager';
import { AgentRegistry } from '../core/agentRegistry';
import { Orchestrator } from '../core/orchestrator';
import { BackendServer } from '../server/backendServer';
import { MemoryModule } from '../core/memory';
import { RolePlayEngine } from '../core/rolePlay';
import { FeedbackCollector } from '../core/feedback';
import { TemplateManager } from '../core/templateManager';
import { ConsensusEngine } from '../core/consensus';
import { SelfReflectionEngine } from '../core/selfReflection';
import { ConversationCompressor } from '../core/conversationCompressor';
import { AgentAnalytics } from '../core/agentAnalytics';

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
        private templateManager?: TemplateManager,
        private consensusEngine?: ConsensusEngine,
        private selfReflectionEngine?: SelfReflectionEngine,
        private conversationCompressor?: ConversationCompressor,
        private agentAnalytics?: AgentAnalytics
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
            } else if (command === 'template') {
                return await this.handleTemplate(userPrompt, request, stream, token);
            } else if (command === 'consensus') {
                return await this.handleConsensus(userPrompt, request, stream, token);
            } else if (command === 'reflect') {
                return await this.handleReflect(userPrompt, request, stream, token);
            } else if (command === 'analytics') {
                return await this.handleAnalytics(userPrompt, request, stream, token);
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
            const response = await request.model.sendRequest(messages, {}, token);
            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }
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
            const response = await request.model.sendRequest(messages, {
                tools: previewTool.length > 0 ? previewTool : undefined
            }, token);

            let result = '';
            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    result += part.value;
                    stream.markdown(part.value);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
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

    /**
     * Handle template commands
     * /template list - List all templates
     * /template load <name> - Load and execute a template
     * /template save <name> - Save current decomposition as template (requires previous task)
     */
    private async handleTemplate(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.templateManager) {
            stream.markdown('Template manager not available.');
            return { metadata: { command: 'template', error: true } };
        }

        const args = prompt.trim().toLowerCase().split(/\s+/);
        const subCommand = args[0] || 'list';

        stream.markdown('## 📋 Task Templates\n\n');

        // Handle sub-commands
        if (subCommand === 'list' || !subCommand) {
            // List all templates
            const templateList = this.templateManager.formatTemplateList();
            stream.markdown(templateList);
            stream.markdown('\n**Usage:**\n');
            stream.markdown('- `/template load <name>` - Execute a template\n');
            stream.markdown('- `/template info <name>` - View template details\n');
            return { metadata: { command: 'template', subCommand: 'list' } };
        }

        if (subCommand === 'load' || subCommand === 'run' || subCommand === 'use') {
            // Load and execute a template
            const templateName = prompt.replace(/^(load|run|use)\s+/i, '').trim();

            if (!templateName) {
                // Show picker
                const template = await this.templateManager.pickTemplate();
                if (!template) {
                    stream.markdown('No template selected.');
                    return { metadata: { command: 'template', error: true } };
                }
                return await this.executeTemplate(template, request, stream, token);
            }

            // Find template by name
            const template = this.templateManager.getTemplateByName(templateName) ||
                           this.templateManager.getTemplate(templateName);

            if (!template) {
                stream.markdown(`Template "${templateName}" not found.\n\n`);
                stream.markdown('Use `/template list` to see available templates.');
                return { metadata: { command: 'template', error: true } };
            }

            return await this.executeTemplate(template, request, stream, token);
        }

        if (subCommand === 'info' || subCommand === 'show') {
            // Show template details
            const templateName = prompt.replace(/^(info|show)\s+/i, '').trim();
            const template = this.templateManager.getTemplateByName(templateName) ||
                           this.templateManager.getTemplate(templateName);

            if (!template) {
                stream.markdown(`Template "${templateName}" not found.`);
                return { metadata: { command: 'template', error: true } };
            }

            stream.markdown(`### ${template.name}\n\n`);
            stream.markdown(`**Description:** ${template.description}\n\n`);
            stream.markdown(`**Category:** ${template.category}\n\n`);
            stream.markdown(`**Version:** ${template.version}\n\n`);
            stream.markdown(`**Usage Count:** ${template.metadata.usageCount}\n\n`);

            if (template.parameters.length > 0) {
                stream.markdown(`**Parameters:**\n`);
                for (const param of template.parameters) {
                    const required = param.required ? '(required)' : '(optional)';
                    stream.markdown(`- \`{{${param.name}}}\` ${required}: ${param.description}\n`);
                }
                stream.markdown('\n');
            }

            stream.markdown(`**Workflow Steps:**\n`);
            template.baseDecomposition.subtasks.forEach((st, i) => {
                const deps = st.dependencies.length > 0
                    ? ` (after step ${st.dependencies.map(d => d + 1).join(', ')})`
                    : '';
                stream.markdown(`${i + 1}. [${st.agentId}] ${st.descriptionPattern}${deps}\n`);
            });

            return { metadata: { command: 'template', subCommand: 'info', templateId: template.id } };
        }

        if (subCommand === 'stats') {
            // Show template statistics
            const stats = this.templateManager.getStats() as any;
            stream.markdown('### Template Statistics\n\n');
            stream.markdown(`- **Total Templates:** ${stats.totalTemplates}\n`);
            stream.markdown(`- **Built-in:** ${stats.builtInTemplates}\n`);
            stream.markdown(`- **Custom:** ${stats.customTemplates}\n`);
            stream.markdown(`- **Total Usage:** ${stats.totalUsage}\n\n`);
            stream.markdown('**By Category:**\n');
            for (const [cat, count] of Object.entries(stats.byCategory)) {
                stream.markdown(`- ${cat}: ${count}\n`);
            }
            return { metadata: { command: 'template', subCommand: 'stats' } };
        }

        if (subCommand === 'delete' || subCommand === 'remove') {
            const templateName = prompt.replace(/^(delete|remove)\s+/i, '').trim();
            const template = this.templateManager.getTemplateByName(templateName);

            if (!template) {
                stream.markdown(`Template "${templateName}" not found.`);
                return { metadata: { command: 'template', error: true } };
            }

            const deleted = await this.templateManager.deleteTemplate(template.id);
            if (deleted) {
                stream.markdown(`Template "${template.name}" has been deleted.`);
            } else {
                stream.markdown(`Could not delete template "${template.name}". Built-in templates cannot be deleted.`);
            }
            return { metadata: { command: 'template', subCommand: 'delete' } };
        }

        // If prompt looks like a template name, try to load it
        const template = this.templateManager.getTemplateByName(prompt) ||
                        this.templateManager.searchTemplates(prompt)[0];

        if (template) {
            return await this.executeTemplate(template, request, stream, token);
        }

        // Unknown sub-command
        stream.markdown(`Unknown template command: "${subCommand}"\n\n`);
        stream.markdown('**Available commands:**\n');
        stream.markdown('- `/template list` - List all templates\n');
        stream.markdown('- `/template load <name>` - Execute a template\n');
        stream.markdown('- `/template info <name>` - View template details\n');
        stream.markdown('- `/template stats` - View template statistics\n');
        stream.markdown('- `/template delete <name>` - Delete a custom template\n');

        return { metadata: { command: 'template', error: true } };
    }

    /**
     * Execute a template with user-provided parameters
     */
    private async executeTemplate(
        template: ReturnType<TemplateManager['getTemplate']>,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!template || !this.templateManager) {
            stream.markdown('Template not found.');
            return { metadata: { command: 'template', error: true } };
        }

        stream.markdown(`### Executing: ${template.name}\n\n`);
        stream.markdown(`*${template.description}*\n\n`);

        // Prompt for parameters
        let parameterValues: Record<string, any> | undefined;

        if (template.parameters.length > 0) {
            stream.markdown('**Collecting parameters...**\n\n');
            parameterValues = await this.templateManager.promptForParameters(template);

            if (!parameterValues) {
                stream.markdown('Parameter collection cancelled.');
                return { metadata: { command: 'template', error: true } };
            }

            // Show collected parameters
            stream.markdown('**Parameters:**\n');
            for (const [key, value] of Object.entries(parameterValues)) {
                stream.markdown(`- ${key}: \`${value}\`\n`);
            }
            stream.markdown('\n');
        } else {
            parameterValues = {};
        }

        // Instantiate the template
        try {
            const decomposition = this.templateManager.instantiateTemplate(template.id, parameterValues);

            stream.markdown('---\n\n');
            stream.markdown(`**Goal:** ${decomposition.mainGoal}\n\n`);

            // Show execution plan
            stream.markdown('### 📋 Execution Plan\n\n');
            decomposition.subtasks.forEach((subtask, index) => {
                const agent = this.agentRegistry.getAgent(subtask.agentId);
                const deps = subtask.dependencies.length > 0
                    ? ` (depends on: ${subtask.dependencies.map(d => d + 1).join(', ')})`
                    : '';
                stream.markdown(`${index + 1}. **${agent?.name || subtask.agentId}**: ${subtask.description}${deps}\n`);
            });
            stream.markdown('\n---\n\n');

            // Create and execute task
            const task = this.taskManager.createTask(decomposition.mainGoal.slice(0, 50) + '...');
            await this.orchestrator.executeDecomposedTask(task, decomposition, request.model, stream, token);

            stream.markdown('\n\n---\n\n✅ **Template execution completed!**\n');

            return {
                metadata: {
                    command: 'template',
                    templateId: template.id,
                    taskId: task.id
                }
            };
        } catch (error) {
            stream.markdown(`\n\n❌ **Error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { metadata: { command: 'template', error: true } };
        }
    }

    /**
     * Handle consensus voting
     * Multiple agents analyze the topic and reach a consensus
     * Usage: /consensus <topic>
     */
    private async handleConsensus(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.consensusEngine) {
            stream.markdown('Consensus engine not available.');
            return { metadata: { command: 'consensus', error: true } };
        }

        // Parse agents from prompt if specified (format: "topic | agent1, agent2")
        const parts = prompt.split('|').map(p => p.trim());
        const topic = parts[0];
        let agentIds: string[];

        if (parts[1]) {
            agentIds = parts[1].split(',').map(a => a.trim().toLowerCase());
        } else {
            // Auto-select agents based on topic
            agentIds = this.consensusEngine.getRecommendedAgents(topic);
        }

        // Get context from current file if available
        const editor = vscode.window.activeTextEditor;
        let context: string | undefined;
        if (editor) {
            const selection = editor.selection;
            const selectedText = selection.isEmpty
                ? editor.document.getText()
                : editor.document.getText(selection);

            if (selectedText.length > 0 && selectedText.length < 5000) {
                context = `Current file context:\n\`\`\`\n${selectedText}\n\`\`\``;
            }
        }

        try {
            const result = await this.consensusEngine.runConsensus(
                topic,
                agentIds,
                request.model,
                stream,
                token,
                context
            );

            return {
                metadata: {
                    command: 'consensus',
                    topic,
                    agentCount: agentIds.length,
                    agreementLevel: result.agreementLevel
                }
            };
        } catch (error) {
            stream.markdown(`\n\n❌ **Error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { metadata: { command: 'consensus', error: true } };
        }
    }

    /**
     * Handle self-reflection task execution
     * Executes task with iterative critique and improvement
     * Usage: /reflect <task>
     */
    private async handleReflect(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.selfReflectionEngine) {
            stream.markdown('Self-reflection engine not available.');
            return { metadata: { command: 'reflect', error: true } };
        }

        // Parse optional config from prompt (format: "task | iterations=3, minScore=7")
        const parts = prompt.split('|').map(p => p.trim());
        const task = parts[0];
        let config: any = {};

        if (parts[1]) {
            // Parse config options
            const options = parts[1].split(',').map(o => o.trim());
            for (const opt of options) {
                const [key, value] = opt.split('=').map(s => s.trim());
                if (key === 'iterations') config.maxIterations = parseInt(value) || 3;
                if (key === 'minScore') config.minScore = parseInt(value) || 7;
                if (key === 'critic') config.criticAgent = value;
                if (key === 'executor') config.executorAgent = value;
            }
        }

        // Get context from current file if available
        const editor = vscode.window.activeTextEditor;
        let context: string | undefined;
        if (editor) {
            const selection = editor.selection;
            const selectedText = selection.isEmpty ? '' : editor.document.getText(selection);

            if (selectedText.length > 0 && selectedText.length < 5000) {
                context = `Code context:\n\`\`\`\n${selectedText}\n\`\`\``;
            }
        }

        try {
            const result = await this.selfReflectionEngine.executeWithReflection(
                task,
                request.model,
                stream,
                token,
                config,
                context
            );

            return {
                metadata: {
                    command: 'reflect',
                    task,
                    iterations: result.totalIterations,
                    improvementSummary: result.improvementSummary
                }
            };
        } catch (error) {
            stream.markdown(`\n\n❌ **Error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { metadata: { command: 'reflect', error: true } };
        }
    }

    /**
     * Handle analytics dashboard
     * Shows agent performance statistics
     * Usage: /analytics [detail|recent|clear]
     */
    private async handleAnalytics(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        if (!this.agentAnalytics) {
            stream.markdown('Agent analytics not available.');
            return { metadata: { command: 'analytics', error: true } };
        }

        const subCommand = prompt.trim().toLowerCase() || 'dashboard';

        if (subCommand === 'clear') {
            this.agentAnalytics.clear();
            stream.markdown('## 🗑️ Analytics Cleared\n\n');
            stream.markdown('All analytics data has been cleared.');
            return { metadata: { command: 'analytics', subCommand: 'clear' } };
        }

        if (subCommand === 'recent') {
            stream.markdown('## 📜 Recent Agent Activity\n\n');
            const recent = this.agentAnalytics.getRecentExecutions(20);

            if (recent.length === 0) {
                stream.markdown('*No recent executions recorded.*\n');
            } else {
                stream.markdown('| Time | Agent | Task | Status | Duration |\n');
                stream.markdown('|------|-------|------|--------|----------|\n');

                for (const exec of recent) {
                    const status = exec.success ? '✅' : '❌';
                    const time = exec.endTime.toLocaleTimeString();
                    const agent = this.agentRegistry.getAgent(exec.agentId)?.name || exec.agentId;
                    const taskName = exec.taskName.slice(0, 25) + (exec.taskName.length > 25 ? '...' : '');
                    const duration = exec.duration < 1000
                        ? `${exec.duration}ms`
                        : `${(exec.duration / 1000).toFixed(1)}s`;

                    stream.markdown(`| ${time} | ${agent} | ${taskName} | ${status} | ${duration} |\n`);
                }
            }

            return { metadata: { command: 'analytics', subCommand: 'recent' } };
        }

        if (subCommand === 'detail' || subCommand === 'report') {
            stream.markdown(this.agentAnalytics.formatAnalyticsReport());
            return { metadata: { command: 'analytics', subCommand: 'detail' } };
        }

        // Default: show dashboard
        await this.agentAnalytics.renderDashboard(stream);

        // Show available commands
        stream.markdown('\n---\n\n');
        stream.markdown('**Available commands:**\n');
        stream.markdown('- `/analytics` - Show performance dashboard\n');
        stream.markdown('- `/analytics recent` - Show recent activity\n');
        stream.markdown('- `/analytics detail` - Show detailed report\n');
        stream.markdown('- `/analytics clear` - Clear all analytics data\n');

        return { metadata: { command: 'analytics', subCommand: 'dashboard' } };
    }
}














