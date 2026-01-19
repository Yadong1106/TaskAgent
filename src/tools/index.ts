import * as vscode from 'vscode';
import { TaskManager } from '../core/taskManager';
import { BackendServer } from '../server/backendServer';
import { ExecuteCodeTool } from './executeCode';
import { WebSearchTool } from './webSearch';
import { BrowseWebpageTool } from './browseWebpage';
import { CreateDocumentTool } from './createDocument';
import { HumanInputTool } from './humanInput';
import { NoteTakingTool } from './noteTaking';
import { CodeSearchTool, FindFilesTool, ReadFileTool, GetSymbolsTool } from './codeSearch';
import { SecurityReviewTool } from './securityReview';
import { ScenarioSecurityAnalyzer } from './scenarioSecurityAnalyzer';

// Global NoteTakingTool instance for inter-agent communication
let noteTakingTool: NoteTakingTool;

export function getNoteTakingTool(): NoteTakingTool {
    return noteTakingTool;
}

/**
 * Register all Language Model Tools
 */
export function registerAllTools(
    context: vscode.ExtensionContext,
    taskManager: TaskManager,
    backendServer: BackendServer
) {
    // Execute Code Tool
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_executeCode', new ExecuteCodeTool())
    );

    // Web Search Tool
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_webSearch', new WebSearchTool(backendServer))
    );

    // Browse Webpage Tool
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_browseWebpage', new BrowseWebpageTool(backendServer))
    );

    // Create Document Tool
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_createDocument', new CreateDocumentTool())
    );

    // Human Input Tool (Human-in-the-loop)
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_humanInput', new HumanInputTool())
    );

    // Note Taking Tool (Inter-agent communication) - Inspired by Eigent
    noteTakingTool = new NoteTakingTool();
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_writeNote', noteTakingTool)
    );
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_readNote', noteTakingTool)
    );

    // ===== Code Search Tools =====
    
    // Code Search - Search for text in code
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_codeSearch', new CodeSearchTool())
    );

    // Find Files - Find files by name/pattern
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_findFiles', new FindFilesTool())
    );

    // Read File - Read file contents
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_readFile', new ReadFileTool())
    );

    // Get Symbols - Get symbols from a file (functions, classes, etc.)
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_getSymbols', new GetSymbolsTool())
    );

    // ===== Security Review Tools =====
    
    // Security Review - Generate security review document (single file)
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_securityReview', new SecurityReviewTool())
    );

    // Scenario Security Analyzer - Deep scenario security analysis (multi-file, call chain, API scanning)
    context.subscriptions.push(
        vscode.lm.registerTool('taskagent_analyzeScenario', new ScenarioSecurityAnalyzer())
    );

    console.log('TaskAgent: All tools registered (including Scenario Security Analyzer)');
}














