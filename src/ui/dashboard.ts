import * as vscode from 'vscode';
import { TaskManager } from '../core/taskManager';
import { AgentRegistry } from '../core/agentRegistry';
import { SkillRegistry } from '../core/skillRegistry';
import { WorkflowEngine } from '../core/workflowEngine';
import { AgentBus } from '../core/agentBus';
import { MemoryModule } from '../core/memory';
import { UsageTracker } from '../core/usageTracker';
import { McpBridge } from '../core/mcpBridge';

/**
 * DashboardPanel - Enhanced Webview Dashboard
 * 
 * Displays:
 * - Real-time task status
 * - Agent collaboration graph
 * - Skills list with toggle
 * - Workflow execution progress
 * - Agent communication log
 * - Usage statistics
 */
export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private static readonly viewType = 'taskagentDashboard';
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private refreshTimer?: NodeJS.Timeout;

    private constructor(
        panel: vscode.WebviewPanel,
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry,
        private skillRegistry: SkillRegistry,
        private workflowEngine: WorkflowEngine,
        private agentBus: AgentBus,
        private memory: MemoryModule,
        private usageTracker: UsageTracker,
        private mcpBridge?: McpBridge
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );
        this.update();

        // Auto-refresh every 3 seconds
        this.refreshTimer = setInterval(() => this.update(), 3000);
    }

    static createOrShow(
        extensionUri: vscode.Uri,
        taskManager: TaskManager,
        agentRegistry: AgentRegistry,
        skillRegistry: SkillRegistry,
        workflowEngine: WorkflowEngine,
        agentBus: AgentBus,
        memory: MemoryModule,
        usageTracker: UsageTracker,
        mcpBridge?: McpBridge
    ) {
        const column = vscode.ViewColumn.Two;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.panel.reveal(column);
            DashboardPanel.currentPanel.update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            DashboardPanel.viewType,
            'TaskAgent Dashboard',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(
            panel, taskManager, agentRegistry, skillRegistry, workflowEngine, agentBus, memory, usageTracker, mcpBridge
        );
    }

    private handleMessage(message: any) {
        switch (message.command) {
            case 'toggleSkill':
                this.skillRegistry.setSkillEnabled(message.skillId, message.enabled);
                this.update();
                break;
            case 'runWorkflow':
                this.workflowEngine.executeWorkflow(message.workflowId, message.inputs || {});
                this.update();
                break;
            case 'refresh':
                this.update();
                break;
        }
    }

    private async update() {
        if (this.panel.visible) {
            this.panel.webview.html = await this.getHtmlContent();
        }
    }

    private async getHtmlContent(): Promise<string> {
        // Gather data
        const tasks = this.taskManager.getAllTasks();
        const agents = this.agentRegistry.getAllAgents();
        const skills = this.skillRegistry.getAllSkills();
        const workflows = this.workflowEngine.getAllWorkflows();
        const executions = this.workflowEngine.getAllExecutions();
        const busStats = this.agentBus.getStats();
        const memStats = this.memory.getStats() as any;
        const recentMessages = this.agentBus.getHistory(20);

        // Usage tracking data
        const usageSummary = this.usageTracker.getSummary();
        const modelStats = this.usageTracker.getModelStats();
        const callerStats = this.usageTracker.getCallerStats();
        const recentCalls = this.usageTracker.getRecentCalls(25);
        const hourlyUsage = this.usageTracker.getHourlyUsage(24);

        // MCP / external tools data
        const toolsSummary = this.mcpBridge ? await this.mcpBridge.getToolsSummary() : { total: 0, taskagent: 0, mcp: 0, extension: 0, mcpServers: [], tools: [] };

        const runningTasks = tasks.filter((t: any) => t.status === 'running').length;
        const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
        const failedTasks = tasks.filter((t: any) => t.status === 'failed').length;
        const enabledAgents = agents.filter((a: any) => a.enabled).length;
        const enabledSkills = skills.filter(s => s.enabled).length;
        const activeExecs = executions.filter(e => e.status === 'running').length;

        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TaskAgent Dashboard</title>
    <style>
        :root {
            --bg: #1e1e1e;
            --bg-card: #252526;
            --bg-hover: #2a2d2e;
            --text: #cccccc;
            --text-muted: #888888;
            --accent: #0078d4;
            --accent-light: #1a8cff;
            --success: #4ec9b0;
            --warning: #dcdcaa;
            --error: #f44747;
            --border: #3c3c3c;
            --radius: 8px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg);
            color: var(--text);
            padding: 20px;
            line-height: 1.5;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border);
        }
        .header h1 {
            font-size: 22px;
            font-weight: 600;
            color: var(--accent-light);
        }
        .header .subtitle { color: var(--text-muted); font-size: 13px; }
        .btn {
            padding: 6px 14px;
            border: 1px solid var(--border);
            border-radius: 4px;
            background: var(--bg-card);
            color: var(--text);
            cursor: pointer;
            font-size: 12px;
        }
        .btn:hover { background: var(--accent); color: white; border-color: var(--accent); }
        .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }

        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
        }
        .stat-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 16px;
            text-align: center;
        }
        .stat-card .number {
            font-size: 28px;
            font-weight: 700;
            color: var(--accent-light);
        }
        .stat-card .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin-top: 4px;
        }
        .stat-card.success .number { color: var(--success); }
        .stat-card.warning .number { color: var(--warning); }
        .stat-card.error .number { color: var(--error); }

        /* Tabs */
        .tabs {
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--border);
            margin-bottom: 16px;
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            color: var(--text-muted);
            font-size: 13px;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }
        .tab:hover { color: var(--text); }
        .tab.active { color: var(--accent-light); border-bottom-color: var(--accent); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        /* Sections */
        .section {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 16px;
            margin-bottom: 16px;
        }
        .section h3 {
            font-size: 14px;
            margin-bottom: 12px;
            color: var(--accent-light);
        }

        /* Tables */
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 500; }
        td { padding: 8px; border-bottom: 1px solid var(--border); }
        tr:hover { background: var(--bg-hover); }

        /* Status badges */
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 500;
        }
        .badge.running { background: #0078d433; color: var(--accent-light); }
        .badge.completed { background: #4ec9b033; color: var(--success); }
        .badge.failed { background: #f4474733; color: var(--error); }
        .badge.pending { background: #dcdcaa33; color: var(--warning); }
        .badge.enabled { background: #4ec9b033; color: var(--success); }
        .badge.disabled { background: #88888833; color: var(--text-muted); }

        /* Toggle */
        .toggle {
            position: relative;
            display: inline-block;
            width: 36px;
            height: 20px;
        }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .toggle .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background: var(--border);
            border-radius: 10px;
            transition: 0.3s;
        }
        .toggle .slider:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 3px;
            bottom: 3px;
            background: white;
            border-radius: 50%;
            transition: 0.3s;
        }
        .toggle input:checked + .slider { background: var(--accent); }
        .toggle input:checked + .slider:before { transform: translateX(16px); }

        /* Message log */
        .msg-log {
            max-height: 300px;
            overflow-y: auto;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 12px;
        }
        .msg-entry { padding: 4px 8px; border-left: 3px solid var(--border); margin-bottom: 4px; }
        .msg-entry.request { border-left-color: var(--accent); }
        .msg-entry.response { border-left-color: var(--success); }
        .msg-entry.delegate { border-left-color: var(--warning); }
        .msg-entry.broadcast { border-left-color: #c586c0; }
        .msg-entry .time { color: var(--text-muted); font-size: 11px; }
        .msg-entry .from { color: var(--accent-light); }
        .msg-entry .to { color: var(--success); }

        /* Workflow cards */
        .workflow-card {
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 12px;
            margin-bottom: 8px;
        }
        .workflow-card h4 { font-size: 13px; margin-bottom: 4px; }
        .workflow-card .desc { color: var(--text-muted); font-size: 12px; }
        .workflow-card .meta { font-size: 11px; color: var(--text-muted); margin-top: 6px; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🤖 TaskAgent Dashboard</h1>
            <div class="subtitle">Multi-Agent AI Workflow Orchestrator</div>
        </div>
        <button class="btn" onclick="refresh()">↻ Refresh</button>
    </div>

    <!-- Stats Overview -->
    <div class="stats-grid">
        <div class="stat-card">
            <div class="number">${tasks.length}</div>
            <div class="label">Total Tasks</div>
        </div>
        <div class="stat-card success">
            <div class="number">${completedTasks}</div>
            <div class="label">Completed</div>
        </div>
        <div class="stat-card">
            <div class="number">${runningTasks}</div>
            <div class="label">Running</div>
        </div>
        <div class="stat-card error">
            <div class="number">${failedTasks}</div>
            <div class="label">Failed</div>
        </div>
        <div class="stat-card">
            <div class="number">${enabledAgents}/${agents.length}</div>
            <div class="label">Active Agents</div>
        </div>
        <div class="stat-card success">
            <div class="number">${enabledSkills}</div>
            <div class="label">Active Skills</div>
        </div>
        <div class="stat-card">
            <div class="number">${busStats.totalMessages}</div>
            <div class="label">Messages</div>
        </div>
        <div class="stat-card warning">
            <div class="number">${activeExecs}</div>
            <div class="label">Running Workflows</div>
        </div>
        <div class="stat-card" style="border-color:#c586c0">
            <div class="number" style="color:#c586c0">${UsageTracker.formatTokens(usageSummary.totalTokens)}</div>
            <div class="label">Total Tokens</div>
        </div>
        <div class="stat-card" style="border-color:#ce9178">
            <div class="number" style="color:#ce9178">${UsageTracker.formatCost(usageSummary.totalEstimatedCost)}</div>
            <div class="label">Est. Cost</div>
        </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
        <div class="tab active" onclick="switchTab('tasks')">📋 Tasks</div>
        <div class="tab" onclick="switchTab('agents')">🤖 Agents</div>
        <div class="tab" onclick="switchTab('skills')">🧩 Skills</div>
        <div class="tab" onclick="switchTab('workflows')">📋 Workflows</div>
        <div class="tab" onclick="switchTab('messages')">💬 Messages</div>
        <div class="tab" onclick="switchTab('usage')">📊 Token Usage</div>
        <div class="tab" onclick="switchTab('tools')">🔌 Tools & MCP</div>
        <div class="tab" onclick="switchTab('memory')">🧠 Memory</div>
    </div>

    <!-- Tasks Tab -->
    <div id="tab-tasks" class="tab-content active">
        <div class="section">
            <h3>Tasks</h3>
            <table>
                <tr><th>Name</th><th>Status</th><th>Progress</th><th>Subtasks</th></tr>
                ${tasks.map((t: any) => `
                <tr>
                    <td>${t.name}</td>
                    <td><span class="badge ${t.status}">${t.status}</span></td>
                    <td>${t.progress || 0}%</td>
                    <td>${t.subtasks?.length || 0}</td>
                </tr>`).join('')}
                ${tasks.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No tasks yet</td></tr>' : ''}
            </table>
        </div>
    </div>

    <!-- Agents Tab -->
    <div id="tab-agents" class="tab-content">
        <div class="section">
            <h3>Registered Agents</h3>
            <table>
                <tr><th>Agent</th><th>Status</th><th>Tools</th><th>Description</th></tr>
                ${agents.map((a: any) => `
                <tr>
                    <td><strong>${a.name}</strong> <small style="color:var(--text-muted)">${a.id}</small></td>
                    <td><span class="badge ${a.enabled ? 'enabled' : 'disabled'}">${a.enabled ? 'Active' : 'Inactive'}</span></td>
                    <td>${a.tools?.length || 0}</td>
                    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.description}</td>
                </tr>`).join('')}
            </table>
        </div>
    </div>

    <!-- Skills Tab -->
    <div id="tab-skills" class="tab-content">
        <div class="section">
            <h3>Skills Registry</h3>
            <table>
                <tr><th>Skill</th><th>Version</th><th>Tags</th><th>Enabled</th></tr>
                ${skills.map(s => `
                <tr>
                    <td>
                        <strong>${s.name}</strong><br>
                        <small style="color:var(--text-muted)">${s.description}</small>
                    </td>
                    <td>v${s.version}</td>
                    <td>${(s.tags || []).map(t => `<span class="badge pending">${t}</span>`).join(' ')}</td>
                    <td>
                        <label class="toggle">
                            <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleSkill('${s.id}', this.checked)">
                            <span class="slider"></span>
                        </label>
                    </td>
                </tr>`).join('')}
            </table>
        </div>
    </div>

    <!-- Workflows Tab -->
    <div id="tab-workflows" class="tab-content">
        <div class="section">
            <h3>Available Workflows</h3>
            ${workflows.map(w => `
            <div class="workflow-card">
                <h4>📋 ${w.name} <small style="color:var(--text-muted)">v${w.version}</small></h4>
                <div class="desc">${w.description}</div>
                <div class="meta">
                    Steps: ${w.steps.length} |
                    Inputs: ${(w.inputs || []).map(i => i.name).join(', ') || 'none'} |
                    Tags: ${(w.tags || []).join(', ') || 'none'}
                </div>
            </div>`).join('')}
        </div>
        ${executions.length > 0 ? `
        <div class="section">
            <h3>Execution History</h3>
            <table>
                <tr><th>Workflow</th><th>Status</th><th>Duration</th><th>Steps</th></tr>
                ${executions.slice(-10).reverse().map(e => {
                    const dur = e.endTime ? ((e.endTime - e.startTime) / 1000).toFixed(1) + 's' : 'running...';
                    return `<tr>
                        <td>${e.workflowName}</td>
                        <td><span class="badge ${e.status}">${e.status}</span></td>
                        <td>${dur}</td>
                        <td>${e.stepResults.size}</td>
                    </tr>`;
                }).join('')}
            </table>
        </div>` : ''}
    </div>

    <!-- Messages Tab -->
    <div id="tab-messages" class="tab-content">
        <div class="section">
            <h3>Agent Communication Log</h3>
            <div style="margin-bottom:8px;color:var(--text-muted);font-size:12px">
                Total: ${busStats.totalMessages} | Pending: ${busStats.pendingMessages} | 
                Delegations: ${busStats.activeDelegations}/${busStats.totalDelegations} | 
                Subscriptions: ${busStats.activeSubscriptions}
            </div>
            <div class="msg-log">
                ${recentMessages.map(m => {
                    const time = new Date(m.timestamp).toLocaleTimeString();
                    return `<div class="msg-entry ${m.type}">
                        <span class="time">${time}</span>
                        <span class="from">${m.fromAgent}</span> → <span class="to">${m.toAgent}</span>
                        [${m.type}] ${m.subject}
                    </div>`;
                }).join('')}
                ${recentMessages.length === 0 ? '<div style="text-align:center;color:var(--text-muted);padding:20px">No messages yet</div>' : ''}
            </div>
        </div>
    </div>

    <!-- Memory Tab -->
    <div id="tab-memory" class="tab-content">
        <div class="section">
            <h3>Memory Statistics</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="number">${memStats.shortTermCount || 0}</div>
                    <div class="label">Short-term</div>
                </div>
                <div class="stat-card">
                    <div class="number">${memStats.longTermCount || 0}</div>
                    <div class="label">Long-term</div>
                </div>
                <div class="stat-card">
                    <div class="number">${memStats.conversationSessions || 0}</div>
                    <div class="label">Conversations</div>
                </div>
            </div>
        </div>
    </div>

    <!-- Tools & MCP Tab -->
    <div id="tab-tools" class="tab-content">
        <div class="section">
            <h3>🔌 Tools Overview</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="number">${toolsSummary.total}</div>
                    <div class="label">Total Tools</div>
                </div>
                <div class="stat-card">
                    <div class="number">${toolsSummary.taskagent}</div>
                    <div class="label">TaskAgent Tools</div>
                </div>
                <div class="stat-card" style="border-color:#c586c0">
                    <div class="number" style="color:#c586c0">${toolsSummary.mcp}</div>
                    <div class="label">MCP Tools</div>
                </div>
                <div class="stat-card">
                    <div class="number">${toolsSummary.extension}</div>
                    <div class="label">Extension Tools</div>
                </div>
            </div>
            ${toolsSummary.mcpServers.length > 0 ? `
            <div style="margin-top:12px;color:var(--text-muted);font-size:12px">
                <strong>MCP Servers:</strong> ${toolsSummary.mcpServers.map(s => `<span class="badge pending">${s}</span>`).join(' ')}
            </div>` : ''}
        </div>

        ${toolsSummary.mcp > 0 ? `
        <div class="section">
            <h3>🌐 MCP Server Tools</h3>
            <table>
                <tr><th>Tool</th><th>Server</th><th>Description</th><th>Tags</th></tr>
                ${toolsSummary.tools.filter(t => t.source === 'mcp').map(t => `
                <tr>
                    <td><strong>${t.name}</strong></td>
                    <td><span class="badge pending">${t.serverName || '?'}</span></td>
                    <td style="max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description.slice(0, 100)}</td>
                    <td style="font-size:11px">${t.tags.slice(0, 4).map(tag => `<span class="badge running">${tag}</span>`).join(' ')}</td>
                </tr>`).join('')}
            </table>
        </div>` : `
        <div class="section">
            <h3>🌐 MCP Server Tools</h3>
            <div style="text-align:center;color:var(--text-muted);padding:20px">
                No MCP servers configured.<br><br>
                Add MCP servers in <code>.vscode/mcp.json</code> or via<br>
                <code>Ctrl+Shift+P → MCP: Add Server</code><br><br>
                Example: <code>{ "servers": { "playwright": { "command": "npx", "args": ["-y", "@microsoft/mcp-server-playwright"] } } }</code>
            </div>
        </div>`}

        <div class="section">
            <h3>🛠️ TaskAgent Built-in Tools (${toolsSummary.taskagent})</h3>
            <table>
                <tr><th>Tool</th><th>Tags</th><th>Description</th></tr>
                ${toolsSummary.tools.filter(t => t.source === 'taskagent').map(t => `
                <tr>
                    <td><strong>${t.name.replace('taskagent_', '')}</strong></td>
                    <td style="font-size:11px">${t.tags.slice(0, 3).map(tag => `<span class="badge completed">${tag}</span>`).join(' ')}</td>
                    <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description.slice(0, 120)}</td>
                </tr>`).join('')}
            </table>
        </div>

        ${toolsSummary.extension > 0 ? `
        <div class="section">
            <h3>🧩 Other Extension Tools (${toolsSummary.extension})</h3>
            <table>
                <tr><th>Tool</th><th>Description</th><th>Tags</th></tr>
                ${toolsSummary.tools.filter(t => t.source === 'extension').map(t => `
                <tr>
                    <td><strong>${t.name}</strong></td>
                    <td style="max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description.slice(0, 100)}</td>
                    <td style="font-size:11px">${t.tags.slice(0, 3).map(tag => `<span class="badge disabled">${tag}</span>`).join(' ')}</td>
                </tr>`).join('')}
            </table>
        </div>` : ''}
    </div>

    <!-- Token Usage Tab -->
    <div id="tab-usage" class="tab-content">
        <!-- Usage Overview -->
        <div class="section">
            <h3>📊 Session Usage Overview</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="number">${usageSummary.totalCalls}</div>
                    <div class="label">Total LLM Calls</div>
                </div>
                <div class="stat-card" style="border-color:#c586c0">
                    <div class="number" style="color:#c586c0">${UsageTracker.formatTokens(usageSummary.totalTokens)}</div>
                    <div class="label">Total Tokens</div>
                </div>
                <div class="stat-card">
                    <div class="number" style="color:#569cd6">${UsageTracker.formatTokens(usageSummary.totalInput)}</div>
                    <div class="label">Input Tokens</div>
                </div>
                <div class="stat-card">
                    <div class="number" style="color:#4ec9b0">${UsageTracker.formatTokens(usageSummary.totalOutput)}</div>
                    <div class="label">Output Tokens</div>
                </div>
                <div class="stat-card">
                    <div class="number" style="color:#ce9178">${UsageTracker.formatCost(usageSummary.totalEstimatedCost)}</div>
                    <div class="label">Est. Total Cost</div>
                </div>
                <div class="stat-card">
                    <div class="number">${usageSummary.successRate}%</div>
                    <div class="label">Success Rate</div>
                </div>
                <div class="stat-card">
                    <div class="number">${UsageTracker.formatDuration(usageSummary.avgDuration)}</div>
                    <div class="label">Avg Latency</div>
                </div>
                <div class="stat-card">
                    <div class="number">${usageSummary.uniqueModels}</div>
                    <div class="label">Models Used</div>
                </div>
            </div>
        </div>

        <!-- Per-Model Breakdown -->
        <div class="section">
            <h3>🤖 Per-Model Token Usage</h3>
            ${modelStats.length > 0 ? `
            <table>
                <tr>
                    <th>Model</th>
                    <th>Calls</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                    <th>Total Tokens</th>
                    <th>Avg Latency</th>
                    <th>Est. Cost</th>
                    <th>Usage Bar</th>
                </tr>
                ${modelStats.map(m => {
                    const maxTokens = modelStats[0]?.totalTokens || 1;
                    const barWidth = Math.round((m.totalTokens / maxTokens) * 100);
                    return `
                <tr>
                    <td>
                        <strong>${m.modelId}</strong><br>
                        <small style="color:var(--text-muted)">${m.modelFamily}</small>
                    </td>
                    <td>${m.callCount} <small style="color:var(--text-muted)">(${m.failureCount} fail)</small></td>
                    <td>${UsageTracker.formatTokens(m.totalInputTokens)}</td>
                    <td>${UsageTracker.formatTokens(m.totalOutputTokens)}</td>
                    <td><strong>${UsageTracker.formatTokens(m.totalTokens)}</strong></td>
                    <td>${UsageTracker.formatDuration(m.avgDuration)}</td>
                    <td style="color:#ce9178">${UsageTracker.formatCost(m.estimatedCost)}</td>
                    <td style="width:150px">
                        <div style="background:var(--border);border-radius:4px;height:16px;overflow:hidden">
                            <div style="background:linear-gradient(90deg,#0078d4,#c586c0);height:100%;width:${barWidth}%;border-radius:4px;transition:width 0.3s"></div>
                        </div>
                    </td>
                </tr>`;
                }).join('')}
            </table>` : '<div style="text-align:center;color:var(--text-muted);padding:20px">No LLM calls recorded yet. Start using @taskagent to see usage data.</div>'}
        </div>

        <!-- Per-Caller Breakdown -->
        ${callerStats.length > 0 ? `
        <div class="section">
            <h3>📍 Per-Component Usage</h3>
            <table>
                <tr><th>Component</th><th>Calls</th><th>Total Tokens</th><th>Duration</th><th>Model Breakdown</th></tr>
                ${callerStats.map(c => `
                <tr>
                    <td><strong>${c.caller}</strong></td>
                    <td>${c.callCount}</td>
                    <td>${UsageTracker.formatTokens(c.totalTokens)}</td>
                    <td>${UsageTracker.formatDuration(c.totalDuration)}</td>
                    <td style="font-size:11px">
                        ${c.modelBreakdown.map(b => 
                            `<span class="badge pending">${b.modelId}: ${UsageTracker.formatTokens(b.tokens)} (${b.calls})</span>`
                        ).join(' ')}
                    </td>
                </tr>`).join('')}
            </table>
        </div>` : ''}

        <!-- Hourly Usage Chart (ASCII bar chart) -->
        ${hourlyUsage.length > 0 ? `
        <div class="section">
            <h3>📈 Hourly Usage (last 24h)</h3>
            <div style="font-family:'Consolas','Courier New',monospace;font-size:12px;overflow-x:auto">
                ${(() => {
                    const maxTokens = Math.max(...hourlyUsage.map(h => h.tokens), 1);
                    return hourlyUsage.map(h => {
                        const barLen = Math.round((h.tokens / maxTokens) * 40);
                        const bar = '█'.repeat(barLen) + '░'.repeat(40 - barLen);
                        return `<div style="white-space:nowrap;margin:1px 0">
                            <span style="color:var(--text-muted);display:inline-block;width:100px">${h.hour}</span>
                            <span style="color:#c586c0">${bar}</span>
                            <span style="color:var(--text-muted)"> ${UsageTracker.formatTokens(h.tokens)} (${h.calls} calls)</span>
                        </div>`;
                    }).join('');
                })()}
            </div>
        </div>` : ''}

        <!-- Recent Call Log -->
        ${recentCalls.length > 0 ? `
        <div class="section">
            <h3>📝 Recent LLM Calls</h3>
            <div class="msg-log">
                ${recentCalls.map(c => {
                    const time = new Date(c.timestamp).toLocaleTimeString();
                    const statusIcon = c.success ? '✅' : '❌';
                    return `<div class="msg-entry ${c.success ? 'response' : 'request'}">
                        <span class="time">${time}</span>
                        ${statusIcon}
                        <span class="from">${c.caller}</span>
                        → <strong>${c.modelFamily}</strong>
                        | ${UsageTracker.formatTokens(c.inputTokens)} in / ${UsageTracker.formatTokens(c.outputTokens)} out
                        | ${UsageTracker.formatDuration(c.duration)}
                        <br><small style="color:var(--text-muted);margin-left:60px">${c.purpose}</small>
                    </div>`;
                }).join('')}
            </div>
        </div>` : ''}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function switchTab(tabName) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.add('active');
            event.target.classList.add('active');
        }

        function toggleSkill(skillId, enabled) {
            vscode.postMessage({ command: 'toggleSkill', skillId, enabled });
        }

        function runWorkflow(workflowId) {
            vscode.postMessage({ command: 'runWorkflow', workflowId });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
    </script>
</body>
</html>`;
    }

    dispose() {
        DashboardPanel.currentPanel = undefined;
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
