import * as vscode from 'vscode';
import { TaskManager, Task, SubTask } from '../core/taskManager';
import { AgentRegistry, AgentConfig } from '../core/agentRegistry';

/**
 * Task visualization data structure
 */
export interface TaskVisualizationData {
    task: {
        id: string;
        name: string;
        status: string;
        progress: number;
        createdAt: number;
        updatedAt: number;
    };
    subtasks: {
        id: string;
        name: string;
        agentId: string;
        status: string;
        dependencies: string[];
        startTime?: number;
        endTime?: number;
        output?: string;
    }[];
    agents: {
        id: string;
        name: string;
        status: 'idle' | 'busy';
        currentTaskId?: string;
    }[];
}

/**
 * Message types for webview communication
 */
export interface VisualizationMessage {
    type: 'taskUpdate' | 'subtaskUpdate' | 'agentUpdate' | 'fullRefresh' | 'noTask';
    data?: TaskVisualizationData | Partial<TaskVisualizationData>;
}

/**
 * VisualizationPanel - Real-time task execution visualization
 * Shows agent collaboration as flowcharts and Gantt charts
 */
export class VisualizationPanel {
    private static currentPanel: VisualizationPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private currentTaskId: string | undefined;

    private constructor(
        panel: vscode.WebviewPanel,
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getWebviewContent();

        // Listen for task updates
        const taskUpdateDisposable = this.taskManager.onTaskUpdate((task) => {
            this.currentTaskId = task.id;
            this.sendUpdate({
                type: 'taskUpdate',
                data: this.formatTaskData(task)
            });
        });
        this.disposables.push(taskUpdateDisposable);

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            (message) => this.handleMessage(message),
            null,
            this.disposables
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Send initial data
        this.sendFullRefresh();
    }

    /**
     * Create or show the visualization panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        taskManager: TaskManager,
        agentRegistry: AgentRegistry
    ): VisualizationPanel {
        const column = vscode.ViewColumn.Two;

        // If panel already exists, reveal it
        if (VisualizationPanel.currentPanel) {
            VisualizationPanel.currentPanel.panel.reveal(column);
            VisualizationPanel.currentPanel.sendFullRefresh();
            return VisualizationPanel.currentPanel;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'taskAgentVisualization',
            'Task Execution Visualization',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        VisualizationPanel.currentPanel = new VisualizationPanel(
            panel,
            taskManager,
            agentRegistry
        );

        return VisualizationPanel.currentPanel;
    }

    /**
     * Send update message to webview
     */
    private sendUpdate(message: VisualizationMessage) {
        this.panel.webview.postMessage(message);
    }

    /**
     * Format task data for visualization
     */
    private formatTaskData(task: Task): TaskVisualizationData {
        return {
            task: {
                id: task.id,
                name: task.name,
                status: task.status,
                progress: task.progress,
                createdAt: task.createdAt.getTime(),
                updatedAt: task.updatedAt.getTime()
            },
            subtasks: task.subtasks.map((st, index) => ({
                id: st.id,
                name: st.name,
                agentId: st.agentId,
                status: st.status,
                dependencies: [],  // Would need to track in TaskManager
                output: st.output?.toString().slice(0, 500)
            })),
            agents: this.agentRegistry.getEnabledAgents().map(a => ({
                id: a.id,
                name: a.name,
                status: 'idle' as const
            }))
        };
    }

    /**
     * Handle messages from webview
     */
    private handleMessage(message: any) {
        switch (message.command) {
            case 'getSubtaskDetails':
                this.sendSubtaskDetails(message.subtaskId);
                break;
            case 'refresh':
                this.sendFullRefresh();
                break;
        }
    }

    /**
     * Send subtask details to webview
     */
    private sendSubtaskDetails(subtaskId: string) {
        // Find subtask across all tasks
        const tasks = this.taskManager.getAllTasks();
        for (const task of tasks) {
            const subtask = task.subtasks.find((st: SubTask) => st.id === subtaskId);
            if (subtask) {
                this.panel.webview.postMessage({
                    type: 'subtaskDetails',
                    data: {
                        id: subtask.id,
                        name: subtask.name,
                        agentId: subtask.agentId,
                        status: subtask.status,
                        output: subtask.output
                    }
                });
                return;
            }
        }
    }

    /**
     * Send full refresh with current state
     */
    private sendFullRefresh() {
        const tasks = this.taskManager.getAllTasks();

        if (tasks.length === 0) {
            this.sendUpdate({ type: 'noTask' });
            return;
        }

        // Get the most recent active task
        const activeTask = tasks.find(t => t.status === 'running') || tasks[0];

        this.sendUpdate({
            type: 'fullRefresh',
            data: this.formatTaskData(activeTask)
        });
    }

