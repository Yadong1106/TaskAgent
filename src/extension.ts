import * as vscode from 'vscode';
import { WorkforceParticipant } from './participant/workforce';
import { registerAllTools } from './tools';
import { BackendServer } from './server/backendServer';
import { TaskManager } from './core/taskManager';
import { AgentRegistry } from './core/agentRegistry';
import { MemoryModule } from './core/memory';
import { DataGenerator } from './core/dataGenerator';
import { FeedbackCollector } from './core/feedback';
import { RolePlayEngine } from './core/rolePlay';
import { TemplateManager } from './core/templateManager';
import { VisualizationPanel } from './webview/visualizationPanel';
import { ConsensusEngine } from './core/consensus';
import { SelfReflectionEngine } from './core/selfReflection';
import { ConversationCompressor } from './core/conversationCompressor';
import { AgentAnalytics } from './core/agentAnalytics';

let backendServer: BackendServer | undefined;
let memoryModule: MemoryModule | undefined;
let dataGenerator: DataGenerator | undefined;
let feedbackCollector: FeedbackCollector | undefined;
let rolePlayEngine: RolePlayEngine | undefined;
let templateManager: TemplateManager | undefined;
let consensusEngine: ConsensusEngine | undefined;
let selfReflectionEngine: SelfReflectionEngine | undefined;
let conversationCompressor: ConversationCompressor | undefined;
let agentAnalytics: AgentAnalytics | undefined;

// Export for use in other modules
export function getMemoryModule(): MemoryModule | undefined { return memoryModule; }
export function getDataGenerator(): DataGenerator | undefined { return dataGenerator; }
export function getFeedbackCollector(): FeedbackCollector | undefined { return feedbackCollector; }
export function getRolePlayEngine(): RolePlayEngine | undefined { return rolePlayEngine; }
export function getTemplateManager(): TemplateManager | undefined { return templateManager; }
export function getConsensusEngine(): ConsensusEngine | undefined { return consensusEngine; }
export function getSelfReflectionEngine(): SelfReflectionEngine | undefined { return selfReflectionEngine; }
export function getConversationCompressor(): ConversationCompressor | undefined { return conversationCompressor; }
export function getAgentAnalytics(): AgentAnalytics | undefined { return agentAnalytics; }

export async function activate(context: vscode.ExtensionContext) {
    console.log('TaskAgent is now active!');

    // Initialize core components
    const taskManager = new TaskManager();
    const agentRegistry = new AgentRegistry();
    
    // Initialize new modules (inspired by CAMEL framework)
    memoryModule = new MemoryModule(context);
    dataGenerator = new DataGenerator(context, memoryModule);
    feedbackCollector = new FeedbackCollector(memoryModule, dataGenerator);
    rolePlayEngine = new RolePlayEngine(memoryModule);
    templateManager = new TemplateManager(context);

    // Initialize advanced collaboration modules
    consensusEngine = new ConsensusEngine(agentRegistry);
    selfReflectionEngine = new SelfReflectionEngine(agentRegistry);
    conversationCompressor = new ConversationCompressor();
    agentAnalytics = new AgentAnalytics(agentRegistry, memoryModule);
    
    // Initialize backend server for browser automation and cross-app tasks
    backendServer = new BackendServer(taskManager, agentRegistry);
    
    // Register Chat Participant (pass new modules)
    const workforce = new WorkforceParticipant(
        taskManager,
        agentRegistry,
        backendServer,
        memoryModule,
        rolePlayEngine,
        feedbackCollector,
        templateManager,
        consensusEngine,
        selfReflectionEngine,
        conversationCompressor,
        agentAnalytics
    );
    const participant = vscode.chat.createChatParticipant('taskagent.taskagent', workforce.handleRequest.bind(workforce));
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
        }),

        vscode.commands.registerCommand('taskagent.openVisualization', () => {
            // Open task execution visualization panel
            VisualizationPanel.createOrShow(context.extensionUri, taskManager, agentRegistry);
        })
    );

    // Auto-start backend server (non-blocking to prevent activation hang)
    backendServer.start().then(() => {
        console.log('TaskAgent backend server started on port 3847');
    }).catch((error) => {
        console.warn('Failed to auto-start backend server:', error);
    });

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














