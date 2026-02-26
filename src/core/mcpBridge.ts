import * as vscode from 'vscode';

/**
 * Discovered tool information
 */
export interface DiscoveredTool {
    name: string;
    displayName: string;
    description: string;
    /** 'taskagent' = our own tool, 'mcp' = external MCP server, 'extension' = other extension */
    source: 'taskagent' | 'mcp' | 'extension';
    /** MCP server name if source is 'mcp' */
    serverName?: string;
    /** Tool tags for matching to agents */
    tags: string[];
    /** The actual tool reference for passing to sendRequest */
    toolRef: vscode.LanguageModelChatTool;
}

/**
 * McpBridge - Discovers and manages MCP + extension tools
 *
 * Bridges external MCP server tools and other extension tools into TaskAgent's
 * agent system so orchestrator can intelligently assign them to agents.
 */
export class McpBridge {
    private cachedTools: DiscoveredTool[] = [];
    private lastRefresh: number = 0;
    private cacheTtlMs = 10000; // Refresh every 10s

    /**
     * Discover all available tools from all sources
     */
    async discoverTools(): Promise<DiscoveredTool[]> {
        const now = Date.now();
        if (this.cachedTools.length > 0 && now - this.lastRefresh < this.cacheTtlMs) {
            return this.cachedTools;
        }

        const allTools: DiscoveredTool[] = [];

        try {
            const tools = vscode.lm.tools;

            for (const tool of tools) {
                const source = this.classifyToolSource(tool.name);
                const tags = this.inferTags(tool.name, tool.description);

                allTools.push({
                    name: tool.name,
                    displayName: (tool as any).displayName || tool.name,
                    description: tool.description,
                    source: source.type,
                    serverName: source.server,
                    tags,
                    toolRef: tool
                });
            }
        } catch (error) {
            console.warn('McpBridge: Failed to discover tools:', error);
        }

        this.cachedTools = allTools;
        this.lastRefresh = now;
        return allTools;
    }

    /**
     * Get only external tools (MCP + other extensions, NOT taskagent_ tools)
     */
    async getExternalTools(): Promise<DiscoveredTool[]> {
        const all = await this.discoverTools();
        return all.filter(t => t.source !== 'taskagent');
    }

    /**
     * Get only MCP server tools
     */
    async getMcpTools(): Promise<DiscoveredTool[]> {
        const all = await this.discoverTools();
        return all.filter(t => t.source === 'mcp');
    }

    /**
     * Get TaskAgent's own tools
     */
    async getOwnTools(): Promise<DiscoveredTool[]> {
        const all = await this.discoverTools();
        return all.filter(t => t.source === 'taskagent');
    }

    /**
     * Find tools matching an agent's needs
     */
    async findToolsForAgent(agentId: string, taskDescription: string): Promise<vscode.LanguageModelChatTool[]> {
        const all = await this.discoverTools();
        const taskLower = taskDescription.toLowerCase();
        const agentLower = agentId.toLowerCase();

        // Score each tool based on relevance
        const scored = all.map(tool => {
            let score = 0;
            const descLower = tool.description.toLowerCase();
            const nameLower = tool.name.toLowerCase();

            // Agent-specific matching
            if (agentLower.includes('developer') || agentLower.includes('code')) {
                if (tool.tags.some(t => ['code', 'execute', 'file', 'terminal', 'git'].includes(t))) score += 3;
            }
            if (agentLower.includes('search') || agentLower.includes('research')) {
                if (tool.tags.some(t => ['search', 'web', 'browse', 'fetch'].includes(t))) score += 3;
            }
            if (agentLower.includes('security')) {
                if (tool.tags.some(t => ['security', 'review', 'scan', 'analyze'].includes(t))) score += 3;
            }
            if (agentLower.includes('browser') || agentLower.includes('frontend')) {
                if (tool.tags.some(t => ['browser', 'web', 'page', 'ui', 'screenshot', 'playwright'].includes(t))) score += 3;
            }
            if (agentLower.includes('document')) {
                if (tool.tags.some(t => ['document', 'create', 'write', 'file', 'markdown'].includes(t))) score += 3;
            }

            // Task description keyword matching
            for (const tag of tool.tags) {
                if (taskLower.includes(tag)) score += 2;
            }

            // Name/description matching
            const taskWords = taskLower.split(/\s+/).filter(w => w.length > 3);
            for (const word of taskWords) {
                if (nameLower.includes(word)) score += 1;
                if (descLower.includes(word)) score += 1;
            }

            // Bonus for MCP tools (user explicitly configured them, so they're relevant)
            if (tool.source === 'mcp') score += 1;

            return { tool, score };
        });

        // Return tools with score > 0, sorted by relevance, limit to 10
        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(s => s.tool.toolRef);
    }

