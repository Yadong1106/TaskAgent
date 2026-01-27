import * as vscode from 'vscode';

export interface ScenarioAnalysisInput {
    scenarioName: string;
    scenarioDescription?: string;
    entryPoint?: string;           // Entry file or function, e.g. "src/api/user.ts:createUser"
    searchKeywords?: string[];     // Additional search keywords
    outputPath?: string;           // Output document path
}

interface CallChainNode {
    level: number;
    caller: string;
    callee: string;
    file: string;
    line: number;
    type: 'function' | 'api' | 'external' | 'database';
}

interface ExternalAPICall {
    api: string;
    endpoint: string;
    method: string;
    file: string;
    line: number;
    permissions: string[];
    scopes: string[];
}

interface CredentialUsage {
    type: string;           // AppID, ClientSecret, API Key, Token, etc.
    name: string;           // Variable or config name
    source: string;         // Environment variable, config file, hardcoded
    file: string;
    line: number;
    risk: 'critical' | 'high' | 'medium' | 'low';
}

interface DataFlowPoint {
    step: number;
    location: string;
    action: string;
    dataType: string;
    containsUserContent: boolean;
    containsPII: boolean;
}

// New interfaces for enhanced analysis
interface UpstreamAPI {
    caller: string;          // Function/method that calls this scenario
    file: string;
    line: number;
    callerType: 'controller' | 'service' | 'handler' | 'middleware' | 'other';
    httpMethod?: string;     // GET, POST, etc.
    route?: string;          // API route if applicable
}

interface DownstreamAPI {
    callee: string;          // Function/service being called
    file: string;
    line: number;
    calleeType: 'internal' | 'external' | 'database' | 'cache' | 'queue';
    api?: string;            // External API name if applicable
    endpoint?: string;
}

interface CallPathStep {
    step: number;
    function: string;
    file: string;
    line: number;
    action: string;
    permissions: string[];
    dataAccess: string[];
}

interface ScopeRequirement {
    scope: string;
    reason: string;
    usedIn: string;          // File:line where used
    permissionType: 'delegated' | 'application';
    accessLevel: 'read' | 'write' | 'admin';
}

/**
 * ScenarioSecurityAnalyzer - Deep scenario security analysis tool
 * 
 * Features:
 * 1. Trace complete call chain from entry point (multi-level nesting)
 * 2. Identify external API calls (MSGraph, AAD Graph, Azure APIs)
 * 3. Scan for AppID, ClientSecret, API Keys
 * 4. Analyze data flow and permission requirements
 * 5. Can be called in parallel by Orchestrator
 */
export class ScenarioSecurityAnalyzer implements vscode.LanguageModelTool<ScenarioAnalysisInput> {

    // Known external API patterns
    private readonly KNOWN_APIS = {
        'graph.microsoft.com': { name: 'Microsoft Graph API', type: 'msgraph' },
        'graph.windows.net': { name: 'Azure AD Graph API (Deprecated)', type: 'aadgraph' },
        'management.azure.com': { name: 'Azure Resource Manager', type: 'arm' },
        'login.microsoftonline.com': { name: 'Azure AD Authentication', type: 'auth' },
        'vault.azure.net': { name: 'Azure Key Vault', type: 'keyvault' },
        'blob.core.windows.net': { name: 'Azure Blob Storage', type: 'storage' },
        'table.core.windows.net': { name: 'Azure Table Storage', type: 'storage' },
        'queue.core.windows.net': { name: 'Azure Queue Storage', type: 'storage' },
        'cosmos.azure.com': { name: 'Azure Cosmos DB', type: 'cosmosdb' },
        'database.windows.net': { name: 'Azure SQL Database', type: 'sql' },
        'servicebus.windows.net': { name: 'Azure Service Bus', type: 'servicebus' },
        'api.github.com': { name: 'GitHub API', type: 'github' },
        'api.openai.com': { name: 'OpenAI API', type: 'openai' },
    };

    // Credential patterns
    private readonly CREDENTIAL_PATTERNS = [
        { pattern: /(?:AZURE_)?CLIENT_ID|APP_?ID|APPLICATION_ID/gi, type: 'AppID' },
        { pattern: /(?:AZURE_)?CLIENT_SECRET|APP_?SECRET/gi, type: 'ClientSecret' },
        { pattern: /(?:AZURE_)?TENANT_ID/gi, type: 'TenantID' },
        { pattern: /API_KEY|APIKEY|api[_-]?key/gi, type: 'API Key' },
        { pattern: /(?:ACCESS|BEARER|AUTH)_?TOKEN/gi, type: 'Access Token' },
        { pattern: /(?:AZURE_)?SUBSCRIPTION_ID/gi, type: 'SubscriptionID' },
        { pattern: /CONNECTION_STRING|CONN_STR/gi, type: 'Connection String' },
        { pattern: /STORAGE_(?:ACCOUNT|KEY)/gi, type: 'Storage Credential' },
        { pattern: /(?:SQL|DB)_(?:PASSWORD|USER)/gi, type: 'Database Credential' },
        { pattern: /OPENAI_API_KEY|AZURE_OPENAI/gi, type: 'OpenAI Credential' },
        // Token patterns
        { pattern: /GetTokenAsync|AcquireToken|GetAccessToken/gi, type: 'Token Acquisition' },
        { pattern: /Bearer\s+[\w-]+/gi, type: 'Bearer Token' },
        { pattern: /\.Token\s*[=:]/gi, type: 'Token Assignment' },
        { pattern: /accessToken|idToken|refreshToken/gi, type: 'Token Variable' },
        { pattern: /TokenCredential|ClientSecretCredential|DefaultAzureCredential/gi, type: 'Azure Credential' },
        { pattern: /IConfidentialClientApplication|PublicClientApplication/gi, type: 'MSAL Client' },
        // Certificate patterns
        { pattern: /X509Certificate|\.pfx|\.pem|\.cer/gi, type: 'Certificate' },
        { pattern: /CertificateCredential|ClientCertificateCredential/gi, type: 'Certificate Auth' },
    ];

    // Graph API Permission/Scope patterns - Extended
    private readonly GRAPH_SCOPES = [
        // User
        'User.Read', 'User.ReadWrite', 'User.ReadBasic.All', 'User.Read.All', 'User.ReadWrite.All',
        // Mail
        'Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'Mail.ReadBasic', 'Mail.ReadWrite.Shared',
        // Calendar
        'Calendars.Read', 'Calendars.ReadWrite', 'Calendars.Read.Shared',
        // Files/OneDrive
        'Files.Read', 'Files.ReadWrite', 'Files.ReadWrite.All', 'Files.Read.All',
        // Directory/Azure AD
        'Directory.Read.All', 'Directory.ReadWrite.All', 'Directory.AccessAsUser.All',
        // Group
        'Group.Read.All', 'Group.ReadWrite.All', 'Group.Create', 'GroupMember.Read.All', 'GroupMember.ReadWrite.All',
        // Application
        'Application.Read.All', 'Application.ReadWrite.All', 'Application.ReadWrite.OwnedBy',
        // Sites/SharePoint
        'Sites.Read.All', 'Sites.ReadWrite.All', 'Sites.Manage.All', 'Sites.FullControl.All',
        // Teams
        'Team.ReadBasic.All', 'Team.Create', 'TeamSettings.Read.All', 'TeamSettings.ReadWrite.All',
        'Channel.ReadBasic.All', 'Channel.Create', 'ChannelMessage.Read.All', 'ChannelMessage.Send',
        'TeamMember.Read.All', 'TeamMember.ReadWrite.All', 'TeamsActivity.Send',
        // Chat
        'Chat.Read', 'Chat.ReadWrite', 'Chat.Create', 'ChatMessage.Read', 'ChatMessage.Send',
        // Presence
        'Presence.Read', 'Presence.Read.All',
        // Reports
        'Reports.Read.All',
        // Security
        'SecurityEvents.Read.All', 'SecurityEvents.ReadWrite.All',
        // Audit
        'AuditLog.Read.All',
        // Device
        'Device.Read.All', 'Device.ReadWrite.All',
        // Role Management
        'RoleManagement.Read.All', 'RoleManagement.ReadWrite.All',
        // Policy
        'Policy.Read.All', 'Policy.ReadWrite.ConditionalAccess',
    ];

