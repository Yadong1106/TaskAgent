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
    ];

    // Graph API Permission/Scope patterns
    private readonly GRAPH_SCOPES = [
        'User.Read', 'User.ReadWrite', 'User.ReadBasic.All', 'User.Read.All', 'User.ReadWrite.All',
        'Mail.Read', 'Mail.ReadWrite', 'Mail.Send',
        'Calendars.Read', 'Calendars.ReadWrite',
        'Files.Read', 'Files.ReadWrite', 'Files.ReadWrite.All',
        'Directory.Read.All', 'Directory.ReadWrite.All',
        'Group.Read.All', 'Group.ReadWrite.All',
        'Application.Read.All', 'Application.ReadWrite.All',
        'Sites.Read.All', 'Sites.ReadWrite.All',
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
            outputPath
        } = options.input;

        try {
            // 1. Scan entire codebase
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            // 2. Find all related files
            const allFiles = await this.findRelevantFiles(scenarioName, entryPoint, searchKeywords, token);

            // 3. Deep analyze each file
            const externalAPIs: ExternalAPICall[] = [];
            const credentials: CredentialUsage[] = [];
            const callChain: CallChainNode[] = [];
            const dataFlow: DataFlowPoint[] = [];

            for (const filePath of allFiles) {
                if (token.isCancellationRequested) break;

                const fileAnalysis = await this.analyzeFile(filePath, token);
                externalAPIs.push(...fileAnalysis.externalAPIs);
                credentials.push(...fileAnalysis.credentials);
                callChain.push(...fileAnalysis.callChain);
                dataFlow.push(...fileAnalysis.dataFlow);
            }

            // 4. NEW: Analyze upstream APIs (who calls this scenario)
            const upstreamAPIs = await this.findUpstreamAPIs(scenarioName, entryPoint, allFiles, token);

            // 5. NEW: Analyze downstream APIs (what this scenario calls)
            const downstreamAPIs = await this.findDownstreamAPIs(scenarioName, entryPoint, allFiles, externalAPIs, callChain, token);

            // 6. NEW: Build complete call path
            const callPath = this.buildCallPath(scenarioName, entryPoint, upstreamAPIs, downstreamAPIs, callChain, externalAPIs);

            // 7. NEW: Extract all scope requirements
            const scopeRequirements = this.extractScopeRequirements(externalAPIs, allFiles);

            // 8. Generate enhanced security review document
            const document = this.generateEnhancedSecurityDocument({
                scenarioName,
                scenarioDescription: scenarioDescription || 'No description provided',
                entryPoint: entryPoint || 'Auto-detected',
                analyzedFiles: allFiles,
                externalAPIs,
                credentials,
                callChain,
                dataFlow,
                upstreamAPIs,
                downstreamAPIs,
                callPath,
                scopeRequirements
            });

            // 9. Determine output path - save next to current active file or workspace root
            const activeEditor = vscode.window.activeTextEditor;
            let baseDir = workspaceFolder.uri;
            if (activeEditor) {
                // Save in the same directory as the currently open file
                baseDir = vscode.Uri.joinPath(activeEditor.document.uri, '..');
            }
            const fileName = `security-review-${scenarioName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.md`;
            const finalOutputPath = outputPath || fileName;
            const fileUri = outputPath 
                ? vscode.Uri.joinPath(workspaceFolder.uri, outputPath)
                : vscode.Uri.joinPath(baseDir, fileName);
            
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(document, 'utf-8'));

            // 10. Open the generated document in the editor
            try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch (e) {
                console.warn('Could not open generated document:', e);
            }

            // 11. Return concise summary
            const summary = this.generateEnhancedSummary({
                scenarioName,
                outputPath: finalOutputPath,
                filesAnalyzed: allFiles.length,
                externalAPIs,
                credentials,
                dataFlow,
                upstreamAPIs,
                downstreamAPIs,
                scopeRequirements
            });

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(summary)
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Failed to analyze scenario: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
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

        // Search patterns
        const patterns = [
            '**/*.ts',
            '**/*.js',
            '**/*.tsx',
            '**/*.jsx',
            '**/*.py',
            '**/*.cs',
            '**/*.java',
            '**/*.go',
            '**/appsettings*.json',
            '**/.env*',
            '**/config*.json',
            '**/config*.yaml',
            '**/config*.yml',
        ];

        for (const pattern of patterns) {
            const foundFiles = await vscode.workspace.findFiles(
                pattern,
                '**/node_modules/**',
                500,
                token
            );

            for (const file of foundFiles) {
                files.add(vscode.workspace.asRelativePath(file));
            }
        }

        // If entry point exists, prioritize it
        if (entryPoint) {
            const entryFile = entryPoint.split(':')[0];
            if (!files.has(entryFile)) {
                files.add(entryFile);
            }
        }

        return Array.from(files);
    }

    private async analyzeFile(
        filePath: string,
        token?: vscode.CancellationToken
    ): Promise<{
        externalAPIs: ExternalAPICall[];
        credentials: CredentialUsage[];
        callChain: CallChainNode[];
        dataFlow: DataFlowPoint[];
    }> {
        const externalAPIs: ExternalAPICall[] = [];
        const credentials: CredentialUsage[] = [];
        const callChain: CallChainNode[] = [];
        const dataFlow: DataFlowPoint[] = [];

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return { externalAPIs, credentials, callChain, dataFlow };

            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            const lines = content.split('\n');

            // Analyze external API calls
            externalAPIs.push(...this.findExternalAPIs(content, filePath, lines));

            // Analyze credential usage
            credentials.push(...this.findCredentials(content, filePath, lines));

            // Analyze call chain (simplified - LSP can provide more accurate info)
            callChain.push(...this.findCallChain(content, filePath, lines));

            // Analyze data flow
            dataFlow.push(...this.findDataFlow(content, filePath));

        } catch {
            // File unreadable, skip
        }

        return { externalAPIs, credentials, callChain, dataFlow };
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
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            
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
        }

        return apis;
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
            externalAPIs, credentials, dataFlow, upstreamAPIs, downstreamAPIs,
            callPath, scopeRequirements, callChain
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