    /**
     * Build a tool description string for inclusion in LLM prompts
     */
    async buildToolDescription(): Promise<string> {
        const external = await this.getExternalTools();
        if (external.length === 0) return '';

        const grouped = new Map<string, DiscoveredTool[]>();
        for (const tool of external) {
            const key = tool.serverName || tool.source;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(tool);
        }

        let desc = '\n\nAdditional tools available from MCP servers and extensions:\n';
        for (const [source, tools] of grouped) {
            desc += `\n[${source}]:\n`;
            for (const t of tools) {
                desc += `- ${t.name}: ${t.description.slice(0, 120)}\n`;
            }
        }
        return desc;
    }

    /**
     * Get summary for dashboard display
     */
    async getToolsSummary(): Promise<{
        total: number;
        taskagent: number;
        mcp: number;
        extension: number;
        mcpServers: string[];
        tools: DiscoveredTool[];
    }> {
        const all = await this.discoverTools();
        const mcpServers = [...new Set(all.filter(t => t.serverName).map(t => t.serverName!))];

        return {
            total: all.length,
            taskagent: all.filter(t => t.source === 'taskagent').length,
            mcp: all.filter(t => t.source === 'mcp').length,
            extension: all.filter(t => t.source === 'extension').length,
            mcpServers,
            tools: all
        };
    }

    // ===== Classification Helpers =====

    private classifyToolSource(name: string): { type: 'taskagent' | 'mcp' | 'extension'; server?: string } {
        // Our own tools
        if (name.startsWith('taskagent_')) {
            return { type: 'taskagent' };
        }

        // Known MCP server naming patterns
        // MCP tools often follow: serverName_toolName or mcp_serverName_toolName
        const mcpPatterns = [
            /^mcp[_-](.+?)_/,           // mcp_github_xxx
            /^([a-z]+)_mcp_/,            // github_mcp_xxx
        ];

        for (const pattern of mcpPatterns) {
            const match = name.match(pattern);
            if (match) {
                return { type: 'mcp', server: match[1] };
            }
        }

        // Common MCP server tool prefixes
        const knownMcpPrefixes: Record<string, string> = {
            'playwright_': 'playwright',
            'github_': 'github',
            'filesystem_': 'filesystem',
            'postgres_': 'postgres',
            'sqlite_': 'sqlite',
            'brave_': 'brave-search',
            'fetch_': 'fetch',
            'memory_': 'memory',
            'puppeteer_': 'puppeteer',
            'docker_': 'docker',
            'kubernetes_': 'kubernetes',
            'slack_': 'slack',
            'linear_': 'linear',
            'notion_': 'notion',
            'google_': 'google',
            'azure_': 'azure',
        };

        for (const [prefix, server] of Object.entries(knownMcpPrefixes)) {
            if (name.startsWith(prefix)) {
                return { type: 'mcp', server };
            }
        }

        // If not taskagent and not a known MCP pattern, classify as extension tool
        // But check if it looks like it could be from an MCP (has underscore separator)
        if (name.includes('_') && !name.startsWith('vscode')) {
            // Heuristic: tools with underscore from unknown sources are likely MCP
            const possibleServer = name.split('_')[0];
            return { type: 'mcp', server: possibleServer };
        }

        return { type: 'extension' };
    }

    private inferTags(name: string, description: string): string[] {
        const tags: string[] = [];
        const combined = (name + ' ' + description).toLowerCase();

        const tagKeywords: Record<string, string[]> = {
            'code': ['code', 'script', 'program', 'compile', 'lint'],
            'execute': ['execute', 'run', 'shell', 'terminal', 'command'],
            'search': ['search', 'find', 'query', 'lookup'],
            'web': ['web', 'http', 'url', 'internet', 'online'],
            'browse': ['browse', 'navigate', 'page', 'website'],
            'file': ['file', 'read', 'write', 'directory', 'path'],
            'document': ['document', 'markdown', 'report', 'create'],
            'git': ['git', 'commit', 'branch', 'pull request', 'pr', 'merge'],
            'security': ['security', 'vulnerability', 'scan', 'audit', 'threat'],
            'review': ['review', 'analyze', 'check', 'inspect'],
            'test': ['test', 'assert', 'spec', 'unit test', 'integration'],
            'database': ['database', 'sql', 'query', 'postgres', 'sqlite', 'mongo'],
            'browser': ['browser', 'playwright', 'puppeteer', 'selenium', 'screenshot'],
            'ui': ['ui', 'frontend', 'component', 'render', 'preview'],
            'api': ['api', 'rest', 'graphql', 'endpoint', 'request'],
            'docker': ['docker', 'container', 'kubernetes', 'k8s'],
            'fetch': ['fetch', 'download', 'scrape', 'extract'],
            'screenshot': ['screenshot', 'capture', 'image'],
            'playwright': ['playwright'],
        };

        for (const [tag, keywords] of Object.entries(tagKeywords)) {
            if (keywords.some(kw => combined.includes(kw))) {
                tags.push(tag);
            }
        }

        return tags;
    }
}