    // Endpoint patterns for better detection
    private readonly ENDPOINT_PATTERNS = [
        // REST patterns
        { pattern: /\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']\s*\)\]/gi, type: 'ASP.NET Endpoint' },
        { pattern: /\[Route\s*\(\s*["']([^"']+)["']\s*\)\]/gi, type: 'Route Attribute' },
        { pattern: /app\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi, type: 'Express Endpoint' },
        { pattern: /router\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi, type: 'Router Endpoint' },
        { pattern: /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']\s*\)/gi, type: 'Spring Endpoint' },
        // Graph API endpoints
        { pattern: /\/v1\.0\/(users|groups|teams|sites|me|drives|chats|channels)[^\s'"]*/gi, type: 'Graph API v1.0' },
        { pattern: /\/beta\/(users|groups|teams|sites|me|drives|chats|channels)[^\s'"]*/gi, type: 'Graph API beta' },
    ];

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ScenarioAnalysisInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { scenarioName } = options.input;
        return {
            invocationMessage: `🔍 Analyzing scenario: ${scenarioName}\nTracing call chains, scanning credentials, and identifying external APIs...`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ScenarioAnalysisInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { 
            scenarioName, 
            scenarioDescription,
            entryPoint,
            searchKeywords = [],
        } = options.input;

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

            // ========================================
            // STEP 1: Get content from the ACTIVE FILE (primary source)
            // ========================================
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `⚠️ No file is currently open.\n\n` +
                        `Please open the file that contains the scenario "${scenarioName}" and try again.`
                    )
                ]);
            }

            const activeDocument = activeEditor.document;
            const activeFilePath = vscode.workspace.asRelativePath(activeDocument.uri);
            const activeContent = activeDocument.getText();
            const activeLines = activeContent.split('\n');

            console.log(`[SecurityAnalyzer] Analyzing active file: ${activeFilePath}`);

            // ========================================
            // STEP 2: Find the scenario in the active file
            // ========================================
            const scenarioInfo = this.findScenarioInFile(activeLines, scenarioName);
            
            if (!scenarioInfo) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `⚠️ Scenario "${scenarioName}" not found in the current file.\n\n` +
                        `**Current file**: \`${activeFilePath}\`\n\n` +
                        `**Suggestions**:\n` +
                        `1. Make sure the scenario name matches exactly (case-sensitive)\n` +
                        `2. The scenario should be defined in the current file\n` +
                        `3. Try searching for a partial match\n\n` +
                        `**File preview (first 20 lines)**:\n\`\`\`\n${activeLines.slice(0, 20).join('\n')}\n\`\`\``
                    )
                ]);
            }

            console.log(`[SecurityAnalyzer] Found scenario at line ${scenarioInfo.line}: ${scenarioInfo.context}`);

            // ========================================
            // STEP 3: Extract the scenario code block
            // ========================================
            const scenarioBlock = this.extractScenarioCodeBlock(activeLines, scenarioInfo.line, scenarioName);
            console.log(`[SecurityAnalyzer] Extracted scenario block: lines ${scenarioBlock.startLine}-${scenarioBlock.endLine}`);

            // ========================================
            // STEP 4: Analyze the scenario code block
            // ========================================
            const analysis = this.analyzeScenarioBlock(
                scenarioBlock.code,
                activeFilePath,
                scenarioBlock.startLine,
                scenarioName
            );

            // ========================================
            // STEP 5: Build call stack from the scenario
            // ========================================
            const callStack = this.buildCallStackFromScenario(
                scenarioBlock.code,
                activeFilePath,
                scenarioBlock.startLine,
                scenarioName
            );

            // ========================================
            // STEP 6: Generate security review document
            // ========================================
            const document = this.generateScenarioSecurityDocument({
                scenarioName,
                scenarioDescription: scenarioDescription || this.extractScenarioDescription(activeLines, scenarioInfo.line),
                filePath: activeFilePath,
                scenarioLine: scenarioInfo.line,
                scenarioCode: scenarioBlock.code,
                callStack,
                analysis
            });

            // ========================================
            // STEP 7: Save document next to active file
            // ========================================
            const baseDir = vscode.Uri.joinPath(activeDocument.uri, '..');
            const fileName = `security-review-${scenarioName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
            const fileUri = vscode.Uri.joinPath(baseDir, fileName);
            
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(document, 'utf-8'));

            // Open the generated document
            try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e) {
                console.warn('Could not open generated document:', e);
            }

            // Return summary
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `✅ Security Review Generated\n\n` +
                    `**Scenario**: ${scenarioName}\n` +
                    `**Location**: \`${activeFilePath}:${scenarioInfo.line}\`\n` +
                    `**Code Block**: Lines ${scenarioBlock.startLine}-${scenarioBlock.endLine}\n\n` +
                    `**Call Stack**: ${callStack.length} method calls traced\n` +
                    `**APIs Detected**: ${analysis.apis.length}\n` +
                    `**Permissions**: ${analysis.permissions.length}\n\n` +
                    `📄 Full report saved to \`${fileName}\``
                )
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Failed to analyze scenario: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
    }

    // ========================================
    // NEW: Core Scenario Analysis Methods
    // ========================================

    /**
     * Find the scenario definition in the file
     */
    private findScenarioInFile(lines: string[], scenarioName: string): { line: number; context: string } | null {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(scenarioName)) {
                return {
                    line: i + 1, // 1-indexed
                    context: lines[i].trim()
                };
            }
        }
        return null;
    }

    /**
     * Extract the code block containing the scenario
     */
    private extractScenarioCodeBlock(lines: string[], scenarioLine: number, scenarioName: string): {
        startLine: number;
        endLine: number;
        code: string;
    } {
        const lineIndex = scenarioLine - 1; // Convert to 0-indexed
        
        // Find the start of the containing block (method/function/case)
        let startLine = lineIndex;
        let braceCount = 0;
        
        // Look backwards for the start of the block
        for (let i = lineIndex; i >= 0; i--) {
            const line = lines[i];
            
            // Count braces going backwards
            braceCount += (line.match(/}/g) || []).length;
            braceCount -= (line.match(/{/g) || []).length;
            
            // Look for case statement or method start
            if (/^\s*(case\s+|public|private|protected|async|function|def\s)/.test(line) || 
                (braceCount < 0 && line.includes('{'))) {
                startLine = i;
                break;
            }
        }

        // Find the end of the block
        braceCount = 0;
        let endLine = lineIndex;
        let foundStart = false;
        
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('{')) foundStart = true;
            
            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;
            
            // Look for break/return or balanced braces
            if (foundStart && (braceCount <= 0 || /^\s*(break|return)\s*;/.test(line))) {
                endLine = i;
                if (/^\s*(break|return)\s*;/.test(line)) break;
                if (braceCount <= 0) break;
            }
        }

        const code = lines.slice(startLine, endLine + 1).join('\n');
        
        return {
            startLine: startLine + 1, // 1-indexed
            endLine: endLine + 1,
            code
        };
    }

    /**
     * Analyze the scenario code block for APIs, permissions, etc.
     */
    private analyzeScenarioBlock(code: string, filePath: string, startLine: number, scenarioName: string): {
        apis: { name: string; endpoint: string; method: string; line: number }[];
        permissions: { scope: string; reason: string }[];
        methodCalls: { name: string; line: number }[];
    } {
        const apis: { name: string; endpoint: string; method: string; line: number }[] = [];
        const permissions: { scope: string; reason: string }[] = [];
        const methodCalls: { name: string; line: number }[] = [];
        
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const absoluteLine = startLine + i;
            
            // Find API endpoints
            const urlMatch = line.match(/["'`](https?:\/\/[^"'`]+|\/v1\.0\/[^"'`]+|\/beta\/[^"'`]+)["'`]/);
            if (urlMatch) {
                const endpoint = urlMatch[1];
                let apiName = 'REST API';
                if (endpoint.includes('graph.microsoft.com') || endpoint.includes('/v1.0/') || endpoint.includes('/beta/')) {
                    apiName = 'Microsoft Graph';
                }
                apis.push({
                    name: apiName,
                    endpoint: endpoint,
                    method: this.detectHTTPMethod(line),
                    line: absoluteLine
                });
                
                // Infer permissions from endpoint
                const inferredPerms = this.inferPermissionsFromEndpoint(endpoint);
                for (const perm of inferredPerms) {
                    if (!permissions.some(p => p.scope === perm)) {
                        permissions.push({ scope: perm, reason: `Inferred from ${endpoint}` });
                    }
                }
            }
            
            // Find method calls
            const methodMatch = line.match(/(?:await\s+)?(?:this\.)?([A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\s*\(/g);
            if (methodMatch) {
                for (const m of methodMatch) {
                    const name = m.replace(/await\s+/, '').replace(/this\./, '').replace(/\s*\($/, '');
                    if (name.length > 2 && !['Console', 'Math', 'Object', 'Array', 'String', 'Promise'].includes(name.split('.')[0])) {
                        methodCalls.push({ name, line: absoluteLine });
                    }
                }
            }
            
            // Find explicit scope definitions
            const scopeMatch = line.match(/["'`]([A-Z][a-zA-Z]+\.[A-Z][a-zA-Z.]+)["'`]/g);
            if (scopeMatch) {
                for (const s of scopeMatch) {
                    const scope = s.replace(/["'`]/g, '');
                    if (this.GRAPH_SCOPES.includes(scope) && !permissions.some(p => p.scope === scope)) {
                        permissions.push({ scope, reason: 'Explicitly defined in code' });
                    }
                }
            }
        }
        
        return { apis, permissions, methodCalls };
    }

    /**
     * Build call stack from scenario code
     */
    private buildCallStackFromScenario(code: string, filePath: string, startLine: number, scenarioName: string): {
        step: number;
        method: string;
        description: string;
        line: number;
    }[] {
        const callStack: { step: number; method: string; description: string; line: number }[] = [];
        const lines = code.split('\n');
        let step = 1;
        
        // Add entry point
        callStack.push({
            step: step++,
            method: scenarioName,
            description: 'Scenario Entry Point',
            line: startLine
        });
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const absoluteLine = startLine + i;
            const trimmedLine = line.trim();
            
            // Skip comments and empty lines
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine === '') {
                continue;
            }
            
            // C# await calls
            if (/await\s+/.test(line)) {
                const match = line.match(/await\s+(?:this\.)?([a-zA-Z_][a-zA-Z0-9_.]*)\s*[<(]/);
                if (match) {
                    callStack.push({
                        step: step++,
                        method: match[1],
                        description: this.describeMethodCall(match[1], line),
                        line: absoluteLine
                    });
                }
            }
            
            // C# method calls: this.MethodName( or ClassName.MethodName(
            const methodCallMatches = line.matchAll(/(?:this\.|[A-Z][a-zA-Z0-9]*\.)([A-Z][a-zA-Z0-9]*)\s*[<(]/g);
            for (const match of methodCallMatches) {
                const methodName = match[1];
                // Filter out common non-method patterns
                if (!['ToString', 'GetType', 'Equals', 'GetHashCode', 'Format', 'Join', 'Split'].includes(methodName)) {
                    if (!callStack.some(c => c.line === absoluteLine && c.method === methodName)) {
                        callStack.push({
                            step: step++,
                            method: methodName,
                            description: this.describeMethodCall(methodName, line),
                            line: absoluteLine
                        });
                    }
                }
            }
            
            // Service/Manager calls: serviceName.Method(
            const serviceCallMatch = line.match(/([a-z][a-zA-Z0-9]*(?:Service|Manager|Client|Provider|Helper|Repository))\s*\.\s*([A-Z][a-zA-Z0-9]*)\s*[<(]/i);
            if (serviceCallMatch) {
                const fullCall = `${serviceCallMatch[1]}.${serviceCallMatch[2]}`;
                if (!callStack.some(c => c.method === fullCall)) {
                    callStack.push({
                        step: step++,
                        method: fullCall,
                        description: this.describeMethodCall(serviceCallMatch[2], line),
                        line: absoluteLine
                    });
                }
            }
            
            // HTTP/API calls
            if (/\.(Get|Post|Put|Delete|Patch|Send)Async|\.(Get|Post|Put|Delete|Patch)\s*[<(]/.test(line)) {
                const match = line.match(/\.(\w+(?:Async)?)\s*[<(]/);
                if (match && !callStack.some(c => c.line === absoluteLine && c.method.includes('HTTP'))) {
                    callStack.push({
                        step: step++,
                        method: `HTTP.${match[1]}`,
                        description: 'External API Call',
                        line: absoluteLine
                    });
                }
            }
            
            // Graph API calls
            if (/GraphServiceClient|\.Users|\.Groups|\.Teams|\.Channels|\.Sites/.test(line)) {
                const apiMatch = line.match(/\.(Users|Groups|Teams|Channels|Sites|Me|Drives)[.\[]/);
                if (apiMatch) {
                    callStack.push({
                        step: step++,
                        method: `Graph.${apiMatch[1]}`,
                        description: 'Microsoft Graph API Call',
                        line: absoluteLine
                    });
                }
            }
            
            // Database operations
            if (/\.ExecuteNonQuery|\.ExecuteReader|\.SaveChanges|\.Add\(|\.Update\(|\.Delete\(|\.Find\(|\.FirstOrDefault|\.Where\(/.test(line)) {
                const dbMatch = line.match(/\.(\w+)\s*[<(]/);
                if (dbMatch) {
                    callStack.push({
                        step: step++,
                        method: `DB.${dbMatch[1]}`,
                        description: 'Database Operation',
                        line: absoluteLine
                    });
                }
            }

            // Logging
            if (/\.(Log|Debug|Info|Warn|Error|Fatal|Trace)\s*\(|Logger\.|SPDiagnosticsCategory/.test(line)) {
                // Skip logging calls for call stack
                continue;
            }
        }
        
        return callStack;
    }

    /**
     * Describe what a method call does based on its name
     */
    private describeMethodCall(methodName: string, context: string): string {
        const lowerName = methodName.toLowerCase();
        
        if (lowerName.includes('get')) return 'Retrieve data';
        if (lowerName.includes('create') || lowerName.includes('add')) return 'Create resource';
        if (lowerName.includes('update') || lowerName.includes('set')) return 'Update resource';
        if (lowerName.includes('delete') || lowerName.includes('remove')) return 'Delete resource';
        if (lowerName.includes('ensure')) return 'Ensure resource exists';
        if (lowerName.includes('provision')) return 'Provision resource';
        if (lowerName.includes('send')) return 'Send request/notification';
        if (lowerName.includes('validate') || lowerName.includes('check')) return 'Validation';
        if (lowerName.includes('auth') || lowerName.includes('token')) return 'Authentication';
        
        return 'Method call';
    }

    /**
     * Infer permissions from API endpoint
     */
    private inferPermissionsFromEndpoint(endpoint: string): string[] {
        const perms: string[] = [];
        const lower = endpoint.toLowerCase();
        
        if (lower.includes('/users')) perms.push('User.Read.All');
        if (lower.includes('/groups')) perms.push('Group.ReadWrite.All');
        if (lower.includes('/teams')) perms.push('Team.ReadBasic.All', 'TeamSettings.ReadWrite.All');
        if (lower.includes('/channels')) perms.push('Channel.ReadBasic.All');
        if (lower.includes('/sites')) perms.push('Sites.Read.All');
        if (lower.includes('/drives') || lower.includes('/items')) perms.push('Files.ReadWrite.All');
        if (lower.includes('/mail') || lower.includes('/messages')) perms.push('Mail.ReadWrite');
        if (lower.includes('/calendars') || lower.includes('/events')) perms.push('Calendars.ReadWrite');
        if (lower.includes('/chats')) perms.push('Chat.ReadWrite');
        if (lower.includes('/applications')) perms.push('Application.ReadWrite.All');
        
        return perms;
    }

    /**
     * Extract description from comments near the scenario
     */
    private extractScenarioDescription(lines: string[], scenarioLine: number): string {
        const lineIndex = scenarioLine - 1;
        const comments: string[] = [];
        
        // Look for comments above the scenario line
        for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 10); i--) {
            const line = lines[i].trim();
            if (line.startsWith('//') || line.startsWith('*') || line.startsWith('///')) {
                comments.unshift(line.replace(/^\/\/\s*|^\*\s*|^\/\/\/\s*/, ''));
            } else if (line === '' || line === '/*' || line === '/**') {
                continue;
            } else {
                break;
            }
        }
        
        return comments.join(' ').trim() || 'No description available';
    }

    /**
     * Generate the security review document
     */
    private generateScenarioSecurityDocument(params: {
        scenarioName: string;
        scenarioDescription: string;
        filePath: string;
        scenarioLine: number;
        scenarioCode: string;
        callStack: { step: number; method: string; description: string; line: number }[];
        analysis: {
            apis: { name: string; endpoint: string; method: string; line: number }[];
            permissions: { scope: string; reason: string }[];
            methodCalls: { name: string; line: number }[];
        };
    }): string {
        const { scenarioName, scenarioDescription, filePath, scenarioLine, scenarioCode, callStack, analysis } = params;
        const now = new Date().toISOString().split('T')[0];

        let doc = `# Security Review: ${scenarioName}

| Field | Value |
|-------|-------|
| **Date** | ${now} |
| **File** | \`${filePath}\` |
| **Line** | ${scenarioLine} |

---

## 1️⃣ Scenario Overview (场景描述)

${scenarioDescription}

### Source Code

\`\`\`csharp
${scenarioCode}
\`\`\`

---

## 2️⃣ Permissions & Scopes (权限与 Scope)

`;

        if (analysis.permissions.length > 0) {
            doc += `| Permission / Scope | Reason |
|-------------------|--------|
`;
            for (const p of analysis.permissions) {
                doc += `| \`${p.scope}\` | ${p.reason} |
`;
            }
        } else {
            doc += `_No explicit permissions detected. Manual review required._
`;
        }

        doc += `
---

## 3️⃣ Call Stack / Workflow (调用栈)

`;

        if (callStack.length > 0) {
            doc += `| Step | Method | Description | Line |
|------|--------|-------------|------|
`;
            for (const call of callStack) {
                doc += `| ${call.step} | \`${call.method}\` | ${call.description} | ${call.line} |
`;
            }
            
            // Add Mermaid diagram
            doc += `
### Sequence Diagram

\`\`\`mermaid
sequenceDiagram
    participant Client
    participant Scenario as ${scenarioName}
`;
            const uniqueMethods = [...new Set(callStack.map(c => c.method))].slice(0, 8);
            for (const m of uniqueMethods) {
                if (m !== scenarioName) {
                    doc += `    participant ${m.replace(/[^a-zA-Z0-9]/g, '')}\n`;
                }
            }
            doc += `    Client->>Scenario: Request\n`;
            for (let i = 1; i < callStack.length && i < 8; i++) {
                const call = callStack[i];
                const methodName = call.method.replace(/[^a-zA-Z0-9]/g, '');
                doc += `    Scenario->>${methodName}: ${call.description}\n`;
            }
            doc += `    Scenario-->>Client: Response\n\`\`\`
`;
        } else {
            doc += `_No significant method calls detected._
`;
        }

        doc += `
---

## 4️⃣ Underlying APIs & Response (底层 API 与 Response)

`;

        if (analysis.apis.length > 0) {
            for (const api of analysis.apis) {
                doc += `### ${api.name}

- **Endpoint**: \`${api.method} ${api.endpoint}\`
- **Line**: ${api.line}
- **Expected Response**:

\`\`\`json
${this.inferResponseBody({ api: api.name, endpoint: api.endpoint, method: api.method, file: filePath, line: api.line, permissions: [], scopes: [] })}
\`\`\`

---

`;
            }
        } else {
            doc += `_No external API calls detected in this scenario block._

Review the method calls above to trace external dependencies.
`;
        }

        // Method calls section
        if (analysis.methodCalls.length > 0) {
            doc += `### Internal Method Calls

| Method | Line |
|--------|------|
`;
            for (const m of analysis.methodCalls.slice(0, 15)) {
                doc += `| \`${m.name}\` | ${m.line} |
`;
            }
        }

        doc += `
---

## ✅ Review Checklist

- [ ] Scenario purpose verified
- [ ] All permissions justified (least privilege)
- [ ] Call stack reviewed
- [ ] API responses contain no sensitive data leakage
- [ ] Error handling reviewed

---

| Role | Name | Date |
|------|------|------|
| Developer | | |
| Security Reviewer | | |

_Generated by TaskAgent Security Analyzer • ${now}_
`;

        return doc;
    }

    private generateSummary(params: {
        scenarioName: string;
        outputPath: string;
        filesAnalyzed: number;
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        dataFlow: DataFlowPoint[];
    }): string {
        const { scenarioName, outputPath, filesAnalyzed, externalAPIs, credentials, dataFlow } = params;
        
        const criticalCreds = credentials.filter(c => c.risk === 'critical').length;
        const highRiskCreds = credentials.filter(c => c.risk === 'high').length;
        const piiDataPoints = dataFlow.filter(d => d.containsPII).length;

        const hasIssues = criticalCreds > 0 || highRiskCreds > 0;

        return `✅ Security Analysis Complete

**Scenario**: ${scenarioName}
**Output**: \`${outputPath}\`

**Analysis Summary**:
- 📁 Files analyzed: ${filesAnalyzed}
- 🌐 External APIs: ${externalAPIs.length}
- 🔑 Credentials found: ${credentials.length}
- 📊 Data flow points: ${dataFlow.length}

**Risk Assessment**:
${criticalCreds > 0 ? `- 🔴 Critical: ${criticalCreds} hardcoded credentials` : ''}
${highRiskCreds > 0 ? `- 🟠 High: ${highRiskCreds} credential exposures` : ''}
${piiDataPoints > 0 ? `- 🟡 PII detected in ${piiDataPoints} data flow points` : ''}
${!hasIssues && piiDataPoints === 0 ? '- ✅ No critical issues detected' : ''}

${hasIssues ? '⚠️ **Action Required**: Review the security document for details.' : ''}

📄 Full report saved to \`${outputPath}\``;
    }

    private async findRelevantFiles(
        scenarioName: string,
        entryPoint?: string,
        keywords: string[] = [],
        token?: vscode.CancellationToken
    ): Promise<string[]> {
        const files = new Set<string>();
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        // PRIORITY 1: Always start with the currently active file
        // The scenario name is usually a line/method/identifier WITHIN the active file
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeFilePath = vscode.workspace.asRelativePath(activeEditor.document.uri);
            const activeContent = activeEditor.document.getText();
            
            // Check if the active file contains the scenario
            if (activeContent.includes(scenarioName)) {
                files.add(activeFilePath);
                console.log(`[SecurityAnalyzer] ✓ Found scenario "${scenarioName}" in active file: ${activeFilePath}`);
                
                // Find the line number where scenario is defined
                const lines = activeContent.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(scenarioName)) {
                        console.log(`[SecurityAnalyzer] Scenario found at line ${i + 1}: ${lines[i].trim().substring(0, 80)}...`);
                        break;
                    }
                }
            } else {
                // Even if scenario name not found, still include active file as primary source
                files.add(activeFilePath);
                console.log(`[SecurityAnalyzer] Active file added (scenario name not directly found): ${activeFilePath}`);
            }
        }

        // PRIORITY 2: Check all currently open documents
        for (const doc of vscode.workspace.textDocuments) {
            if (!doc.isUntitled && doc.uri.scheme === 'file') {
                const content = doc.getText();
                const relativePath = vscode.workspace.asRelativePath(doc.uri);
                
                // Check if this document contains the scenario
                if (content.includes(scenarioName)) {
                    files.add(relativePath);
                    console.log(`[SecurityAnalyzer] Found scenario in open document: ${relativePath}`);
                }
                
                // Also check for keywords
                if (keywords.some(kw => content.includes(kw))) {
                    files.add(relativePath);
                }
            }
        }

        // PRIORITY 3: If entry point is specified, add it
        if (entryPoint) {
            const entryFile = entryPoint.split(':')[0];
            files.add(entryFile);
            console.log(`[SecurityAnalyzer] Added entry point file: ${entryFile}`);
        }

        // If we already found files containing the scenario, we can be more targeted
        if (files.size > 0) {
            console.log(`[SecurityAnalyzer] Found ${files.size} files containing scenario directly`);
            
            // Now search for related files based on imports/references in found files
            await this.findRelatedFiles(files, scenarioName, keywords, token);
        }

        // PRIORITY 4: If still no files, search workspace (fallback)
        if (files.size === 0 && workspaceFolder) {
            console.log(`[SecurityAnalyzer] No files found in active/open documents, searching workspace...`);
            await this.searchWorkspaceForScenario(files, scenarioName, keywords, token);
        }

        // Add config files if workspace exists
        if (workspaceFolder) {
            const configPatterns = ['**/appsettings*.json', '**/.env*', '**/config*.json', '**/config*.yaml'];
            for (const pattern of configPatterns) {
                try {
                    const configFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 5, token);
                    for (const file of configFiles) {
                        files.add(vscode.workspace.asRelativePath(file));
                    }
                } catch {
                    // Skip
                }
            }
        }

        console.log(`[SecurityAnalyzer] Total files to analyze: ${files.size}`);
        return Array.from(files);
    }

    /**
     * Find files related to the scenario (imports, references)
     */
    private async findRelatedFiles(
        files: Set<string>,
        scenarioName: string,
        keywords: string[],
        token?: vscode.CancellationToken
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        // Extract class/method names from scenario for searching related files
        const searchTerms = [
            scenarioName,
            ...scenarioName.split(/(?=[A-Z])/).filter(s => s.length > 3),
            ...keywords
        ];

        const codePatterns = ['**/*.ts', '**/*.js', '**/*.cs', '**/*.java', '**/*.py'];

        for (const term of searchTerms.slice(0, 5)) { // Limit to avoid too many searches
            if (token?.isCancellationRequested) break;
            if (term.length < 4) continue;

            try {
                for (const pattern of codePatterns) {
                    const foundFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 50, token);
                    
                    for (const file of foundFiles) {
                        if (files.size > 30) break;
                        
                        try {
                            const doc = await vscode.workspace.openTextDocument(file);
                            const content = doc.getText();
                            
                            if (content.includes(term)) {
                                files.add(vscode.workspace.asRelativePath(file));
                            }
                        } catch {
                            // Skip
                        }
                    }
                }
            } catch (e) {
                console.log(`[SecurityAnalyzer] Error searching for related files: ${e}`);
            }
        }
    }

    /**
     * Fallback: Search entire workspace for scenario
     */
    private async searchWorkspaceForScenario(
        files: Set<string>,
        scenarioName: string,
        keywords: string[],
        token?: vscode.CancellationToken
    ): Promise<void> {
        const searchTerms = [
            scenarioName,
            ...scenarioName.split(/(?=[A-Z])/).filter(s => s.length > 2),
            ...keywords
        ];

        const codePatterns = ['**/*.ts', '**/*.js', '**/*.tsx', '**/*.jsx', '**/*.cs', '**/*.java', '**/*.py', '**/*.go'];

        for (const term of searchTerms) {
            if (token?.isCancellationRequested) break;
            if (term.length < 3) continue;

            try {
                for (const pattern of codePatterns) {
                    const foundFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100, token);
                    
                    for (const file of foundFiles) {
                        if (files.size > 50) break;
                        
                        try {
                            const doc = await vscode.workspace.openTextDocument(file);
                            const content = doc.getText();
                            
                            if (content.includes(term) || content.toLowerCase().includes(term.toLowerCase())) {
                                files.add(vscode.workspace.asRelativePath(file));
                            }
                        } catch {
                            // Skip
                        }
                    }
                }
            } catch (e) {
                console.log(`[SecurityAnalyzer] Error in workspace search: ${e}`);
            }
        }
    }

    private async analyzeFile(
        filePath: string,
        token?: vscode.CancellationToken,
        scenarioName?: string
    ): Promise<{
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        callChain: CallChainNode[];
        dataFlow: DataFlowPoint[];
        scenarioContext?: {
            startLine: number;
            endLine: number;
            methodName: string;
        };
    }> {
        const externalAPIs: ExternalAPICall[] = [];
        const credentials: CredentialUsage[] = [];
        const callChain: CallChainNode[] = [];
        const dataFlow: DataFlowPoint[] = [];
        let scenarioContext: { startLine: number; endLine: number; methodName: string } | undefined;

        try {
            // Try to open file from active editor first (handles files outside workspace)
            let document: vscode.TextDocument | undefined;
            const activeEditor = vscode.window.activeTextEditor;
            
            if (activeEditor && vscode.workspace.asRelativePath(activeEditor.document.uri) === filePath) {
                document = activeEditor.document;
            } else {
                // Try workspace folder
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
                    try {
                        document = await vscode.workspace.openTextDocument(fileUri);
                    } catch {
                        // Try as absolute path
                        try {
                            document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
                        } catch {
                            // Skip
                        }
                    }
                }
            }

            if (!document) {
                return { externalAPIs, credentials, callChain, dataFlow };
            }

            const content = document.getText();
            const lines = content.split('\n');

            // If scenarioName is provided, find and focus on the scenario block
            if (scenarioName) {
                scenarioContext = this.findScenarioContext(lines, scenarioName);
                if (scenarioContext) {
                    console.log(`[SecurityAnalyzer] Found scenario "${scenarioName}" at lines ${scenarioContext.startLine}-${scenarioContext.endLine}`);
                }
            }

            // Analyze external API calls
            externalAPIs.push(...this.findExternalAPIs(content, filePath, lines));

            // Analyze credential usage (basic patterns)
            credentials.push(...this.findCredentials(content, filePath, lines));

            // NEW: Analyze OAuth/MSAL flows
            credentials.push(...this.findOAuthFlows(content, filePath, lines));

            // NEW: Analyze HTTP header security
            credentials.push(...this.findHttpHeaders(content, filePath, lines));

            // NEW: Analyze token handling
            credentials.push(...this.findTokenHandling(content, filePath, lines));

            // Analyze call chain (simplified - LSP can provide more accurate info)
            callChain.push(...this.findCallChain(content, filePath, lines));

            // Analyze data flow
            dataFlow.push(...this.findDataFlow(content, filePath));

        } catch (e) {
            console.log(`[SecurityAnalyzer] Error analyzing file ${filePath}: ${e}`);
        }

        return { externalAPIs, credentials, callChain, dataFlow, scenarioContext };
    }

    /**
     * Find the code block (method/function) containing the scenario
     */
    private findScenarioContext(lines: string[], scenarioName: string): { startLine: number; endLine: number; methodName: string } | undefined {
        // Find the line containing the scenario name
        let scenarioLine = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(scenarioName)) {
                scenarioLine = i;
                break;
            }
        }

        if (scenarioLine === -1) return undefined;

        // Find the enclosing method/function
        let startLine = scenarioLine;
        let braceCount = 0;
        let methodName = scenarioName;

        // Search backwards for method start
        for (let i = scenarioLine; i >= 0; i--) {
            const line = lines[i];
            
            // Count braces going backwards
            braceCount += (line.match(/}/g) || []).length;
            braceCount -= (line.match(/{/g) || []).length;

            // Look for method definition patterns
            const methodMatch = line.match(/(?:public|private|protected|internal|async|static|\s)+\s*(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*{?/);
            if (methodMatch) {
                startLine = i;
                methodName = methodMatch[1] || scenarioName;
                break;
            }

            // Also match C# style
            const csMethodMatch = line.match(/(?:public|private|protected|internal|async|static|virtual|override|\s)+\s*(?:<[^>]+>\s*)?(\w+)\s*\([^)]*\)/);
            if (csMethodMatch && braceCount <= 0) {
                startLine = i;
                methodName = csMethodMatch[1] || scenarioName;
                break;
            }
        }

        // Search forward for method end
        braceCount = 0;
        let foundStart = false;
        let endLine = scenarioLine;

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('{')) {
                foundStart = true;
            }

            braceCount += (line.match(/{/g) || []).length;
            braceCount -= (line.match(/}/g) || []).length;

            if (foundStart && braceCount <= 0) {
                endLine = i;
                break;
            }
        }

        return { startLine: startLine + 1, endLine: endLine + 1, methodName };
    }

    private findExternalAPIs(content: string, filePath: string, lines: string[]): ExternalAPICall[] {
        const apis: ExternalAPICall[] = [];

        // Find URL patterns
        const urlPatterns = [
            /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\/[^\s'"`)]*)?/g,
            /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g,
            /axios\.[a-z]+\s*\(\s*['"`]([^'"`]+)['"`]/g,
            /request\s*\(\s*['"`]([^'"`]+)['"`]/g,
            /\.get\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/g,
            /\.post\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/g,
            /HttpClient\.(?:GetAsync|PostAsync|PutAsync|DeleteAsync)\s*\([^)]*['"`]([^'"`]+)['"`]/gi,
            /WebRequest\.Create\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            // Check URL patterns
            for (const pattern of urlPatterns) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(line)) !== null) {
                    const url = match[1] || match[0];
                    
                    // Check if known API
                    for (const [domain, apiInfo] of Object.entries(this.KNOWN_APIS)) {
                        if (url.includes(domain)) {
                            // Find related scope/permissions
                            const scopes = this.findGraphScopes(content, lineNum, lines);
                            
                            apis.push({
                                api: apiInfo.name,
                                endpoint: url,
                                method: this.detectHTTPMethod(line),
                                file: filePath,
                                line: lineNum + 1,
                                permissions: this.inferPermissions(apiInfo.type, url),
                                scopes
                            });
                            break;
                        }
                    }
                }
            }

            // Check endpoint patterns (ASP.NET, Express, Spring)
            for (const { pattern, type } of this.ENDPOINT_PATTERNS) {
                pattern.lastIndex = 0;
                let match;
                while ((match = pattern.exec(line)) !== null) {
                    const method = match[1] || 'UNKNOWN';
                    const route = match[2] || match[1] || '';
                    
                    apis.push({
                        api: type,
                        endpoint: route,
                        method: method.toUpperCase(),
                        file: filePath,
                        line: lineNum + 1,
                        permissions: this.inferPermissionsFromRoute(route),
                        scopes: []
                    });
                }
            }
        }

        return apis;
    }

    private inferPermissionsFromRoute(route: string): string[] {
        const permissions: string[] = [];
        
        // Graph API route patterns
        if (route.includes('/users')) permissions.push('User.Read', 'User.Read.All');
        if (route.includes('/me')) permissions.push('User.Read');
        if (route.includes('/groups')) permissions.push('Group.Read.All', 'Group.ReadWrite.All');
        if (route.includes('/teams')) permissions.push('Team.ReadBasic.All', 'TeamSettings.Read.All');
        if (route.includes('/channels')) permissions.push('Channel.ReadBasic.All', 'ChannelMessage.Read.All');
        if (route.includes('/chats')) permissions.push('Chat.Read', 'Chat.ReadWrite');
        if (route.includes('/sites')) permissions.push('Sites.Read.All');
        if (route.includes('/drives') || route.includes('/items')) permissions.push('Files.Read', 'Files.ReadWrite');
        if (route.includes('/mail') || route.includes('/messages')) permissions.push('Mail.Read', 'Mail.Send');
        if (route.includes('/calendar') || route.includes('/events')) permissions.push('Calendars.Read', 'Calendars.ReadWrite');
        if (route.includes('/presence')) permissions.push('Presence.Read', 'Presence.Read.All');
        if (route.includes('/subscriptions')) permissions.push('Subscription.Read.All');
        
        return permissions.length > 0 ? permissions : ['Review required'];
    }

    private findGraphScopes(content: string, currentLine: number, lines: string[]): string[] {
        const foundScopes: string[] = [];
        
        // Find scope near current line
        const searchRange = 20;
        const startLine = Math.max(0, currentLine - searchRange);
        const endLine = Math.min(lines.length, currentLine + searchRange);
        
        const nearbyContent = lines.slice(startLine, endLine).join('\n');
        
        for (const scope of this.GRAPH_SCOPES) {
            if (nearbyContent.includes(scope)) {
                foundScopes.push(scope);
            }
        }

        return foundScopes;
    }

    private detectHTTPMethod(line: string): string {
        if (/\.get\s*\(|GET/i.test(line)) return 'GET';
        if (/\.post\s*\(|POST/i.test(line)) return 'POST';
        if (/\.put\s*\(|PUT/i.test(line)) return 'PUT';
        if (/\.delete\s*\(|DELETE/i.test(line)) return 'DELETE';
        if (/\.patch\s*\(|PATCH/i.test(line)) return 'PATCH';
        return 'UNKNOWN';
    }

    private inferPermissions(apiType: string, url: string): string[] {
        const permissions: string[] = [];
        
        switch (apiType) {
            case 'msgraph':
                if (url.includes('/users')) permissions.push('User.Read', 'User.Read.All');
                if (url.includes('/me')) permissions.push('User.Read');
                if (url.includes('/mail')) permissions.push('Mail.Read', 'Mail.ReadWrite');
                if (url.includes('/calendar')) permissions.push('Calendars.Read');
                if (url.includes('/groups')) permissions.push('Group.Read.All');
                if (url.includes('/sites')) permissions.push('Sites.Read.All');
                if (url.includes('/drive')) permissions.push('Files.Read');
                break;
            case 'arm':
                permissions.push('Azure RBAC permissions required');
                break;
            case 'keyvault':
                permissions.push('Key Vault access policy required');
                break;
        }
        
        return permissions.length > 0 ? permissions : ['Unknown - manual review required'];
    }

    private findCredentials(content: string, filePath: string, lines: string[]): CredentialUsage[] {
        const credentials: CredentialUsage[] = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            for (const { pattern, type } of this.CREDENTIAL_PATTERNS) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    // Determine source
                    let source = 'Unknown';
                    let risk: 'critical' | 'high' | 'medium' | 'low' = 'medium';

                    if (/process\.env|os\.environ|Environment/i.test(line)) {
                        source = 'Environment Variable';
                        risk = 'low';
                    } else if (/config|settings|appsettings/i.test(filePath)) {
                        source = 'Config File';
                        risk = 'medium';
                    } else if (/['"`][a-zA-Z0-9-_]{20,}['"`]/.test(line)) {
                        source = '⚠️ HARDCODED';
                        risk = 'critical';
                    } else if (/keyvault|secret|vault/i.test(line)) {
                        source = 'Key Vault';
                        risk = 'low';
                    }

                    // Extract variable name
                    const nameMatch = line.match(/(?:const|let|var|private|public)?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]/);
                    const name = nameMatch ? nameMatch[1] : 'Unknown';

                    credentials.push({
                        type,
                        name,
                        source,
                        file: filePath,
                        line: lineNum + 1,
                        risk
                    });
                }
            }
        }

        return credentials;
    }

    private findCallChain(content: string, filePath: string, lines: string[]): CallChainNode[] {
        const callChain: CallChainNode[] = [];

        // Simplified call chain analysis - find function definitions and calls
        const functionPattern = /(?:async\s+)?(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:<[^>]+>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*{/g;
        const callPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

        let currentFunction = '';
        
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            // Detect function definitions
            functionPattern.lastIndex = 0;
            const funcMatch = functionPattern.exec(line);
            if (funcMatch) {
                currentFunction = funcMatch[1];
            }

            // Detect function calls
            callPattern.lastIndex = 0;
            let callMatch;
            while ((callMatch = callPattern.exec(line)) !== null) {
                const callee = callMatch[1];
                
                // Filter common non-function calls
                if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(callee)) {
                    continue;
                }

                // Determine type
                let type: 'function' | 'api' | 'external' | 'database' = 'function';
                if (/fetch|axios|request|http/i.test(callee)) type = 'api';
                if (/query|execute|find|insert|update|delete/i.test(callee)) type = 'database';

                callChain.push({
                    level: 0,
                    caller: currentFunction || 'module',
                    callee,
                    file: filePath,
                    line: lineNum + 1,
                    type
                });
            }
        }

        return callChain;
    }

    private findDataFlow(content: string, filePath: string): DataFlowPoint[] {
        const dataFlow: DataFlowPoint[] = [];
        let step = 0;

        // Detect user input points
        if (/req\.body|req\.query|req\.params|request\.form/i.test(content)) {
            dataFlow.push({
                step: ++step,
                location: filePath,
                action: 'User Input Received',
                dataType: 'Request Data',
                containsUserContent: true,
                containsPII: this.checkForPII(content)
            });
        }

        // Detect data processing
        if (/\.map\(|\.filter\(|\.reduce\(|transform|process/i.test(content)) {
            dataFlow.push({
                step: ++step,
                location: filePath,
                action: 'Data Transformation',
                dataType: 'Processed Data',
                containsUserContent: true,
                containsPII: this.checkForPII(content)
            });
        }

        // Detect database operations
        if (/\.save\(|\.insert\(|\.create\(|\.update\(|query/i.test(content)) {
            dataFlow.push({
                step: ++step,
                location: filePath,
                action: 'Database Operation',
                dataType: 'Persisted Data',
                containsUserContent: true,
                containsPII: this.checkForPII(content)
            });
        }

        // Detect external API calls
        if (/fetch|axios|http\.request/i.test(content)) {
            dataFlow.push({
                step: ++step,
                location: filePath,
                action: 'External API Call',
                dataType: 'API Request/Response',
                containsUserContent: false,
                containsPII: false
            });
        }

        // Detect responses
        if (/res\.json|res\.send|response\./i.test(content)) {
            dataFlow.push({
                step: ++step,
                location: filePath,
                action: 'Response Sent',
                dataType: 'API Response',
                containsUserContent: false,
                containsPII: this.checkForPII(content)
            });
        }

        return dataFlow;
    }

    private checkForPII(content: string): boolean {
        const piiPatterns = [
            /email|mail/i,
            /phone|mobile|tel/i,
            /address|street|city/i,
            /name|firstName|lastName/i,
            /ssn|social.?security/i,
            /credit.?card|card.?number/i,
            /passport|license/i,
            /birth.?date|dob|age/i,
        ];

        return piiPatterns.some(p => p.test(content));
    }

    private generateSecurityDocument(params: {
        scenarioName: string;
        scenarioDescription: string;
        entryPoint: string;
        analyzedFiles: string[];
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        callChain: CallChainNode[];
        dataFlow: DataFlowPoint[];
    }): string {
        const { 
            scenarioName, 
            scenarioDescription, 
            entryPoint,
            analyzedFiles,
            externalAPIs, 
            credentials, 
            callChain,
            dataFlow
        } = params;

        const now = new Date().toISOString().split('T')[0];

        let doc = `# 🛡️ Security Review: ${scenarioName}

**Review Date**: ${now}  
**Entry Point**: \`${entryPoint}\`  
**Files Analyzed**: ${analyzedFiles.length}  
**Status**: 🔄 Pending Review

---

## 1. Scenario Overview (Scenario Overview)

${scenarioDescription}

### Analyzed Files
${analyzedFiles.slice(0, 20).map(f => `- \`${f}\``).join('\n')}
${analyzedFiles.length > 20 ? `\n... and ${analyzedFiles.length - 20} more files` : ''}

---

## 2. External API Calls Analysis (External API Calls)

`;

        if (externalAPIs.length > 0) {
            // Group by API type
            const apisByType = new Map<string, ExternalAPICall[]>();
            for (const api of externalAPIs) {
                const existing = apisByType.get(api.api) || [];
                existing.push(api);
                apisByType.set(api.api, existing);
            }

            for (const [apiName, calls] of apisByType) {
                doc += `### ${apiName}

| Endpoint | Method | File | Line | Permissions/Scopes |
|----------|--------|------|------|-------------------|
`;
                for (const call of calls) {
                    const perms = [...call.permissions, ...call.scopes].join(', ') || 'N/A';
                    doc += `| \`${call.endpoint.substring(0, 50)}...\` | ${call.method} | \`${call.file}\` | ${call.line} | ${perms} |
`;
                }
                doc += '\n';
            }
        } else {
            doc += `_No external API calls detected._

`;
        }

        doc += `---

## 3. Credentials and AppID Scan (Credentials & AppID Scan)

`;

        if (credentials.length > 0) {
            // Group by risk level
            const critical = credentials.filter(c => c.risk === 'critical');
            const high = credentials.filter(c => c.risk === 'high');
            const medium = credentials.filter(c => c.risk === 'medium');
            const low = credentials.filter(c => c.risk === 'low');

            if (critical.length > 0) {
                doc += `### 🔴 Critical Risk

| Type | Name | Source | File | Line |
|------|------|--------|------|------|
`;
                for (const cred of critical) {
                    doc += `| ${cred.type} | \`${cred.name}\` | ⚠️ ${cred.source} | \`${cred.file}\` | ${cred.line} |
`;
                }
                doc += '\n';
            }

            if (high.length > 0 || medium.length > 0) {
                doc += `### 🟡 Medium/High Risk

| Type | Name | Source | File | Line | Risk |
|------|------|--------|------|------|------|
`;
                for (const cred of [...high, ...medium]) {
                    doc += `| ${cred.type} | \`${cred.name}\` | ${cred.source} | \`${cred.file}\` | ${cred.line} | ${cred.risk} |
`;
                }
                doc += '\n';
            }

            if (low.length > 0) {
                doc += `### 🟢 Low Risk (Best Practices)

| Type | Name | Source | File | Line |
|------|------|--------|------|------|
`;
                for (const cred of low) {
                    doc += `| ${cred.type} | \`${cred.name}\` | ${cred.source} | \`${cred.file}\` | ${cred.line} |
`;
                }
                doc += '\n';
            }
        } else {
            doc += `_No credentials or AppIDs detected._

`;
        }

        doc += `---

## 4. Data Flow Analysis (Data Flow Analysis)

`;

        if (dataFlow.length > 0) {
            doc += `\`\`\`
`;
            for (const point of dataFlow) {
                const piiFlag = point.containsPII ? ' [PII]' : '';
                const userFlag = point.containsUserContent ? ' [User Content]' : '';
                doc += `Step ${point.step}: ${point.action}${piiFlag}${userFlag}
         └─ ${point.location}
         └─ Data: ${point.dataType}

`;
            }
            doc += `\`\`\`

### Data Flow Summary

| Contains User Content | Contains PII | Steps |
|----------------------|--------------|-------|
| ${dataFlow.some(d => d.containsUserContent) ? '✅ Yes' : '❌ No'} | ${dataFlow.some(d => d.containsPII) ? '⚠️ Yes' : '❌ No'} | ${dataFlow.length} |

`;
        } else {
            doc += `_No data flow detected._

`;
        }

        doc += `---

## 5. Call Chain Analysis (Call Chain Analysis)

`;

        if (callChain.length > 0) {
            const apiCalls = callChain.filter(c => c.type === 'api');
            const dbCalls = callChain.filter(c => c.type === 'database');

            if (apiCalls.length > 0) {
                doc += `### API Calls

| Caller | Callee | File | Line |
|--------|--------|------|------|
`;
                for (const call of apiCalls.slice(0, 20)) {
                    doc += `| \`${call.caller}\` | \`${call.callee}\` | \`${call.file}\` | ${call.line} |
`;
                }
                doc += '\n';
            }

            if (dbCalls.length > 0) {
                doc += `### Database Operations

| Caller | Operation | File | Line |
|--------|-----------|------|------|
`;
                for (const call of dbCalls.slice(0, 20)) {
                    doc += `| \`${call.caller}\` | \`${call.callee}\` | \`${call.file}\` | ${call.line} |
`;
                }
                doc += '\n';
            }
        } else {
            doc += `_No significant call chain detected._

`;
        }

        doc += `---

## 6. Permissions Summary (Permissions Summary)

### Required Graph API Permissions

`;

        const allScopes = new Set<string>();
        externalAPIs.forEach(api => api.scopes.forEach(s => allScopes.add(s)));
        externalAPIs.forEach(api => api.permissions.forEach(p => allScopes.add(p)));

        if (allScopes.size > 0) {
            doc += `| Permission/Scope | Type | Justification |
|------------------|------|---------------|
`;
            for (const scope of allScopes) {
                const type = scope.includes('.') ? 'Delegated/Application' : 'Custom';
                doc += `| \`${scope}\` | ${type} | _Needs manual justification_ |
`;
            }
        } else {
            doc += `_No Graph API permissions detected._
`;
        }

        doc += `

---

## 7. Security Recommendations (Security Recommendations)

`;

        const recommendations: string[] = [];

        // Generate recommendations based on findings
        const criticalCreds = credentials.filter(c => c.risk === 'critical');
        if (criticalCreds.length > 0) {
            recommendations.push(`🔴 **CRITICAL**: Found ${criticalCreds.length} hardcoded credential(s). Move to Azure Key Vault or environment variables immediately.`);
        }

        if (externalAPIs.some(a => a.api.includes('Deprecated'))) {
            recommendations.push(`🟠 **HIGH**: Using deprecated Azure AD Graph API. Migrate to Microsoft Graph API.`);
        }

        if (dataFlow.some(d => d.containsPII)) {
            recommendations.push(`🟡 **MEDIUM**: PII detected in data flow. Ensure GDPR/privacy compliance.`);
        }

        if (recommendations.length === 0) {
            recommendations.push(`✅ No critical issues detected. Proceed with manual review.`);
        }

        for (const rec of recommendations) {
            doc += `- ${rec}\n`;
        }

        doc += `

---

## 8. Review Checklist (Review Checklist)

- [ ] All external API calls reviewed
- [ ] Credentials stored securely (not hardcoded)
- [ ] Graph API permissions are least-privilege
- [ ] PII handling complies with privacy policy
- [ ] Data encryption in transit and at rest
- [ ] Error handling doesn't leak sensitive info
- [ ] Logging doesn't include credentials/PII

---

## 9. Sign-off (Sign-off)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Security Reviewer | | | |
| Privacy Reviewer | | | |
| Architect | | | |

---

_Generated by TaskAgent Scenario Security Analyzer_  
_${new Date().toISOString()}_
`;

        return doc;
    }

    private async saveDocument(workspaceUri: vscode.Uri, outputPath: string, content: string): Promise<void> {
        const fileUri = vscode.Uri.joinPath(workspaceUri, outputPath);
        
        // Create directory if it doesn't exist
        const dirUri = vscode.Uri.joinPath(workspaceUri, outputPath.split('/').slice(0, -1).join('/'));
        try {
            await vscode.workspace.fs.createDirectory(dirUri);
        } catch {
            // Directory might already exist
        }
        
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    }

    /**
     * Generate a CONCISE security document focused on key findings
     */
    private generateConciseSecurityDocument(params: {
        scenarioName: string;
        scenarioDescription: string;
        entryPoint: string;
        analyzedFiles: string[];
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        callChain: CallChainNode[];
        dataFlow: DataFlowPoint[];
    }): string {
        const { 
            scenarioName, 
            scenarioDescription, 
            entryPoint,
            analyzedFiles,
            externalAPIs, 
            credentials, 
            callChain,
            dataFlow
        } = params;

        const now = new Date().toISOString().split('T')[0];
        const criticalCreds = credentials.filter(c => c.risk === 'critical');
        const highRiskCreds = credentials.filter(c => c.risk === 'high');
        const piiPoints = dataFlow.filter(d => d.containsPII);

        let doc = `# Security Review: ${scenarioName}

| Field | Value |
|-------|-------|
| **Date** | ${now} |
| **Entry Point** | \`${entryPoint}\` |
| **Files Analyzed** | ${analyzedFiles.length} |
| **Status** | 🔄 Pending Review |

## Overview

${scenarioDescription}

---

## 📊 Scenario Sequence Diagram

${this.generateMermaidSequenceDiagram(scenarioName, entryPoint, externalAPIs, callChain, dataFlow)}

---

## 🚨 Key Findings

`;

        // Only show if there are issues
        if (criticalCreds.length > 0) {
            doc += `### 🔴 Critical: Hardcoded Credentials

| Type | Name | File | Line |
|------|------|------|------|
`;
            for (const cred of criticalCreds.slice(0, 10)) {
                doc += `| ${cred.type} | \`${cred.name}\` | \`${cred.file}\` | ${cred.line} |
`;
            }
            doc += '\n';
        }

        if (highRiskCreds.length > 0) {
            doc += `### 🟠 High Risk: Credential Exposure

| Type | Name | Source | File |
|------|------|--------|------|
`;
            for (const cred of highRiskCreds.slice(0, 10)) {
                doc += `| ${cred.type} | \`${cred.name}\` | ${cred.source} | \`${cred.file}\` |
`;
            }
            doc += '\n';
        }

        if (piiPoints.length > 0) {
            doc += `### 🟡 PII Data Flow

| Location | Action | Data Type |
|----------|--------|-----------|
`;
            for (const point of piiPoints.slice(0, 10)) {
                doc += `| \`${point.location}\` | ${point.action} | ${point.dataType} |
`;
            }
            doc += '\n';
        }

        if (criticalCreds.length === 0 && highRiskCreds.length === 0 && piiPoints.length === 0) {
            doc += `✅ **No critical security issues detected.**

`;
        }

        // External APIs - only if present
        if (externalAPIs.length > 0) {
            doc += `---

## 🌐 External API Calls

| API | Endpoint | Method | Permissions |
|-----|----------|--------|-------------|
`;
            // Dedupe and limit
            const seen = new Set<string>();
            for (const api of externalAPIs) {
                const key = `${api.api}|${api.endpoint}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (seen.size > 15) break;
                
                const perms = [...api.permissions, ...api.scopes].slice(0, 3).join(', ') || 'N/A';
                const shortEndpoint = api.endpoint.length > 40 ? api.endpoint.substring(0, 40) + '...' : api.endpoint;
                doc += `| ${api.api} | \`${shortEndpoint}\` | ${api.method} | ${perms} |
`;
            }
            doc += '\n';
        }

        // Permissions summary
        const allScopes = new Set<string>();
        externalAPIs.forEach(api => {
            api.scopes.forEach(s => allScopes.add(s));
            api.permissions.forEach(p => allScopes.add(p));
        });

        if (allScopes.size > 0) {
            doc += `---

## 🔑 Required Permissions

`;
            for (const scope of Array.from(allScopes).slice(0, 15)) {
                doc += `- \`${scope}\`\n`;
            }
            doc += '\n';
        }

        // Recommendations
        doc += `---

## 📋 Recommendations

`;
        const recommendations: string[] = [];

        if (criticalCreds.length > 0) {
            recommendations.push(`🔴 **Move ${criticalCreds.length} hardcoded credential(s) to Azure Key Vault**`);
        }
        if (externalAPIs.some(a => a.api.includes('Deprecated'))) {
            recommendations.push(`🟠 **Migrate from deprecated Azure AD Graph to Microsoft Graph**`);
        }
        if (piiPoints.length > 0) {
            recommendations.push(`🟡 **Review PII handling for GDPR/privacy compliance**`);
        }
        if (recommendations.length === 0) {
            recommendations.push(`✅ No critical issues. Proceed with standard security review.`);
        }

        for (const rec of recommendations) {
            doc += `- ${rec}\n`;
        }

        doc += `
---

## ✅ Review Checklist

- [ ] External API calls reviewed
- [ ] Credentials stored securely
- [ ] Permissions are least-privilege
- [ ] PII handling compliant
- [ ] Error handling reviewed

---

| Role | Name | Date |
|------|------|------|
| Developer | | |
| Security Reviewer | | |

_Generated by TaskAgent • ${now}_
`;

        return doc;
    }

    /**
     * Generate a Mermaid sequence diagram for the scenario
     */
    private generateMermaidSequenceDiagram(
        scenarioName: string,
        entryPoint: string,
        externalAPIs: ExternalAPICall[],
        callChain: CallChainNode[],
        dataFlow: DataFlowPoint[]
    ): string {
        // Define participants based on analysis
        const participants = new Set<string>();
        participants.add('Client');
        participants.add('Server');
        
        // Add external services as participants
        const externalServices = new Map<string, string>();
        for (const api of externalAPIs) {
            const serviceName = this.getServiceShortName(api.api);
            if (!externalServices.has(serviceName)) {
                externalServices.set(serviceName, api.api);
                participants.add(serviceName);
            }
        }

        // Check for database operations
        const hasDatabase = callChain.some(c => c.type === 'database') || 
                           dataFlow.some(d => d.action.includes('Database') || d.action.includes('Persist'));
        if (hasDatabase) {
            participants.add('Database');
        }

        // Build the sequence diagram
        let diagram = '```mermaid\nsequenceDiagram\n';
        
        // Add participants
        diagram += '    participant Client\n';
        diagram += '    participant Server\n';
        for (const [shortName, fullName] of externalServices) {
            diagram += `    participant ${shortName} as ${fullName}\n`;
        }
        if (hasDatabase) {
            diagram += '    participant Database\n';
        }
        diagram += '\n';

        // Add title
        diagram += `    Note over Client,Server: ${scenarioName}\n\n`;

        // Generate sequence based on data flow
        let step = 1;
        
        // Entry point - client request
        const entryName = entryPoint.includes(':') ? entryPoint.split(':')[1] : entryPoint.split('/').pop() || 'request';
        diagram += `    Client->>+Server: ${step}. ${this.sanitizeMermaidText(entryName)}()\n`;
        step++;

        // Process data flow steps
        for (const point of dataFlow) {
            if (point.action.includes('Input') || point.action.includes('Request')) {
                // Already handled by entry point
                continue;
            }

            const piiNote = point.containsPII ? ' [PII]' : '';
            const userContentNote = point.containsUserContent ? ' [User Content]' : '';
            
            if (point.action.includes('Database') || point.action.includes('Persist')) {
                diagram += `    Server->>+Database: ${step}. ${this.sanitizeMermaidText(point.action)}${piiNote}\n`;
                diagram += `    Database-->>-Server: ${step}a. Data result\n`;
                step++;
            } else if (point.action.includes('External') || point.action.includes('API')) {
                // Match to external API if possible
                for (const [shortName] of externalServices) {
                    diagram += `    Server->>+${shortName}: ${step}. API Call${userContentNote}\n`;
                    diagram += `    ${shortName}-->>-Server: ${step}a. Response\n`;
                    step++;
                    break;
                }
            } else if (point.action.includes('Response')) {
                diagram += `    Server-->>-Client: ${step}. ${this.sanitizeMermaidText(point.dataType)}${piiNote}\n`;
                step++;
            }
        }

        // Add external API calls if not already covered
        for (const api of externalAPIs.slice(0, 5)) {
            const shortName = this.getServiceShortName(api.api);
            const perms = api.scopes.length > 0 ? api.scopes[0] : (api.permissions.length > 0 ? api.permissions[0] : '');
            const permNote = perms ? ` [${perms}]` : '';
            
            if (!diagram.includes(`->>${shortName}`)) {
                diagram += `    Server->>+${shortName}: ${step}. ${api.method} ${this.sanitizeMermaidText(this.getEndpointName(api.endpoint))}${permNote}\n`;
                diagram += `    ${shortName}-->>-Server: ${step}a. Response\n`;
                step++;
            }
        }

        // Final response if not already added
        if (!diagram.includes('Server-->>-Client')) {
            diagram += `    Server-->>-Client: ${step}. Response\n`;
        }

        diagram += '```';

        return diagram;
    }

    /**
     * Get a short service name for Mermaid participant
     */
    private getServiceShortName(apiName: string): string {
        if (apiName.includes('Microsoft Graph')) return 'MSGraph';
        if (apiName.includes('Azure AD')) return 'AzureAD';
        if (apiName.includes('Key Vault')) return 'KeyVault';
        if (apiName.includes('Blob Storage')) return 'BlobStorage';
        if (apiName.includes('Cosmos')) return 'CosmosDB';
        if (apiName.includes('SQL')) return 'AzureSQL';
        if (apiName.includes('Service Bus')) return 'ServiceBus';
        if (apiName.includes('GitHub')) return 'GitHub';
        if (apiName.includes('OpenAI')) return 'OpenAI';
        // Default: take first word
        return apiName.split(' ')[0].replace(/[^a-zA-Z]/g, '');
    }

    /**
     * Get endpoint name from full URL
     */
    private getEndpointName(endpoint: string): string {
        try {
            const url = new URL(endpoint);
            const path = url.pathname;
            // Get last 2 segments
            const segments = path.split('/').filter(s => s);
            return '/' + segments.slice(-2).join('/');
        } catch {
            // Not a valid URL, return as is (truncated)
            return endpoint.length > 30 ? endpoint.substring(0, 30) + '...' : endpoint;
        }
    }

    /**
     * Sanitize text for Mermaid (escape special characters)
     */
    private sanitizeMermaidText(text: string): string {
        return text
            .replace(/[<>]/g, '')
            .replace(/"/g, "'")
            .replace(/[{}]/g, '')
            .replace(/\n/g, ' ')
            .substring(0, 40);
    }

    // ==================== NEW ENHANCED ANALYSIS METHODS ====================

    /**
     * Find upstream APIs - who calls this scenario
     */
    private async findUpstreamAPIs(
        scenarioName: string,
        entryPoint: string | undefined,
        analyzedFiles: string[],
        token?: vscode.CancellationToken
    ): Promise<UpstreamAPI[]> {
        const upstreamAPIs: UpstreamAPI[] = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return upstreamAPIs;

        // Extract function/class name from scenario or entry point
        const targetName = entryPoint?.split(':').pop() || scenarioName;
        const searchPatterns = [
            new RegExp(`\\.${targetName}\\s*\\(`, 'gi'),
            new RegExp(`${targetName}\\s*\\(`, 'gi'),
            new RegExp(`await\\s+${targetName}`, 'gi'),
            new RegExp(`new\\s+${targetName}`, 'gi'),
        ];

        for (const filePath of analyzedFiles) {
            if (token?.isCancellationRequested) break;

            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
                const document = await vscode.workspace.openTextDocument(fileUri);
                const content = document.getText();
                const lines = content.split('\n');

                for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                    const line = lines[lineNum];
                    
                    for (const pattern of searchPatterns) {
                        pattern.lastIndex = 0;
                        if (pattern.test(line)) {
                            // Determine caller type
                            const callerType = this.determineCallerType(content, lineNum, lines);
                            const callerName = this.extractCallerName(content, lineNum, lines);
                            const routeInfo = this.extractRouteInfo(content, lineNum, lines);

                            upstreamAPIs.push({
                                caller: callerName,
                                file: filePath,
                                line: lineNum + 1,
                                callerType,
                                httpMethod: routeInfo.method,
                                route: routeInfo.route
                            });
                            break;
                        }
                    }
                }
            } catch {
                // Skip unreadable files
            }
        }

        return upstreamAPIs;
    }

    /**
     * Find downstream APIs - what this scenario calls
     */
    private async findDownstreamAPIs(
        scenarioName: string,
        entryPoint: string | undefined,
        analyzedFiles: string[],
        externalAPIs: ExternalAPICall[],
        callChain: CallChainNode[],
        token?: vscode.CancellationToken
    ): Promise<DownstreamAPI[]> {
        const downstreamAPIs: DownstreamAPI[] = [];

        // Add external API calls as downstream
        for (const api of externalAPIs) {
            downstreamAPIs.push({
                callee: api.api,
                file: api.file,
                line: api.line,
                calleeType: 'external',
                api: api.api,
                endpoint: api.endpoint
            });
        }

        // Add database calls from call chain
        for (const node of callChain) {
            if (node.type === 'database') {
                downstreamAPIs.push({
                    callee: node.callee,
                    file: node.file,
                    line: node.line,
                    calleeType: 'database'
                });
            }
        }

        // Search for internal service calls
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return downstreamAPIs;

        const servicePatterns = [
            /(\w+Service)\.\w+\s*\(/gi,
            /(\w+Repository)\.\w+\s*\(/gi,
            /(\w+Manager)\.\w+\s*\(/gi,
            /(\w+Client)\.\w+\s*\(/gi,
            /(\w+Handler)\.\w+\s*\(/gi,
        ];

        for (const filePath of analyzedFiles) {
            if (token?.isCancellationRequested) break;

            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
                const document = await vscode.workspace.openTextDocument(fileUri);
                const content = document.getText();
                const lines = content.split('\n');

                for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                    const line = lines[lineNum];
                    
                    for (const pattern of servicePatterns) {
                        pattern.lastIndex = 0;
                        let match;
                        while ((match = pattern.exec(line)) !== null) {
                            const serviceName = match[1];
                            // Avoid duplicates
                            if (!downstreamAPIs.some(d => d.callee === serviceName && d.file === filePath)) {
                                downstreamAPIs.push({
                                    callee: serviceName,
                                    file: filePath,
                                    line: lineNum + 1,
                                    calleeType: 'internal'
                                });
                            }
                        }
                    }
                }
            } catch {
                // Skip
            }
        }

        return downstreamAPIs;
    }

    /**
     * Build complete call path from entry to exit
     */
    private buildCallPath(
        scenarioName: string,
        entryPoint: string | undefined,
        upstreamAPIs: UpstreamAPI[],
        downstreamAPIs: DownstreamAPI[],
        callChain: CallChainNode[],
        externalAPIs: ExternalAPICall[]
    ): CallPathStep[] {
        const callPath: CallPathStep[] = [];
        let step = 1;

        // Step 1: Entry point (from upstream)
        if (upstreamAPIs.length > 0) {
            const entry = upstreamAPIs[0];
            callPath.push({
                step: step++,
                function: entry.caller,
                file: entry.file,
                line: entry.line,
                action: `HTTP ${entry.httpMethod || 'REQUEST'} ${entry.route || 'incoming'}`,
                permissions: [],
                dataAccess: []
            });
        }

        // Step 2: Scenario entry
        callPath.push({
            step: step++,
            function: entryPoint?.split(':').pop() || scenarioName,
            file: entryPoint?.split(':')[0] || 'unknown',
            line: 1,
            action: 'Scenario Entry Point',
            permissions: [],
            dataAccess: []
        });

        // Step 3: Internal calls from call chain
        for (const node of callChain.slice(0, 10)) {
            callPath.push({
                step: step++,
                function: node.callee,
                file: node.file,
                line: node.line,
                action: node.type === 'database' ? 'Database Operation' : 
                        node.type === 'external' ? 'External API Call' : 
                        'Internal Call',
                permissions: [],
                dataAccess: node.type === 'database' ? ['Database'] : []
            });
        }

        // Step 4: External API calls
        for (const api of externalAPIs.slice(0, 5)) {
            callPath.push({
                step: step++,
                function: `${api.method} ${api.endpoint}`,
                file: api.file,
                line: api.line,
                action: `Call ${api.api}`,
                permissions: [...api.permissions, ...api.scopes],
                dataAccess: ['External Service']
            });
        }

        // Step 5: Response
        callPath.push({
            step: step++,
            function: 'Response',
            file: entryPoint?.split(':')[0] || 'unknown',
            line: 0,
            action: 'Return Response',
            permissions: [],
            dataAccess: []
        });

        return callPath;
    }

    /**
     * Extract all scope requirements
     */
    private extractScopeRequirements(
        externalAPIs: ExternalAPICall[],
        analyzedFiles: string[]
    ): ScopeRequirement[] {
        const requirements: ScopeRequirement[] = [];
        const seenScopes = new Set<string>();

        for (const api of externalAPIs) {
            // Add scopes
            for (const scope of api.scopes) {
                if (!seenScopes.has(scope)) {
                    seenScopes.add(scope);
                    requirements.push({
                        scope,
                        reason: `Required by ${api.api}`,
                        usedIn: `${api.file}:${api.line}`,
                        permissionType: this.determinePermissionType(scope),
                        accessLevel: this.determineAccessLevel(scope)
                    });
                }
            }

            // Add permissions
            for (const perm of api.permissions) {
                if (!seenScopes.has(perm)) {
                    seenScopes.add(perm);
                    requirements.push({
                        scope: perm,
                        reason: `Required by ${api.api}`,
                        usedIn: `${api.file}:${api.line}`,
                        permissionType: this.determinePermissionType(perm),
                        accessLevel: this.determineAccessLevel(perm)
                    });
                }
            }
        }

        return requirements;
    }

    /**
     * Determine caller type based on code context
     */
    private determineCallerType(content: string, lineNum: number, lines: string[]): 'controller' | 'service' | 'handler' | 'middleware' | 'other' {
        // Look for class/function context
        const nearbyContent = lines.slice(Math.max(0, lineNum - 20), lineNum + 1).join('\n');
        
        if (/Controller|@Controller|@RestController/i.test(nearbyContent)) return 'controller';
        if (/Service|@Service/i.test(nearbyContent)) return 'service';
        if (/Handler|RequestHandler|EventHandler/i.test(nearbyContent)) return 'handler';
        if (/middleware|@Middleware/i.test(nearbyContent)) return 'middleware';
        return 'other';
    }

    /**
     * Extract caller function/method name
     */
    private extractCallerName(content: string, lineNum: number, lines: string[]): string {
        // Look backwards for function/method declaration
        for (let i = lineNum; i >= Math.max(0, lineNum - 30); i--) {
            const line = lines[i];
            
            // Match various function declarations
            const patterns = [
                /(?:async\s+)?(?:function\s+)?(\w+)\s*\([^)]*\)\s*[:{]/,
                /(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)/,
                /(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
                /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/,
            ];

            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }
        }
        return 'unknown';
    }

    /**
     * Extract route info from code context
     */
    private extractRouteInfo(content: string, lineNum: number, lines: string[]): { method?: string; route?: string } {
        const nearbyContent = lines.slice(Math.max(0, lineNum - 10), lineNum + 1).join('\n');
        
        // Express/Koa patterns
        const expressMatch = nearbyContent.match(/\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/i);
        if (expressMatch) {
            return { method: expressMatch[1].toUpperCase(), route: expressMatch[2] };
        }

        // Decorator patterns (@Get, @Post, etc.)
        const decoratorMatch = nearbyContent.match(/@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]?([^'"`\)]+)['"`]?\s*\)/i);
        if (decoratorMatch) {
            return { method: decoratorMatch[1].toUpperCase(), route: decoratorMatch[2] };
        }

        // ASP.NET patterns
        const aspMatch = nearbyContent.match(/\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]?([^'"`\]]+)['"`]?\s*\)\]/i);
        if (aspMatch) {
            return { method: aspMatch[1].toUpperCase(), route: aspMatch[2] };
        }

        return {};
    }

    /**
     * Determine if permission is delegated or application
     */
    private determinePermissionType(scope: string): 'delegated' | 'application' {
        // Application permissions typically end with .All
        if (scope.endsWith('.All')) return 'application';
        return 'delegated';
    }

    /**
     * Determine access level from scope name
     */
    private determineAccessLevel(scope: string): 'read' | 'write' | 'admin' {
        const lowerScope = scope.toLowerCase();
        if (lowerScope.includes('write') || lowerScope.includes('send') || lowerScope.includes('create')) return 'write';
        if (lowerScope.includes('admin') || lowerScope.includes('full')) return 'admin';
        return 'read';
    }

    /**
     * Generate enhanced summary with upstream/downstream info
     */
    private generateEnhancedSummary(params: {
        scenarioName: string;
        outputPath: string;
        filesAnalyzed: number;
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        dataFlow: DataFlowPoint[];
        upstreamAPIs: UpstreamAPI[];
        downstreamAPIs: DownstreamAPI[];
        scopeRequirements: ScopeRequirement[];
    }): string {
        const { 
            scenarioName, outputPath, filesAnalyzed, externalAPIs, 
            credentials, dataFlow, upstreamAPIs, downstreamAPIs, scopeRequirements 
        } = params;
        
        const criticalCreds = credentials.filter(c => c.risk === 'critical').length;
        const highRiskCreds = credentials.filter(c => c.risk === 'high').length;
        const piiDataPoints = dataFlow.filter(d => d.containsPII).length;
        const hasIssues = criticalCreds > 0 || highRiskCreds > 0;

        return `✅ Security Analysis Complete

**Scenario**: ${scenarioName}
**Output**: \`${outputPath}\`

**📊 Analysis Summary**:
- 📁 Files analyzed: ${filesAnalyzed}
- ⬆️ Upstream callers: ${upstreamAPIs.length}
- ⬇️ Downstream dependencies: ${downstreamAPIs.length}
- 🌐 External APIs: ${externalAPIs.length}
- 🔑 Required Scopes: ${scopeRequirements.length}

**🔐 Permission Requirements**:
${scopeRequirements.slice(0, 5).map(s => `- \`${s.scope}\` (${s.accessLevel})`).join('\n') || '- None detected'}

**⚠️ Risk Assessment**:
${criticalCreds > 0 ? `- 🔴 Critical: ${criticalCreds} hardcoded credentials` : ''}
${highRiskCreds > 0 ? `- 🟠 High: ${highRiskCreds} credential exposures` : ''}
${piiDataPoints > 0 ? `- 🟡 PII detected in ${piiDataPoints} data flow points` : ''}
${!hasIssues && piiDataPoints === 0 ? '- ✅ No critical issues detected' : ''}

${hasIssues ? '⚠️ **Action Required**: Review the security document for details.' : ''}

📄 Full report with sequence diagram saved to \`${outputPath}\``;
    }

    /**
     * Generate enhanced security document with all new analysis
     */
    private generateEnhancedSecurityDocument(params: {
        scenarioName: string;
        scenarioDescription: string;
        entryPoint: string;
        analyzedFiles: string[];
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        callChain: CallChainNode[];
        dataFlow: DataFlowPoint[];
        upstreamAPIs: UpstreamAPI[];
        downstreamAPIs: DownstreamAPI[];
        callPath: CallPathStep[];
        scopeRequirements: ScopeRequirement[];
    }): string {
        const { 
            scenarioName, scenarioDescription, entryPoint, analyzedFiles,
            externalAPIs, callChain, upstreamAPIs, downstreamAPIs,
            callPath, scopeRequirements
        } = params;

        const now = new Date().toISOString().split('T')[0];

        let doc = `# Security Review: ${scenarioName}

| Field | Value |
|-------|-------|
| **Date** | ${now} |
| **Entry Point** | \`${entryPoint}\` |
| **Files Analyzed** | ${analyzedFiles.length} |

---

## 1️⃣ Scenario Overview (场景描述)

${scenarioDescription || '_No description provided. Please describe what this scenario does._'}

### Analyzed Files
${analyzedFiles.slice(0, 10).map(f => `- \`${f}\``).join('\n')}
${analyzedFiles.length > 10 ? `\n_... and ${analyzedFiles.length - 10} more files_` : ''}

---

## 2️⃣ Permissions & Scopes (权限与 Scope)

`;

        // Collect all permissions and scopes
        const allScopes: { scope: string; type: string; reason: string; location: string }[] = [];
        
        for (const req of scopeRequirements) {
            allScopes.push({
                scope: req.scope,
                type: req.permissionType,
                reason: req.reason,
                location: req.usedIn
            });
        }

        // Also extract from external APIs
        for (const api of externalAPIs) {
            for (const scope of api.scopes) {
                if (!allScopes.some(s => s.scope === scope)) {
                    allScopes.push({
                        scope,
                        type: 'delegated',
                        reason: `${api.api} - ${api.method} ${api.endpoint}`,
                        location: `${api.file}:${api.line}`
                    });
                }
            }
            for (const perm of api.permissions) {
                if (!allScopes.some(s => s.scope === perm)) {
                    allScopes.push({
                        scope: perm,
                        type: 'application',
                        reason: `${api.api} - ${api.method} ${api.endpoint}`,
                        location: `${api.file}:${api.line}`
                    });
                }
            }
        }

        if (allScopes.length > 0) {
            doc += `| Permission / Scope | Type | Reason | Location |
|-------------------|------|--------|----------|
`;
            for (const s of allScopes.slice(0, 20)) {
                doc += `| \`${s.scope}\` | ${s.type} | ${s.reason} | \`${s.location}\` |
`;
            }
        } else {
            doc += `_No permissions or scopes detected. Manual review required._
`;
        }

        doc += `
---

## 3️⃣ Call Stack / Workflow (调用栈)

### Sequence Diagram

${this.generateEnhancedMermaidDiagram(scenarioName, entryPoint, upstreamAPIs, downstreamAPIs, externalAPIs, callChain, [])}

### Step-by-Step Call Path

`;

        if (callPath.length > 0) {
            doc += `| Step | Action | Function | File | Permissions |
|------|--------|----------|------|-------------|
`;
            for (const step of callPath) {
                const perms = step.permissions.slice(0, 2).join(', ') || '-';
                doc += `| ${step.step} | ${step.action} | \`${step.function}\` | \`${step.file}:${step.line}\` | ${perms} |
`;
            }
        } else {
            // Fallback to call chain
            doc += `| Caller | Callee | Type | File | Line |
|--------|--------|------|------|------|
`;
            for (const node of callChain.slice(0, 20)) {
                doc += `| \`${node.caller}\` | \`${node.callee}\` | ${node.type} | \`${node.file}\` | ${node.line} |
`;
            }
        }

        doc += `
---

## 4️⃣ Underlying APIs & Response (底层 API 与 Response)

`;

        if (externalAPIs.length > 0) {
            for (const api of this.deduplicateAPIs(externalAPIs).slice(0, 15)) {
                const scopes = [...api.permissions, ...api.scopes].join(', ') || 'N/A';
                
                doc += `### ${api.api}

- **Endpoint**: \`${api.method} ${api.endpoint}\`
- **Location**: \`${api.file}:${api.line}\`
- **Required Scopes**: ${scopes}

**Expected Response Body**:
\`\`\`json
${this.inferResponseBody(api)}
\`\`\`

---

`;
            }
        } else {
            doc += `_No external API calls detected._

`;
        }

        // Internal service calls
        const internalCalls = downstreamAPIs.filter(d => d.calleeType === 'internal');
        const dbCalls = downstreamAPIs.filter(d => d.calleeType === 'database');

        if (internalCalls.length > 0) {
            doc += `### Internal Service Calls

| Service | File | Line |
|---------|------|------|
`;
            for (const call of internalCalls.slice(0, 10)) {
                doc += `| \`${call.callee}\` | \`${call.file}\` | ${call.line} |
`;
            }
            doc += '\n';
        }

        if (dbCalls.length > 0) {
            doc += `### Database Operations

| Operation | File | Line |
|-----------|------|------|
`;
            for (const call of dbCalls.slice(0, 10)) {
                doc += `| \`${call.callee}\` | \`${call.file}\` | ${call.line} |
`;
            }
            doc += '\n';
        }

        doc += `---

## ✅ Review Checklist

- [ ] Scenario purpose verified
- [ ] All permissions justified (least privilege)
- [ ] Call stack reviewed
- [ ] API responses contain no sensitive data leakage
- [ ] Error handling reviewed

---

| Role | Name | Date |
|------|------|------|
| Developer | | |
| Security Reviewer | | |

_Generated by TaskAgent Security Analyzer • ${now}_
`;

        return doc;
    }

    /**
     * Deduplicate APIs by endpoint
     */
    private deduplicateAPIs(apis: ExternalAPICall[]): ExternalAPICall[] {
        const seen = new Map<string, ExternalAPICall>();
        for (const api of apis) {
            const key = `${api.api}|${api.method}|${api.endpoint}`;
            if (!seen.has(key)) {
                seen.set(key, api);
            }
        }
        return Array.from(seen.values());
    }

    /**
     * Infer expected response body based on API endpoint
     */
    private inferResponseBody(api: ExternalAPICall): string {
        const endpoint = api.endpoint.toLowerCase();
        
        // Microsoft Graph API responses
        if (api.api.includes('Graph')) {
            if (endpoint.includes('/users') || endpoint.includes('/me')) {
                return `{
  "@odata.context": "...",
  "id": "user-guid",
  "displayName": "User Name",
  "mail": "user@example.com",
  "userPrincipalName": "user@example.com"
}`;
            }
            if (endpoint.includes('/groups')) {
                return `{
  "@odata.context": "...",
  "id": "group-guid",
  "displayName": "Group Name",
  "description": "...",
  "members@odata.count": 10
}`;
            }
            if (endpoint.includes('/teams')) {
                return `{
  "@odata.context": "...",
  "id": "team-guid",
  "displayName": "Team Name",
  "description": "...",
  "isArchived": false
}`;
            }
            if (endpoint.includes('/channels')) {
                return `{
  "@odata.context": "...",
  "id": "channel-guid",
  "displayName": "Channel Name",
  "membershipType": "standard"
}`;
            }
            if (endpoint.includes('/messages') || endpoint.includes('/chats')) {
                return `{
  "@odata.context": "...",
  "id": "message-guid",
  "body": { "content": "..." },
  "from": { "user": { "displayName": "..." } }
}`;
            }
            if (endpoint.includes('/drives') || endpoint.includes('/items')) {
                return `{
  "@odata.context": "...",
  "id": "item-guid",
  "name": "filename.docx",
  "size": 12345,
  "webUrl": "https://..."
}`;
            }
        }

        // Azure APIs
        if (api.api.includes('Azure')) {
            return `{
  "id": "/subscriptions/.../resource-id",
  "name": "resource-name",
  "type": "Microsoft.../resourceType",
  "properties": { ... }
}`;
        }

        // Generic REST response
        return `{
  "status": "success",
  "data": { ... }
}`;
    }

    /**
     * Generate enhanced Mermaid diagram with upstream/downstream
     */
    private generateEnhancedMermaidDiagram(
        scenarioName: string,
        entryPoint: string,
        upstreamAPIs: UpstreamAPI[],
        downstreamAPIs: DownstreamAPI[],
        externalAPIs: ExternalAPICall[],
        callChain: CallChainNode[],
        dataFlow: DataFlowPoint[]
    ): string {
        let diagram = '```mermaid\nsequenceDiagram\n';
        
        // Participants
        diagram += '    participant Client\n';
        
        // Add upstream callers as participants
        const upstreamNames = new Set<string>();
        for (const api of upstreamAPIs.slice(0, 3)) {
            const name = api.caller.replace(/[^a-zA-Z0-9]/g, '');
            if (!upstreamNames.has(name)) {
                upstreamNames.add(name);
                diagram += `    participant ${name} as ${api.caller}\n`;
            }
        }

        diagram += `    participant Scenario as ${scenarioName}\n`;

        // Add external services
        const externalServices = new Map<string, string>();
        for (const api of externalAPIs.slice(0, 4)) {
            const serviceName = this.getServiceShortName(api.api);
            if (!externalServices.has(serviceName)) {
                externalServices.set(serviceName, api.api);
                diagram += `    participant ${serviceName} as ${api.api}\n`;
            }
        }

        // Add database if present
        const hasDatabase = downstreamAPIs.some(d => d.calleeType === 'database');
        if (hasDatabase) {
            diagram += '    participant DB as Database\n';
        }

        diagram += '\n';
        diagram += `    Note over Client,Scenario: ${scenarioName} Flow\n\n`;

        let step = 1;

        // Upstream calls
        if (upstreamAPIs.length > 0) {
            const upstream = upstreamAPIs[0];
            const upstreamName = upstream.caller.replace(/[^a-zA-Z0-9]/g, '');
            const route = upstream.route || '/api/...';
            diagram += `    Client->>+${upstreamName}: ${step}. ${upstream.httpMethod || 'REQUEST'} ${route}\n`;
            step++;
            diagram += `    ${upstreamName}->>+Scenario: ${step}. call()\n`;
            step++;
        } else {
            diagram += `    Client->>+Scenario: ${step}. Request\n`;
            step++;
        }

        // External API calls
        for (const api of externalAPIs.slice(0, 4)) {
            const serviceName = this.getServiceShortName(api.api);
            const scope = api.scopes[0] || api.permissions[0] || '';
            const scopeNote = scope ? ` [${scope}]` : '';
            diagram += `    Scenario->>+${serviceName}: ${step}. ${api.method}${scopeNote}\n`;
            diagram += `    ${serviceName}-->>-Scenario: ${step}a. Response\n`;
            step++;
        }

        // Database calls
        if (hasDatabase) {
            const dbCall = downstreamAPIs.find(d => d.calleeType === 'database');
            if (dbCall) {
                diagram += `    Scenario->>+DB: ${step}. ${dbCall.callee}\n`;
                diagram += `    DB-->>-Scenario: ${step}a. Data\n`;
                step++;
            }
        }

        // Response chain
        if (upstreamAPIs.length > 0) {
            const upstream = upstreamAPIs[0];
            const upstreamName = upstream.caller.replace(/[^a-zA-Z0-9]/g, '');
            diagram += `    Scenario-->>-${upstreamName}: ${step}. Result\n`;
            step++;
            diagram += `    ${upstreamName}-->>-Client: ${step}. Response\n`;
        } else {
            diagram += `    Scenario-->>-Client: ${step}. Response\n`;
        }

        diagram += '```';
        return diagram;
    }

    // ============================================
    // Enhanced Analysis Methods for Call Stack, Tokens, OAuth, and Headers
    // ============================================

    /**
     * Find OAuth/MSAL authentication flows in the code
     */
    private findOAuthFlows(content: string, filePath: string, lines: string[]): CredentialUsage[] {
        const oauthFlows: CredentialUsage[] = [];
        
        const oauthPatterns = [
            { pattern: /AcquireTokenAsync|AcquireTokenSilent|AcquireTokenInteractive/gi, type: 'MSAL Token Acquisition' },
            { pattern: /GetTokenAsync|GetAccessTokenAsync/gi, type: 'Token Fetch' },
            { pattern: /ConfidentialClientApplicationBuilder|PublicClientApplicationBuilder/gi, type: 'MSAL Client Builder' },
            { pattern: /client_credentials|authorization_code|refresh_token|implicit|password/gi, type: 'OAuth Grant Type' },
            { pattern: /\.WithClientSecret\(|\.WithCertificate\(/gi, type: 'Client Auth Method' },
            { pattern: /TokenCredential|DefaultAzureCredential|ManagedIdentityCredential/gi, type: 'Azure Identity' },
            { pattern: /OnBehalfOfCredential|ClientSecretCredential|ClientCertificateCredential/gi, type: 'Azure Credential Type' },
            { pattern: /ITokenAcquisition|IAuthenticationResult/gi, type: 'Token Interface' },
            { pattern: /\.Scopes\s*=|\.AddScopes\(|WithScopes\(/gi, type: 'Scope Configuration' },
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            for (const { pattern, type } of oauthPatterns) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    const risk = this.assessOAuthRisk(line, lines, lineNum);
                    oauthFlows.push({
                        type,
                        name: this.extractVariableName(line),
                        source: this.determineOAuthSource(line, lines, lineNum),
                        file: filePath,
                        line: lineNum + 1,
                        risk
                    });
                }
            }
        }

        return oauthFlows;
    }

    private assessOAuthRisk(line: string, lines: string[], lineNum: number): 'critical' | 'high' | 'medium' | 'low' {
        // Check for hardcoded secrets
        if (/['"][a-zA-Z0-9~_-]{30,}['"]/i.test(line)) return 'critical';
        // Check for insecure grant types
        if (/password|implicit/i.test(line)) return 'high';
        // Check for client credentials in code
        if (/client_credentials/i.test(line) && !/.env|config/i.test(line)) return 'high';
        // Managed identity is low risk
        if (/ManagedIdentity|DefaultAzureCredential/i.test(line)) return 'low';
        return 'medium';
    }

    private determineOAuthSource(line: string, lines: string[], lineNum: number): string {
        if (/Configuration|IOptions|appsettings/i.test(line)) return 'Configuration';
        if (/Environment\.|process\.env|os\.environ/i.test(line)) return 'Environment Variable';
        if (/KeyVault|SecretClient/i.test(line)) return 'Azure Key Vault';
        if (/ManagedIdentity/i.test(line)) return 'Managed Identity';
        if (/['"][a-zA-Z0-9~_-]{20,}['"]/i.test(line)) return '⚠️ HARDCODED';
        return 'Code';
    }

    /**
     * Find HTTP Header configurations and security-sensitive headers
     */
    private findHttpHeaders(content: string, filePath: string, lines: string[]): CredentialUsage[] {
        const headerFindings: CredentialUsage[] = [];
        
        const headerPatterns = [
            { pattern: /Authorization\s*[:=]\s*['"`]Bearer\s+([^'"`]+)['"`]/gi, type: 'Bearer Token Header' },
            { pattern: /['"](x-api-key|api-key|apikey)['"]\s*[:=]/gi, type: 'API Key Header' },
            { pattern: /['"]Authorization['"]\s*[:=]\s*['"`]Basic\s+/gi, type: 'Basic Auth Header' },
            { pattern: /\.DefaultRequestHeaders\.Authorization/gi, type: 'HttpClient Auth Header' },
            { pattern: /AddDefaultHeader\s*\(\s*['"]Authorization['"]/gi, type: 'Default Auth Header' },
            { pattern: /headers\s*\[\s*['"]Authorization['"]\s*\]/gi, type: 'Auth Header Assignment' },
            { pattern: /\.SetBearerToken\(/gi, type: 'Bearer Token Setup' },
            { pattern: /X-Forwarded-|X-Real-IP|X-Client-/gi, type: 'Proxy Header' },
            { pattern: /CORS|Access-Control-Allow/gi, type: 'CORS Header' },
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            for (const { pattern, type } of headerPatterns) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    const risk = this.assessHeaderRisk(line, type);
                    headerFindings.push({
                        type,
                        name: this.extractVariableName(line),
                        source: this.determineHeaderSource(line),
                        file: filePath,
                        line: lineNum + 1,
                        risk
                    });
                }
            }
        }

        return headerFindings;
    }

    private assessHeaderRisk(line: string, type: string): 'critical' | 'high' | 'medium' | 'low' {
        if (type === 'Basic Auth Header') return 'high'; // Basic auth is less secure
        if (/['"][A-Za-z0-9+/=]{30,}['"]/i.test(line)) return 'critical'; // Hardcoded token
        if (/\*|Access-Control-Allow-Origin:\s*\*/i.test(line)) return 'high'; // Open CORS
        return 'medium';
    }

    private determineHeaderSource(line: string): string {
        if (/\$\{|\+\s*\w+|`\$\{/i.test(line)) return 'Variable Interpolation';
        if (/['"][A-Za-z0-9+/=]{30,}['"]/i.test(line)) return '⚠️ HARDCODED TOKEN';
        if (/token|credential|secret/i.test(line)) return 'Token Variable';
        return 'Code';
    }

    /**
     * Find token handling patterns (creation, storage, validation)
     */
    private findTokenHandling(content: string, filePath: string, lines: string[]): CredentialUsage[] {
        const tokenFindings: CredentialUsage[] = [];
        
        const tokenPatterns = [
            { pattern: /JWT|JsonWebToken|JwtSecurityToken/gi, type: 'JWT Token' },
            { pattern: /CreateToken|GenerateToken|SignToken/gi, type: 'Token Generation' },
            { pattern: /ValidateToken|VerifyToken|DecodeToken/gi, type: 'Token Validation' },
            { pattern: /\.Claims|ClaimTypes\.|ClaimsPrincipal/gi, type: 'Token Claims' },
            { pattern: /RefreshToken|refresh_token/gi, type: 'Refresh Token' },
            { pattern: /AccessToken|access_token/gi, type: 'Access Token' },
            { pattern: /IdToken|id_token/gi, type: 'ID Token' },
            { pattern: /TokenValidationParameters/gi, type: 'Token Validation Config' },
            { pattern: /IssuerSigningKey|SymmetricSecurityKey/gi, type: 'Token Signing Key' },
            { pattern: /localStorage\.setItem.*token|sessionStorage\.setItem.*token/gi, type: 'Client Token Storage' },
            { pattern: /cookie.*token|token.*cookie/gi, type: 'Token in Cookie' },
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
            for (const { pattern, type } of tokenPatterns) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    const risk = this.assessTokenRisk(line, type);
                    tokenFindings.push({
                        type,
                        name: this.extractVariableName(line),
                        source: this.determineTokenSource(line, type),
                        file: filePath,
                        line: lineNum + 1,
                        risk
                    });
                }
            }
        }

        return tokenFindings;
    }

    private assessTokenRisk(line: string, type: string): 'critical' | 'high' | 'medium' | 'low' {
        if (type === 'Client Token Storage' && /localStorage/i.test(line)) return 'high'; // XSS vulnerable
        if (type === 'Token Signing Key' && /['"][a-zA-Z0-9]{10,}['"]/i.test(line)) return 'critical'; // Hardcoded key
        if (type === 'Token in Cookie' && !/HttpOnly|Secure/i.test(line)) return 'high'; // Insecure cookie
        if (/Refresh|refresh/i.test(type)) return 'medium'; // Refresh tokens need care
        return 'low';
    }

    private determineTokenSource(line: string, type: string): string {
        if (type.includes('Client Token Storage')) return 'Browser Storage';
        if (type.includes('Cookie')) return 'HTTP Cookie';
        if (type.includes('Generation') || type.includes('Signing')) return 'Server Generation';
        if (type.includes('Validation')) return 'Token Validation';
        return 'Code';
    }

    private extractVariableName(line: string): string {
        // Try to extract variable name from assignment
        const patterns = [
            /(?:const|let|var|private|public|protected)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]/,
            /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/,
            /\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,
        ];
        
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match && match[1]) return match[1];
        }
        
        return 'Unknown';
    }

    /**
     * Enhanced call chain analysis using symbol references
     */
    private async findEnhancedCallChain(
        filePath: string,
        functionName: string,
        lines: string[],
        depth: number = 3
    ): Promise<CallChainNode[]> {
        const callChain: CallChainNode[] = [];
        
        // Find function definition
        const funcPattern = new RegExp(`(?:async\\s+)?(?:function\\s+)?${functionName}\\s*(?:<[^>]+>)?\\s*\\([^)]*\\)`, 'gi');
        let funcStartLine = -1;
        let funcEndLine = -1;
        let braceCount = 0;
        let inFunction = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (!inFunction && funcPattern.test(line)) {
                funcStartLine = i;
                inFunction = true;
                braceCount = 0;
            }
            
            if (inFunction) {
                braceCount += (line.match(/{/g) || []).length;
                braceCount -= (line.match(/}/g) || []).length;
                
                if (braceCount <= 0 && funcStartLine !== i) {
                    funcEndLine = i;
                    break;
                }
            }
        }

        if (funcStartLine >= 0 && funcEndLine >= 0) {
            // Extract calls within this function
            for (let i = funcStartLine; i <= funcEndLine; i++) {
                const line = lines[i];
                
                // Find method calls
                const callPatterns = [
                    /await\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*\(/g,
                    /([a-zA-Z_][a-zA-Z0-9_.]+)\s*\(/g,
                ];

                for (const pattern of callPatterns) {
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(line)) !== null) {
                        const callee = match[1];
                        
                        // Skip common control flow
                        if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new', 'console', 'Math'].includes(callee.split('.')[0])) {
                            continue;
                        }

                        let type: 'function' | 'api' | 'external' | 'database' = 'function';
                        if (/fetch|axios|http|request|client/i.test(callee)) type = 'api';
                        if (/query|execute|find|save|insert|update|delete|repository/i.test(callee)) type = 'database';
                        if (/Graph|Azure|AWS|External/i.test(callee)) type = 'external';

                        callChain.push({
                            level: depth,
                            caller: functionName,
                            callee,
                            file: filePath,
                            line: i + 1,
                            type
                        });
                    }
                }
            }
        }

        return callChain;
    }
}




