    /**
     * Generate webview HTML content
     */
    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Execution Visualization</title>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h2 {
            margin: 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .task-info {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .task-info h3 {
            margin: 0 0 8px 0;
            font-size: 16px;
        }
        .task-info .status-line {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 8px;
        }
        .progress-bar {
            height: 8px;
            background: var(--vscode-progressBar-background);
            border-radius: 4px;
            overflow: hidden;
            margin-top: 8px;
        }
        .progress-fill {
            height: 100%;
            background: var(--vscode-progressBar-foreground, #0078d4);
            transition: width 0.3s ease;
        }
        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }
        .tab {
            padding: 8px 16px;
            background: var(--vscode-button-secondaryBackground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: var(--vscode-foreground);
            font-size: 13px;
        }
        .tab:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .tab.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .visualization-container {
            min-height: 300px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            overflow: auto;
        }
        .mermaid {
            background: #fff;
            padding: 16px;
            border-radius: 4px;
            min-height: 200px;
        }
        .subtask-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .subtask-item {
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.2s;
        }
        .subtask-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .subtask-info {
            flex: 1;
        }
        .subtask-info strong {
            display: block;
            margin-bottom: 4px;
        }
        .subtask-info small {
            color: var(--vscode-descriptionForeground);
        }
        .status-badge {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        .status-pending { background: #6c757d; color: white; }
        .status-running {
            background: #0d6efd;
            color: white;
            animation: pulse 1.5s infinite;
        }
        .status-completed { background: #198754; color: white; }
        .status-failed { background: #dc3545; color: white; }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }

        .detail-panel {
            position: fixed;
            right: 0;
            top: 0;
            width: 350px;
            height: 100%;
            background: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            padding: 16px;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            overflow-y: auto;
            z-index: 100;
        }
        .detail-panel.open {
            transform: translateX(0);
        }
        .detail-panel .close-btn {
            position: absolute;
            top: 12px;
            right: 12px;
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 18px;
            padding: 4px 8px;
        }
        .detail-panel .close-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            border-radius: 4px;
        }
        .detail-panel h3 {
            margin: 0 0 16px 0;
            padding-right: 30px;
        }
        .detail-content {
            margin-top: 16px;
        }
        .detail-content pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            font-size: 12px;
            max-height: 300px;
            overflow-y: auto;
        }
        .no-task {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .no-task h3 {
            margin-bottom: 8px;
        }
        .refresh-btn {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: var(--vscode-foreground);
            font-size: 12px;
        }
        .refresh-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .agent-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px;
            margin-top: 16px;
        }
        .agent-card {
            padding: 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 6px;
            text-align: center;
        }
        .agent-card .agent-icon {
            font-size: 24px;
            margin-bottom: 8px;
        }
        .agent-card .agent-name {
            font-weight: 500;
            font-size: 13px;
        }
        .agent-card .agent-status {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .hidden {
            display: none !important;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>
            <span>Task Execution Visualization</span>
        </h2>
        <button class="refresh-btn" onclick="refresh()">Refresh</button>
    </div>

    <div id="noTaskMessage" class="no-task hidden">
        <h3>No Active Task</h3>
        <p>Start a task using @taskagent to see the visualization.</p>
    </div>

    <div id="mainContent">
        <div class="task-info" id="taskInfo">
            <h3 id="taskName">Loading...</h3>
            <div class="status-line">
                <span>Status: <span id="taskStatus">-</span></span>
                <span id="progressText">0%</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            </div>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="showView('flowchart')">Agent Flowchart</button>
            <button class="tab" onclick="showView('list')">Subtask List</button>
            <button class="tab" onclick="showView('agents')">Agents</button>
        </div>

        <div class="visualization-container">
            <div id="flowchartView">
                <div class="mermaid" id="flowchartDiagram"></div>
            </div>
            <div id="listView" class="hidden">
                <div class="subtask-list" id="subtaskList"></div>
            </div>
            <div id="agentsView" class="hidden">
                <div class="agent-grid" id="agentGrid"></div>
            </div>
        </div>
    </div>

    <div class="detail-panel" id="detailPanel">
        <button class="close-btn" onclick="closeDetail()">x</button>
        <h3 id="detailTitle">Subtask Details</h3>
        <div class="detail-content" id="detailContent"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentData = null;
        let currentView = 'flowchart';

        // Initialize Mermaid
        mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis'
            }
        });

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'taskUpdate':
                case 'fullRefresh':
                    currentData = message.data;
                    showMainContent(true);
                    updateUI();
                    break;
                case 'noTask':
                    showMainContent(false);
                    break;
                case 'subtaskDetails':
                    showSubtaskDetailPanel(message.data);
                    break;
            }
        });

        function showMainContent(show) {
            document.getElementById('noTaskMessage').classList.toggle('hidden', show);
            document.getElementById('mainContent').classList.toggle('hidden', !show);
        }

        function updateUI() {
            if (!currentData) return;

            // Update task info
            document.getElementById('taskName').textContent = currentData.task.name;
            document.getElementById('taskStatus').textContent = currentData.task.status;
            document.getElementById('taskStatus').className = 'status-badge status-' + currentData.task.status;
            document.getElementById('progressFill').style.width = currentData.task.progress + '%';
            document.getElementById('progressText').textContent = currentData.task.progress + '% complete';

            // Update views
            updateFlowchart();
            updateList();
            updateAgents();
        }

        function updateFlowchart() {
            if (!currentData || !currentData.subtasks || currentData.subtasks.length === 0) {
                document.getElementById('flowchartDiagram').innerHTML = '<p>No subtasks to display</p>';
                return;
            }

            let diagram = 'flowchart TB\\n';

            // Add nodes
            currentData.subtasks.forEach((st, i) => {
                const shortName = st.name.substring(0, 25) + (st.name.length > 25 ? '...' : '');
                const safeLabel = shortName.replace(/"/g, "'");
                diagram += '    S' + i + '["' + st.agentId + ': ' + safeLabel + '"]\\n';
            });

            // Add edges based on index (sequential)
            for (let i = 1; i < currentData.subtasks.length; i++) {
                diagram += '    S' + (i-1) + ' --> S' + i + '\\n';
            }

            // Add styling
            diagram += '    classDef pending fill:#6c757d,color:#fff\\n';
            diagram += '    classDef running fill:#0d6efd,color:#fff\\n';
            diagram += '    classDef completed fill:#198754,color:#fff\\n';
            diagram += '    classDef failed fill:#dc3545,color:#fff\\n';

            // Apply classes
            currentData.subtasks.forEach((st, i) => {
                diagram += '    class S' + i + ' ' + st.status + '\\n';
            });

            const container = document.getElementById('flowchartDiagram');

            try {
                mermaid.render('flowchartSvg', diagram).then(result => {
                    container.innerHTML = result.svg;
                }).catch(err => {
                    console.error('Mermaid error:', err);
                    container.innerHTML = '<p>Error rendering flowchart</p>';
                });
            } catch (err) {
                console.error('Mermaid error:', err);
                container.innerHTML = '<p>Error rendering flowchart</p>';
            }
        }

        function updateList() {
            if (!currentData) return;

            const list = document.getElementById('subtaskList');
            list.innerHTML = currentData.subtasks.map((st, i) =>
                '<div class="subtask-item" onclick="showSubtaskDetail(\\'' + st.id + '\\')">' +
                '    <div class="subtask-info">' +
                '        <strong>' + (i + 1) + '. ' + escapeHtml(st.name) + '</strong>' +
                '        <small>Agent: ' + st.agentId + '</small>' +
                '    </div>' +
                '    <span class="status-badge status-' + st.status + '">' + st.status + '</span>' +
                '</div>'
            ).join('');
        }

        function updateAgents() {
            if (!currentData || !currentData.agents) return;

            const grid = document.getElementById('agentGrid');
            grid.innerHTML = currentData.agents.map(agent =>
                '<div class="agent-card">' +
                '    <div class="agent-icon">&#129302;</div>' +
                '    <div class="agent-name">' + escapeHtml(agent.name) + '</div>' +
                '    <div class="agent-status">' + agent.status + '</div>' +
                '</div>'
            ).join('');
        }

        function showView(view) {
            currentView = view;

            // Update tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');

            // Show/hide views
            document.getElementById('flowchartView').classList.toggle('hidden', view !== 'flowchart');
            document.getElementById('listView').classList.toggle('hidden', view !== 'list');
            document.getElementById('agentsView').classList.toggle('hidden', view !== 'agents');
        }

        function showSubtaskDetail(subtaskId) {
            vscode.postMessage({ command: 'getSubtaskDetails', subtaskId: subtaskId });

            const subtask = currentData?.subtasks.find(s => s.id === subtaskId);
            if (subtask) {
                showSubtaskDetailPanel(subtask);
            }
        }

        function showSubtaskDetailPanel(subtask) {
            document.getElementById('detailTitle').textContent = subtask.name;
            document.getElementById('detailContent').innerHTML =
                '<p><strong>Agent:</strong> ' + subtask.agentId + '</p>' +
                '<p><strong>Status:</strong> <span class="status-badge status-' + subtask.status + '">' + subtask.status + '</span></p>' +
                '<h4>Output:</h4>' +
                '<pre>' + escapeHtml(subtask.output || 'No output yet') + '</pre>';
            document.getElementById('detailPanel').classList.add('open');
        }

        function closeDetail() {
            document.getElementById('detailPanel').classList.remove('open');
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Request initial data
        refresh();
    </script>
</body>
</html>`;
    }

    /**
     * Dispose the panel
     */
    public dispose() {
        VisualizationPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
