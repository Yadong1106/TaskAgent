import * as vscode from 'vscode';
import { WorkforceParticipant } from './participant/workforce';
import { registerAllTools } from './tools';
import { BackendServer } from './server/backendServer';
import { TaskManager } from './core/taskManager';
import { AgentRegistry } from './core/agentRegistry';

let backendServer: BackendServer | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('TaskAgent is now active!');

    // Initialize core components
    const taskManager = new TaskManager();
    const agentRegistry = new AgentRegistry();
    
    // Initialize backend server for browser automation and cross-app tasks
    backendServer = new BackendServer(taskManager, agentRegistry);
    
    // Register Chat Participant
    const workforce = new WorkforceParticipant(taskManager, agentRegistry, backendServer);
    const participant = vscode.chat.createChatParticipant('taskagent.workforce', workforce.handleRequest.bind(workforce));
    participant.iconPath = new vscode.ThemeIcon('robot');
    context.subscriptions.push(participant);

    // Register all Language Model Tools
    registerAllTools(context, taskManager, backendServer);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('taskagent.startServer', async () => {
            await backendServer?.start();
            vscode.window.showInformationMessage('TaskAgent backend server started');
        }),
        
        vscode.commands.registerCommand('taskagent.stopServer', async () => {
            await backendServer?.stop();
            vscode.window.showInformationMessage('TaskAgent backend server stopped');
        }),
        
        vscode.commands.registerCommand('TaskAgent.openDashboard', () => {
            // Open webview dashboard
            const panel = vscode.window.createWebviewPanel(
                'TaskAgentDashboard',
                'TaskAgent Dashboard',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = getDashboardHtml();
        })
    );

    // Auto-start backend server
    try {
        await backendServer.start();
        console.log('TaskAgent backend server started on port 3847');
    } catch (error) {
        console.warn('Failed to auto-start backend server:', error);
    }

    // Register tree views
    vscode.window.registerTreeDataProvider('taskagent.tasks', taskManager);
    vscode.window.registerTreeDataProvider('taskagent.agents', agentRegistry);
}

export function deactivate() {
    backendServer?.stop();
}

function getDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TaskAgent Dashboard</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .header { font-size: 24px; margin-bottom: 20px; }
        .section { margin-bottom: 30px; }
        .task-list { list-style: none; padding: 0; }
        .task-item {
            padding: 10px;
            margin: 5px 0;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
        }
        .status { display: inline-block; padding: 2px 8px; border-radius: 3px; }
        .status.running { background: #4CAF50; color: white; }
        .status.pending { background: #FF9800; color: white; }
        .status.completed { background: #2196F3; color: white; }
    </style>
</head>
<body>
    <div class="header">🤖 TaskAgent Workflow Dashboard</div>
    
    <div class="section">
        <h3>Active Tasks</h3>
        <ul class="task-list" id="taskList">
            <li class="task-item">
                <span class="status running">Running</span>
                No active tasks
            </li>
        </ul>
    </div>
    
    <div class="section">
        <h3>Agent Status</h3>
        <div id="agentStatus">
            <p>✅ Code Agent: Ready</p>
            <p>✅ Search Agent: Ready</p>
            <p>✅ Document Agent: Ready</p>
            <p>✅ Browser Agent: Ready</p>
        </div>
    </div>
</body>
</html>`;
}














