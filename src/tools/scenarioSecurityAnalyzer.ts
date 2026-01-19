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

            // 4. Generate security review document
            const document = this.generateSecurityDocument({
                scenarioName,
                scenarioDescription: scenarioDescription || 'No description provided',
                entryPoint: entryPoint || 'Auto-detected',
                analyzedFiles: allFiles,
                externalAPIs,
                credentials,
                callChain,
                dataFlow
            });

            // 5. Save document (if path specified)
            if (outputPath) {
                await this.saveDocument(workspaceFolder.uri, outputPath, document);
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(document)
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Failed to analyze scenario: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
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
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    }
}














