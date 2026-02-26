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
import { McpBridge } from './core/mcpBridge';
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
let mcpBridge: McpBridge | undefined;

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
export function getMcpBridge(): McpBridge | undefined { return mcpBridge; }

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
    
    // Initialize Skills, AgentBus, Workflow Engine, Usage Tracker, and MCP Bridge
    skillRegistry = new SkillRegistry();
    agentBus = new AgentBus();
    workflowEngine = new WorkflowEngine();
    usageTracker = new UsageTracker();
    mcpBridge = new McpBridge();

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
                usageTracker!,
                mcpBridge
            );
        }),

        // Quick Commit & Push — one-click git add + commit + push
        vscode.commands.registerCommand('taskagent.quickCommitPush', async () => {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!cwd) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }

            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            try {
                // Check if there are changes
                const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd });
                if (!statusOut.trim()) {
                    vscode.window.showInformationMessage('No changes to commit.');
                    return;
                }

                // Get current branch
                const { stdout: branchOut } = await execAsync('git branch --show-current', { cwd });
                const branch = branchOut.trim();

                // Show changed files in quick pick for confirmation
                const changedFiles = statusOut.trim().split('\n').map((l: string) => l.trim());
                const filesSummary = changedFiles.length <= 8
                    ? changedFiles.join('\n')
                    : changedFiles.slice(0, 8).join('\n') + `\n... and ${changedFiles.length - 8} more`;

                // Try to auto-generate commit message from diff
                let defaultMsg = '';
                try {
                    const { stdout: diffStat } = await execAsync('git diff --stat HEAD 2>nul || git diff --stat --cached', { cwd, encoding: 'utf-8' });
                    const { stdout: logMsg } = await execAsync('git log --oneline -1 2>nul', { cwd, encoding: 'utf-8' });
                    const fileCount = changedFiles.length;
                    const addedFiles = changedFiles.filter((f: string) => f.startsWith('??') || f.startsWith('A '));
                    const modifiedFiles = changedFiles.filter((f: string) => f.startsWith(' M') || f.startsWith('M '));

                    const parts: string[] = [];
                    if (addedFiles.length > 0) { parts.push(`add ${addedFiles.length} file(s)`); }
                    if (modifiedFiles.length > 0) { parts.push(`update ${modifiedFiles.length} file(s)`); }
                    if (parts.length === 0) { parts.push(`update ${fileCount} file(s)`); }
                    defaultMsg = parts.join(', ');
                } catch {
                    defaultMsg = 'update files';
                }

                // Prompt for commit message with auto-generated default
                const commitMsg = await vscode.window.showInputBox({
                    prompt: `Commit & push to ${branch}`,
                    placeHolder: 'Enter commit message (leave empty for auto-generated)',
                    value: defaultMsg,
                    title: `📦 Quick Commit & Push (${changedFiles.length} files)`,
                    ignoreFocusOut: true
                });

                if (commitMsg === undefined) {
                    return; // User cancelled
                }

                const finalMsg = commitMsg.trim() || defaultMsg || 'auto commit';

                // Execute: add → commit → push with progress
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Quick Commit & Push',
                        cancellable: false
                    },
                    async (progress) => {
                        progress.report({ message: 'Staging all changes...' });
                        await execAsync('git add .', { cwd });

                        progress.report({ message: 'Committing...' });
                        const escapedMsg = finalMsg.replace(/"/g, '\\"');
                        const { stdout: commitOut } = await execAsync(`git commit -m "${escapedMsg}"`, { cwd });

                        progress.report({ message: `Pushing to ${branch}...` });
                        try {
                            await execAsync(`git push origin ${branch}`, { cwd });
                        } catch (pushErr: any) {
                            // If push fails because no upstream, try set-upstream
                            if (pushErr.message?.includes('no upstream') || pushErr.message?.includes('has no upstream')) {
                                await execAsync(`git push --set-upstream origin ${branch}`, { cwd });
                            } else {
                                throw pushErr;
                            }
                        }

                        vscode.window.showInformationMessage(
                            `✅ Committed & pushed ${changedFiles.length} file(s) to ${branch}: "${finalMsg}"`
                        );
                    }
                );
            } catch (error: any) {
                vscode.window.showErrorMessage(`❌ Quick Commit failed: ${error.message}`);
            }
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