${this.generateEnhancedMermaidDiagram(scenarioName, entryPoint, upstreamAPIs, downstreamAPIs, externalAPIs, callChain, dataFlow)}

---

## ⬆️ Upstream APIs (Who Calls This Scenario)

`;

        if (upstreamAPIs.length > 0) {
            doc += `| Caller | Type | HTTP Method | Route | File | Line |
|--------|------|-------------|-------|------|------|
`;
            for (const api of upstreamAPIs.slice(0, 15)) {
                doc += `| \`${api.caller}\` | ${api.callerType} | ${api.httpMethod || 'N/A'} | ${api.route || 'N/A'} | \`${api.file}\` | ${api.line} |
`;
            }
        } else {
            doc += `_No upstream callers detected. This may be an entry point._\n`;
        }

        doc += `
---

## ⬇️ Downstream APIs (What This Scenario Calls)

`;

        if (downstreamAPIs.length > 0) {
            doc += `| Callee | Type | API/Endpoint | File | Line |
|--------|------|--------------|------|------|
`;
            for (const api of downstreamAPIs.slice(0, 15)) {
                const endpoint = api.endpoint ? api.endpoint.substring(0, 40) : 'N/A';
                doc += `| \`${api.callee}\` | ${api.calleeType} | ${endpoint} | \`${api.file}\` | ${api.line} |
`;
            }
        } else {
            doc += `_No downstream dependencies detected._\n`;
        }

        doc += `
---

## 🛤️ Call Path (Step by Step)

\`\`\`
`;
        for (const step of callPath) {
            const perms = step.permissions.length > 0 ? ` [${step.permissions.slice(0, 2).join(', ')}]` : '';
            doc += `Step ${step.step}: ${step.action}${perms}
    └─ ${step.function}
    └─ ${step.file}:${step.line}

`;
        }
        doc += `\`\`\`

---

## 🔑 Scope & Permission Requirements

`;

        if (scopeRequirements.length > 0) {
            doc += `| Scope | Type | Access Level | Reason | Used In |
|-------|------|--------------|--------|---------|
`;
            for (const req of scopeRequirements) {
                doc += `| \`${req.scope}\` | ${req.permissionType} | ${req.accessLevel} | ${req.reason} | \`${req.usedIn}\` |
`;
            }
        } else {
            doc += `_No specific scopes detected._\n`;
        }

        doc += `
---

## 🚨 Key Findings

`;

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
            doc += `✅ **No critical security issues detected.**\n\n`;
        }

        // External APIs
        if (externalAPIs.length > 0) {
            doc += `---

## 🌐 External API Calls

| API | Endpoint | Method | Permissions |
|-----|----------|--------|-------------|
`;
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
        if (scopeRequirements.some(s => s.accessLevel === 'admin')) {
            recommendations.push(`🟡 **Review admin-level permissions - ensure least privilege**`);
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

- [ ] Upstream callers verified
- [ ] Downstream dependencies reviewed
- [ ] All scopes justified (least privilege)
- [ ] Credentials stored securely
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
}














