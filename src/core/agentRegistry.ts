import * as vscode from 'vscode';

export interface AgentConfig {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    enabled: boolean;
}

/**
 * AgentRegistry - Manages registration and configuration of all agents
 * Similar to Eigent's Workforce concept
 */
export class AgentRegistry implements vscode.TreeDataProvider<AgentConfig> {
    private agents: Map<string, AgentConfig> = new Map();
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentConfig | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {
        // Register default agents (similar to Eigent's pre-defined agents)
        this.registerDefaultAgents();
    }

    private registerDefaultAgents() {
        // Developer Agent
        this.registerAgent({
            id: 'developer',
            name: 'Developer Agent',
            description: 'Writes, executes, and debugs code. Runs terminal commands.',
            systemPrompt: `You are an expert developer agent. Your capabilities include:
- Writing high-quality code in multiple languages
- Executing code and shell commands
- Debugging and fixing issues
- Managing files and project structure

Always explain your approach before executing. If you encounter errors, analyze them and propose solutions.
When executing potentially destructive commands, always ask for confirmation first.`,
            tools: ['taskagent_executeCode', 'taskagent_createDocument'],
            enabled: true
        });

        // Search Agent
        this.registerAgent({
            id: 'search',
            name: 'Search Agent',
            description: 'Searches the web, extracts content from URLs.',
            systemPrompt: `You are a research agent specialized in finding and analyzing information. Your capabilities include:
- Searching the web for relevant information
- Extracting and summarizing content from webpages
- Comparing information from multiple sources
- Providing well-cited, accurate answers

Always verify information from multiple sources when possible. Cite your sources clearly.`,
            tools: ['taskagent_webSearch', 'taskagent_browseWebpage'],
            enabled: true
        });

        // Document Agent
        this.registerAgent({
            id: 'document',
            name: 'Document Agent',
            description: 'Creates and manages documents, reports, and files.',
            systemPrompt: `You are a document specialist agent. Your capabilities include:
- Creating well-structured documents and reports
- Organizing and formatting content
- Managing files and folders
- Converting between document formats

Focus on clear structure, proper formatting, and readable content.`,
            tools: ['taskagent_createDocument'],
            enabled: true
        });

        // Browser Agent
        this.registerAgent({
            id: 'browser',
            name: 'Browser Agent',
            description: 'Controls web browser for automation and scraping.',
            systemPrompt: `You are a browser automation agent. Your capabilities include:
- Navigating web pages
- Filling forms and clicking buttons
- Extracting data from web pages
- Taking screenshots
- Handling authentication

Be careful with sensitive operations. Always respect robots.txt and rate limits.`,
            tools: ['taskagent_browseWebpage'],
            enabled: true
        });

        // Multi-Modal Agent
        this.registerAgent({
            id: 'multimodal',
            name: 'Multi-Modal Agent',
            description: 'Processes images, screenshots, and visual content.',
            systemPrompt: `You are a multi-modal agent capable of understanding and processing visual content. Your capabilities include:
- Analyzing images and screenshots
- Extracting text from images (OCR)
- Describing visual content
- Processing diagrams and charts

Provide detailed descriptions and accurate analysis of visual content.`,
            tools: ['taskagent_browseWebpage'],
            enabled: true
        });
    }

    registerAgent(config: AgentConfig) {
        this.agents.set(config.id, config);
        this._onDidChangeTreeData.fire(undefined);
    }

    getAgent(id: string): AgentConfig | undefined {
        return this.agents.get(id);
    }

    getAllAgents(): AgentConfig[] {
        return Array.from(this.agents.values());
    }

    getEnabledAgents(): AgentConfig[] {
        return this.getAllAgents().filter(a => a.enabled);
    }

    getAgentForTask(taskType: string): AgentConfig | undefined {
        // Simple mapping based on task keywords
        const taskLower = taskType.toLowerCase();
        
        if (taskLower.includes('code') || taskLower.includes('execute') || taskLower.includes('debug')) {
            return this.getAgent('developer');
        }
        if (taskLower.includes('search') || taskLower.includes('research') || taskLower.includes('find')) {
            return this.getAgent('search');
        }
        if (taskLower.includes('document') || taskLower.includes('report') || taskLower.includes('write')) {
            return this.getAgent('document');
        }
        if (taskLower.includes('browser') || taskLower.includes('scrape') || taskLower.includes('webpage')) {
            return this.getAgent('browser');
        }
        if (taskLower.includes('image') || taskLower.includes('screenshot') || taskLower.includes('visual')) {
            return this.getAgent('multimodal');
        }

        // Default to developer agent
        return this.getAgent('developer');
    }

    setAgentEnabled(id: string, enabled: boolean) {
        const agent = this.agents.get(id);
        if (agent) {
            agent.enabled = enabled;
            this._onDidChangeTreeData.fire(agent);
        }
    }

    // TreeDataProvider implementation
    getTreeItem(element: AgentConfig): vscode.TreeItem {
        const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        item.description = element.enabled ? 'Ready' : 'Disabled';
        item.tooltip = element.description;
        item.iconPath = new vscode.ThemeIcon(element.enabled ? 'check' : 'circle-slash');
        item.contextValue = 'agent';
        return item;
    }

    getChildren(): AgentConfig[] {
        return this.getAllAgents();
    }
}














