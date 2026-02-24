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
import { EmbeddingService } from './core/embedding';
import { SkillRegistry } from './core/skillRegistry';
import { AgentBus } from './core/agentBus';
import { WorkflowEngine } from './core/workflowEngine';
import { UsageTracker } from './core/usageTracker';
import { DashboardPanel } from './ui/dashboard';

let backendServer: BackendServer | undefined;
let memoryModule: MemoryModule | undefined;
let dataGenerator: DataGenerator | undefined;
let feedbackCollector: FeedbackCollector | undefined;
let rolePlayEngine: RolePlayEngine | undefined;
let embeddingService: EmbeddingService | undefined;
let skillRegistry: SkillRegistry | undefined;
let agentBus: AgentBus | undefined;
let workflowEngine: WorkflowEngine | undefined;
let usageTracker: UsageTracker | undefined;

// Export for use in other modules
export function getMemoryModule(): MemoryModule | undefined { return memoryModule; }
export function getDataGenerator(): DataGenerator | undefined { return dataGenerator; }
export function getFeedbackCollector(): FeedbackCollector | undefined { return feedbackCollector; }
export function getRolePlayEngine(): RolePlayEngine | undefined { return rolePlayEngine; }
export function getEmbeddingService(): EmbeddingService | undefined { return embeddingService; }
export function getSkillRegistry(): SkillRegistry | undefined { return skillRegistry; }
export function getAgentBus(): AgentBus | undefined { return agentBus; }
export function getWorkflowEngine(): WorkflowEngine | undefined { return workflowEngine; }
export function getUsageTracker(): UsageTracker | undefined { return usageTracker; }

export async function activate(context: vscode.ExtensionContext) {
    console.log('TaskAgent is now active!');

    // Initialize core components
    const taskManager = new TaskManager();
    const agentRegistry = new AgentRegistry();
    
    // Initialize embedding service for semantic search
    embeddingService = new EmbeddingService({
        useLocalFallback: true,
        cacheEmbeddings: true,
        localDimension: 384
    });
    
    // Initialize new modules (inspired by CAMEL framework)
    memoryModule = new MemoryModule(context, embeddingService);
    dataGenerator = new DataGenerator(context, memoryModule);
    feedbackCollector = new FeedbackCollector(memoryModule, dataGenerator);
    rolePlayEngine = new RolePlayEngine(memoryModule);
    
    // Initialize Skills, AgentBus, Workflow Engine, and Usage Tracker
    skillRegistry = new SkillRegistry();
    agentBus = new AgentBus();
    workflowEngine = new WorkflowEngine();
    usageTracker = new UsageTracker();

    // Initialize workspace-dependent features
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        skillRegistry.initializeSkillsDir(rootPath);
        workflowEngine.initializeWorkflowsDir(rootPath);
    }

    // Wire workflow step executor to orchestrator
    const orchestrator = new (await import('./core/orchestrator')).Orchestrator(taskManager, agentRegistry, usageTracker);
    workflowEngine.stepExecutor = async (step, ctx) => {
        const prompt = step.prompt || '';
        return { agent: step.agent, prompt, context: ctx };
    };

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
        skillRegistry,
        agentBus,
        workflowEngine,
        usageTracker
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
        
        vscode.commands.registerCommand('taskagent.openDashboard', () => {
            // Open enhanced webview dashboard
            DashboardPanel.createOrShow(
                context.extensionUri,
                taskManager,
                agentRegistry,
                skillRegistry!,
                workflowEngine!,
                agentBus!,
                memoryModule!,
                usageTracker!
            );
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














