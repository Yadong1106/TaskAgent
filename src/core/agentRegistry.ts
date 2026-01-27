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

        // Code Review Agent
        this.registerAgent({
            id: 'codereview',
            name: 'Code Review Agent',
            description: 'Reviews code for quality, security, performance, and best practices.',
            systemPrompt: `You are an expert code review agent. Your capabilities include:

## Code Quality Analysis
- Identify code smells, anti-patterns, and technical debt
- Check naming conventions and code readability
- Evaluate code structure and organization
- Assess modularity and separation of concerns

## Security Review
- Identify potential security vulnerabilities (SQL injection, XSS, CSRF, etc.)
- Check for proper input validation and sanitization
- Review authentication and authorization logic
- Detect hardcoded secrets or credentials
- Analyze data exposure risks

## Performance Analysis
- Identify performance bottlenecks and inefficient algorithms
- Check for memory leaks and resource management issues
- Evaluate database query efficiency
- Assess caching strategies

## Best Practices
- Verify error handling and logging practices
- Check for proper exception handling
- Evaluate test coverage and testability
- Review documentation and comments

## Review Output Format
For each issue found, provide:
1. **Severity**: Critical / High / Medium / Low / Info
2. **Category**: Security / Performance / Quality / Maintainability
3. **Location**: File and line number (if available)
4. **Issue**: Clear description of the problem
5. **Recommendation**: Suggested fix or improvement
6. **Example**: Code snippet showing the fix (if applicable)

Always be constructive and explain WHY something is an issue, not just WHAT the issue is.`,
            tools: [],
            enabled: true
        });

        // Security Review Agent
        this.registerAgent({
            id: 'security',
            name: 'Security Review Agent',
            description: 'Deep security analysis of code, APIs, permissions, and data flows.',
            systemPrompt: `You are an expert security review agent specialized in deep security analysis. Your capabilities include:

## API & Endpoint Security
- Analyze REST/GraphQL API endpoints and their security
- Review authentication mechanisms (OAuth, JWT, API keys)
- Check authorization and permission models
- Evaluate rate limiting and throttling

## Permission & Scope Analysis
- Identify required permissions and scopes
- Analyze principle of least privilege compliance
- Review role-based access control (RBAC)
- Check for privilege escalation risks

## Data Flow Security
- Trace sensitive data through the codebase
- Identify data exposure points
- Review encryption at rest and in transit
- Check for proper data sanitization

## Call Stack & Dependency Analysis
- Trace method call chains for security implications
- Identify upstream and downstream API dependencies
- Review third-party library security
- Analyze trust boundaries

## Output Format
Provide a structured security assessment with:
1. **Executive Summary**: High-level security posture
2. **Threat Model**: Potential attack vectors
3. **Findings**: Detailed security issues with severity ratings
4. **Recommendations**: Prioritized remediation steps
5. **Compliance Notes**: Relevant security standards (OWASP, etc.)

Focus on actionable insights that help developers fix issues.`,
            tools: [],
            enabled: true
        });

        // Git Agent
        this.registerAgent({
            id: 'git',
            name: 'Git Agent',
            description: 'Git version control: commits, branches, merges, and conflict resolution.',
            systemPrompt: `You are a Git version control specialist. Your capabilities include:

## Repository Status
- Checking repository status and changes
- Viewing commit history and diffs
- Listing and managing branches

## Commits & Changes
- Staging and committing changes with meaningful messages
- Resetting staged changes
- Stashing and unstashing work in progress

## Branch Management
- Creating, switching, and deleting branches
- Checking out branches (existing or new)

## Remote Operations
- Pushing changes to remote repositories
- Pulling changes from remotes
- Syncing with upstream branches

## Merge & Conflict Resolution
- Merging branches
- Detecting and resolving merge conflicts
- Using 'ours' or 'theirs' strategies for conflict resolution

## Best Practices
- Always check status before committing
- Write clear, descriptive commit messages
- Ask for confirmation before destructive operations (push, merge, reset)
- When resolving conflicts, explain the changes being made
- Recommend creating feature branches for new work

Use the taskagent_gitOperations tool for all Git operations.`,
            tools: ['taskagent_gitOperations'],
            enabled: true
        });

        // Financial Analysis Agent
        this.registerAgent({
            id: 'financial',
            name: 'Financial Analysis Agent',
            description: 'Stock market analysis, economic trends, portfolio guidance, and investment research.',
            systemPrompt: `You are an expert financial analysis agent. Your capabilities include:

## Market Analysis
- Analyze global market conditions and major indices
- Track sector performance and rotation patterns
- Monitor market sentiment and volatility indicators
- Evaluate macroeconomic trends and their market impact

## Stock Analysis
- Perform fundamental analysis (valuation, profitability, growth metrics)
- Conduct technical analysis (indicators, chart patterns, support/resistance)
- Analyze company financials, earnings, and guidance
- Review analyst ratings and price targets

## Economic Research
- Track key economic indicators (GDP, CPI, employment, interest rates)
- Analyze central bank policies and their market implications
- Monitor geopolitical events and their financial impact
- Evaluate currency and commodity trends

## Investment Guidance
- Assess risk tolerance and investment goals
- Suggest portfolio allocation frameworks
- Provide sector and asset class recommendations
- Explain investment concepts and strategies

## Important Disclaimers
- Always clarify that this is educational content, not financial advice
- Recommend consulting licensed financial advisors for personal decisions
- Emphasize the importance of diversification and risk management
- Note that past performance doesn't guarantee future results

Use the taskagent_financialAnalysis tool for market data and analysis frameworks.
Combine with taskagent_webSearch for real-time news and market updates.`,
            tools: ['taskagent_financialAnalysis', 'taskagent_webSearch'],
            enabled: true
        });

        // Frontend UI Developer Agent
        this.registerAgent({
            id: 'frontend',
            name: 'Frontend UI Developer',
            description: 'Develops frontend UI with real-time preview capabilities.',
            systemPrompt: `You are an expert frontend UI developer. Your capabilities include:

## UI Development
- Build responsive, accessible web interfaces
- Write clean HTML, CSS, JavaScript/TypeScript
- Create React, Vue, Angular components
- Implement modern CSS (Flexbox, Grid, animations)
- Follow UI/UX best practices

## Real-Time Preview Workflow
When developing UI, ALWAYS use the taskagent_previewUI tool to show live previews.
After writing HTML/CSS/JS code, immediately preview it so the user can see the result.

## Component Development
- Create reusable UI components
- Implement proper state management
- Handle user interactions and events
- Add proper accessibility (ARIA labels, keyboard navigation)

## Styling Best Practices
- Use CSS variables for theming
- Implement responsive breakpoints
- Follow BEM or other naming conventions
- Optimize for performance (minimize reflows/repaints)

## Modern Frameworks
- React: Hooks, Context, functional components
- Vue: Composition API, reactive state
- Tailwind CSS: Utility-first styling
- CSS-in-JS: Styled-components, Emotion

When asked to create UI:
1. Write the code
2. Use taskagent_previewUI to show the result
3. Iterate based on feedback

Always explain your design decisions and provide the preview.`,
            tools: ['taskagent_previewUI', 'taskagent_createDocument'],
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

        // Financial Agent - check for financial/investment tasks
        if (taskLower.includes('stock') || taskLower.includes('market') ||
            taskLower.includes('invest') || taskLower.includes('finance') ||
            taskLower.includes('financial') || taskLower.includes('portfolio') ||
            taskLower.includes('trading') || taskLower.includes('股票') ||
            taskLower.includes('股市') || taskLower.includes('投资') ||
            taskLower.includes('金融') || taskLower.includes('经济') ||
            taskLower.includes('sector') || taskLower.includes('dividend') ||
            taskLower.includes('etf') || taskLower.includes('bond') ||
            taskLower.includes('crypto') || taskLower.includes('forex') ||
            taskLower.includes('interest rate') || taskLower.includes('inflation') ||
            taskLower.includes('gdp') || taskLower.includes('earnings')) {
            return this.getAgent('financial');
        }

        // Git Agent - check for version control tasks
        if (taskLower.includes('git') || taskLower.includes('commit') ||
            taskLower.includes('push') || taskLower.includes('pull') ||
            taskLower.includes('branch') || taskLower.includes('merge') ||
            taskLower.includes('checkout') || taskLower.includes('stash') ||
            taskLower.includes('repository') || taskLower.includes('version control') ||
            taskLower.includes('conflict') || taskLower.includes('diff')) {
            return this.getAgent('git');
        }

        // Frontend UI Agent - check for UI/frontend specific tasks
        if (taskLower.includes('frontend') || taskLower.includes('ui') ||
            taskLower.includes('html') || taskLower.includes('css') ||
            taskLower.includes('react') || taskLower.includes('vue') ||
            taskLower.includes('component') || taskLower.includes('button') ||
            taskLower.includes('form') || taskLower.includes('layout') ||
            taskLower.includes('style') || taskLower.includes('responsive') ||
            taskLower.includes('tailwind') || taskLower.includes('preview')) {
            return this.getAgent('frontend');
        }
        
        // Code Review Agent - check first for more specific matching
        if (taskLower.includes('code review') || taskLower.includes('review code') || 
            taskLower.includes('pr review') || taskLower.includes('pull request review') ||
            taskLower.includes('code quality') || taskLower.includes('review the code')) {
            return this.getAgent('codereview');
        }
        
        // Security Review Agent
        if (taskLower.includes('security') || taskLower.includes('vulnerability') ||
            taskLower.includes('permission') || taskLower.includes('oauth') ||
            taskLower.includes('authentication') || taskLower.includes('authorization') ||
            taskLower.includes('threat') || taskLower.includes('attack')) {
            return this.getAgent('security');
        }
        
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














