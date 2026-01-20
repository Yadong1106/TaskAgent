import * as vscode from 'vscode';

export interface SecurityReviewInput {
    featureName: string;
    featureDescription?: string;
    targetFiles?: string[];      // File paths to analyze
    outputPath?: string;         // Output document path
    includeDataFlow?: boolean;   // Whether to include data flow analysis
    includePermissions?: boolean; // Whether to include permissions analysis
}

interface SecurityFinding {
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    description: string;
    location?: string;
    recommendation?: string;
}

interface DataFlowEntry {
    endpoint: string;
    method: string;
    requestContainsUserContent: boolean;
    userContentFields: string[];
    responseValue: string;
    permissions: string[];
    dataClassification: string;
}

/**
 * SecurityReviewTool - Generate security review document
 * 
 * Document includes:
 * 1. Feature/scenario overview
 * 2. System architecture and data flow
 * 3. Permissions and credentials usage
 * 4. External dependencies
 * 5. Data classification and privacy impact
 * 6. Request/Response analysis (User Content, Response Value, Permissions)
 */
export class SecurityReviewTool implements vscode.LanguageModelTool<SecurityReviewInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SecurityReviewInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { featureName } = options.input;
        return {
            invocationMessage: `Generating Security Review document for: ${featureName}`,
            confirmationMessages: {
                title: 'Security Review',
                message: new vscode.MarkdownString(
                    `Generate a security review document for **${featureName}**?\n\n` +
                    `This will analyze:\n` +
                    `- System architecture & data flow\n` +
                    `- Permissions & credentials\n` +
                    `- External dependencies\n` +
                    `- Data classification & privacy impact`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SecurityReviewInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { 
            featureName, 
            featureDescription,
            targetFiles,
            outputPath,
            includeDataFlow = true,
            includePermissions = true
        } = options.input;

        try {
            // Analyze code if target files provided
            let codeAnalysis = '';
            let dataFlowEntries: DataFlowEntry[] = [];
            let securityFindings: SecurityFinding[] = [];

            if (targetFiles && targetFiles.length > 0) {
                const analysis = await this.analyzeFiles(targetFiles, token);
                codeAnalysis = analysis.summary;
                dataFlowEntries = analysis.dataFlow;
                securityFindings = analysis.findings;
            }

            // Generate the security review document
            const document = this.generateSecurityReviewDocument({
                featureName,
                featureDescription: featureDescription || 'No description provided',
                codeAnalysis,
                dataFlowEntries,
                securityFindings,
                includeDataFlow,
                includePermissions
            });

            // Determine output path - always save to file
            const finalOutputPath = outputPath || `docs/security-review-${featureName.toLowerCase().replace(/\s+/g, '-')}.md`;
            await this.saveDocument(finalOutputPath, document);

            // Return concise summary instead of full document
            const summary = this.generateSummary(featureName, finalOutputPath, securityFindings, dataFlowEntries);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(summary)
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Failed to generate security review: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
    }

    private generateSummary(
        featureName: string, 
        outputPath: string, 
        findings: SecurityFinding[], 
        dataFlow: DataFlowEntry[]
    ): string {
        const critical = findings.filter(f => f.severity === 'critical').length;
        const high = findings.filter(f => f.severity === 'high').length;
        const medium = findings.filter(f => f.severity === 'medium').length;

        return `✅ Security Review Generated

**Feature**: ${featureName}
**Output**: \`${outputPath}\`

**Summary**:
- 📊 Endpoints analyzed: ${dataFlow.length}
- 🔴 Critical issues: ${critical}
- 🟠 High issues: ${high}
- 🟡 Medium issues: ${medium}

${critical > 0 ? '⚠️ Critical issues found - immediate attention required!' : '✅ No critical issues detected.'}

View the full report at \`${outputPath}\``;
    }

    private async analyzeFiles(
        filePaths: string[], 
        token: vscode.CancellationToken
    ): Promise<{
        summary: string;
        dataFlow: DataFlowEntry[];
        findings: SecurityFinding[];
    }> {
        const dataFlow: DataFlowEntry[] = [];
        const findings: SecurityFinding[] = [];
        let summary = '';

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { summary: 'No workspace folder', dataFlow, findings };
        }

        for (const filePath of filePaths) {
            if (token.isCancellationRequested) break;

            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
                const document = await vscode.workspace.openTextDocument(fileUri);
                const content = document.getText();

                // Analyze for API endpoints and data flow
                const apiPatterns = this.extractAPIPatterns(content, filePath);
                dataFlow.push(...apiPatterns);

                // Check for security issues
                const fileFindings = this.checkSecurityPatterns(content, filePath);
                findings.push(...fileFindings);

                summary += `\n- Analyzed: ${filePath}`;
            } catch {
                summary += `\n- Skipped (not found): ${filePath}`;
            }
        }

        return { summary, dataFlow, findings };
    }

    private extractAPIPatterns(content: string, filePath: string): DataFlowEntry[] {
        const entries: DataFlowEntry[] = [];

        // Detect Express/HTTP endpoints
        const expressPatterns = [
            /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ];

        for (const pattern of expressPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const method = match[1].toUpperCase();
                const endpoint = match[2];

                // Analyze request body usage
                const hasReqBody = content.includes('req.body');
                const hasReqParams = content.includes('req.params');
                const hasReqQuery = content.includes('req.query');

                const userContentFields: string[] = [];
                if (hasReqBody) userContentFields.push('req.body');
                if (hasReqParams) userContentFields.push('req.params');
                if (hasReqQuery) userContentFields.push('req.query');

                entries.push({
                    endpoint,
                    method,
                    requestContainsUserContent: userContentFields.length > 0,
                    userContentFields,
                    responseValue: this.detectResponseType(content, endpoint),
                    permissions: this.detectPermissions(content),
                    dataClassification: this.classifyDataSensitivity(content, endpoint)
                });
            }
        }

        // Detect fetch/axios calls
        const fetchPatterns = [
            /fetch\s*\(\s*['"`]([^'"`]+)['"`]/gi,
            /axios\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        ];

        for (const pattern of fetchPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const endpoint = match[1] || match[2];
                const method = match[1] ? 'GET' : match[1]?.toUpperCase() || 'GET';

                entries.push({
                    endpoint,
                    method,
                    requestContainsUserContent: content.includes('body:') || content.includes('data:'),
                    userContentFields: [],
                    responseValue: 'JSON response',
                    permissions: this.detectPermissions(content),
                    dataClassification: this.classifyDataSensitivity(content, endpoint)
                });
            }
        }

        return entries;
    }

    private detectResponseType(content: string, _endpoint: string): string {
        if (content.includes('res.json')) return 'JSON object';
        if (content.includes('res.send')) return 'Text/HTML';
        if (content.includes('res.render')) return 'Rendered view';
        if (content.includes('res.redirect')) return 'Redirect';
        if (content.includes('res.download')) return 'File download';
        return 'Unknown';
    }

    private detectPermissions(content: string): string[] {
        const permissions: string[] = [];

        // Common permission patterns
        if (content.includes('isAuthenticated') || content.includes('requireAuth')) {
            permissions.push('Authentication required');
        }
        if (content.includes('isAdmin') || content.includes('requireAdmin')) {
            permissions.push('Admin role required');
        }
        if (content.includes('checkPermission') || content.includes('hasPermission')) {
            permissions.push('Permission check');
        }
        if (content.includes('Bearer') || content.includes('Authorization')) {
            permissions.push('Bearer token');
        }
        if (content.includes('API_KEY') || content.includes('apiKey')) {
            permissions.push('API key');
        }
        if (content.includes('OAuth') || content.includes('oauth')) {
            permissions.push('OAuth');
        }

        // File system access
        if (content.includes('fs.read') || content.includes('fs.write')) {
            permissions.push('File system access');
        }

        // Database access
        if (content.includes('mongoose') || content.includes('sequelize') || content.includes('prisma')) {
            permissions.push('Database access');
        }

        // Network access
        if (content.includes('fetch') || content.includes('axios') || content.includes('http.request')) {
            permissions.push('Network access');
        }

        return permissions.length > 0 ? permissions : ['None detected'];
    }

    private classifyDataSensitivity(content: string, endpoint: string): string {
        const lowercaseContent = content.toLowerCase();
        const lowercaseEndpoint = endpoint.toLowerCase();

        // High sensitivity indicators
        if (lowercaseContent.includes('password') || 
            lowercaseContent.includes('secret') ||
            lowercaseContent.includes('credit') ||
            lowercaseContent.includes('ssn') ||
            lowercaseEndpoint.includes('/auth') ||
            lowercaseEndpoint.includes('/login')) {
            return '🔴 HIGH - Contains credentials/sensitive data';
        }

        // Medium sensitivity
        if (lowercaseContent.includes('email') ||
            lowercaseContent.includes('phone') ||
            lowercaseContent.includes('address') ||
            lowercaseContent.includes('user') ||
            lowercaseEndpoint.includes('/user') ||
            lowercaseEndpoint.includes('/profile')) {
            return '🟡 MEDIUM - Contains PII';
        }

        // Low sensitivity
        if (lowercaseEndpoint.includes('/public') ||
            lowercaseEndpoint.includes('/health') ||
            lowercaseEndpoint.includes('/status')) {
            return '🟢 LOW - Public data';
        }

        return '🟡 MEDIUM - Needs manual review';
    }

    private checkSecurityPatterns(content: string, filePath: string): SecurityFinding[] {
        const findings: SecurityFinding[] = [];

        // Check for hardcoded secrets
        const secretPatterns = [
            { pattern: /['"`](sk-[a-zA-Z0-9]{32,})['"`]/g, name: 'API Key (OpenAI format)' },
            { pattern: /['"`]([a-zA-Z0-9]{32,64})['"`]/g, name: 'Possible hardcoded secret' },
            { pattern: /password\s*[:=]\s*['"`][^'"`]+['"`]/gi, name: 'Hardcoded password' },
        ];

        for (const { pattern, name } of secretPatterns) {
            if (pattern.test(content)) {
                findings.push({
                    category: 'Credentials',
                    severity: 'critical',
                    description: `${name} found in code`,
                    location: filePath,
                    recommendation: 'Move to environment variables or secret manager'
                });
            }
        }

        // Check for SQL injection risks
        if (/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(content) ||
            /['"`]\s*\+\s*.*\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(content)) {
            findings.push({
                category: 'Injection',
                severity: 'high',
                description: 'Potential SQL injection vulnerability',
                location: filePath,
                recommendation: 'Use parameterized queries or ORM'
            });
        }

        // Check for XSS risks
        if (content.includes('innerHTML') || content.includes('dangerouslySetInnerHTML')) {
            findings.push({
                category: 'XSS',
                severity: 'high',
                description: 'Potential XSS vulnerability (innerHTML usage)',
                location: filePath,
                recommendation: 'Sanitize user input or use safe alternatives'
            });
        }

        // Check for eval usage
        if (/\beval\s*\(/g.test(content)) {
            findings.push({
                category: 'Code Injection',
                severity: 'critical',
                description: 'eval() usage detected',
                location: filePath,
                recommendation: 'Avoid eval() - use safer alternatives'
            });
        }

        // Check for missing input validation
        if (content.includes('req.body') && !content.includes('validate') && !content.includes('schema')) {
            findings.push({
                category: 'Input Validation',
                severity: 'medium',
                description: 'Request body used without apparent validation',
                location: filePath,
                recommendation: 'Add input validation (Joi, Zod, etc.)'
            });
        }

        return findings;
    }

    private generateSecurityReviewDocument(params: {
        featureName: string;
        featureDescription: string;
        codeAnalysis: string;
        dataFlowEntries: DataFlowEntry[];
        securityFindings: SecurityFinding[];
        includeDataFlow: boolean;
        includePermissions: boolean;
    }): string {
        const { 
            featureName, 
            featureDescription, 
            codeAnalysis,
            dataFlowEntries,
            securityFindings,
            includeDataFlow,
            includePermissions
        } = params;

        const now = new Date().toISOString().split('T')[0];

        let doc = `# Security Review Document

## Feature: ${featureName}

**Review Date**: ${now}  
**Status**: 🔄 Pending Review  
**Reviewer**: _To be assigned_

---

## 1. Feature Overview (Feature Overview)

${featureDescription}

${codeAnalysis ? `### Code Analysis Summary\n${codeAnalysis}` : ''}

---

## 2. System Architecture and Data Flow (System Architecture & Data Flow)

### 2.1 Architecture Diagram

\`\`\`
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   Server    │────▶│  Database   │
│  (Browser)  │◀────│   (API)     │◀────│             │
└─────────────┘     └─────────────┘     └─────────────┘
\`\`\`

### 2.2 Data Flow Analysis

`;

        if (includeDataFlow && dataFlowEntries.length > 0) {
            doc += `| Endpoint | Method | User Content | Response | Data Classification |
|----------|--------|--------------|----------|---------------------|
`;
            for (const entry of dataFlowEntries) {
                doc += `| \`${entry.endpoint}\` | ${entry.method} | ${entry.requestContainsUserContent ? '✅ Yes' : '❌ No'} | ${entry.responseValue} | ${entry.dataClassification} |
`;
            }
        } else {
            doc += `_No API endpoints detected or data flow analysis not included._

`;
        }

        doc += `
---

## 3. Permissions and Credentials (Permissions & Credentials)

### 3.1 Required Permissions

`;

        if (includePermissions && dataFlowEntries.length > 0) {
            const allPermissions = new Set<string>();
            dataFlowEntries.forEach(e => e.permissions.forEach(p => allPermissions.add(p)));

            doc += `| Permission | Purpose | Risk Level |
|------------|---------|------------|
`;
            for (const perm of allPermissions) {
                const riskLevel = this.assessPermissionRisk(perm);
                doc += `| ${perm} | _Needs manual description_ | ${riskLevel} |
`;
            }
        } else {
            doc += `_No permissions detected._

`;
        }

        doc += `
### 3.2 Credential Storage

| Credential Type | Storage Method | Rotation Policy |
|-----------------|----------------|-----------------|
| API Keys | Environment Variables | _TBD_ |
| Database Credentials | Secret Manager | _TBD_ |
| OAuth Tokens | Secure Cookie | _TBD_ |

---

## 4. External Dependencies (External Dependencies)

### 4.1 Third-Party Services

| Service | Purpose | Data Shared | Privacy Policy |
|---------|---------|-------------|----------------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ |

### 4.2 NPM Packages (Security Audit)

\`\`\`bash
# Run to check for vulnerabilities:
npm audit
\`\`\`

---

## 5. Data Classification and Privacy Impact (Data Classification & Privacy Impact)

### 5.1 Data Classification Matrix

| Data Type | Classification | Storage | Encryption | Retention |
|-----------|---------------|---------|------------|-----------|
| User credentials | 🔴 Confidential | Hashed | Required | Per policy |
| PII (email, name) | 🟡 Internal | Database | At rest | User request |
| Usage logs | 🟢 Public | Logs | Optional | 90 days |

### 5.2 Privacy Impact Assessment

- [ ] GDPR Compliance checked
- [ ] Data minimization applied
- [ ] User consent mechanism in place
- [ ] Data deletion capability exists
- [ ] Cross-border transfer reviewed

---

## 6. Request/Response Security Analysis (API Security Analysis)

### 6.1 Endpoints with User Content

`;

        const userContentEndpoints = dataFlowEntries.filter(e => e.requestContainsUserContent);
        if (userContentEndpoints.length > 0) {
            for (const entry of userContentEndpoints) {
                doc += `#### \`${entry.method} ${entry.endpoint}\`

| Aspect | Details |
|--------|---------|
| **User Content Fields** | ${entry.userContentFields.join(', ') || 'N/A'} |
| **Response Value** | ${entry.responseValue} |
| **Required Permissions** | ${entry.permissions.join(', ')} |
| **Data Classification** | ${entry.dataClassification} |

`;
            }
        } else {
            doc += `_No endpoints with user content detected._

`;
        }

        doc += `---

## 7. Security Findings (Security Findings)

`;

        if (securityFindings.length > 0) {
            doc += `| Severity | Category | Description | Location | Recommendation |
|----------|----------|-------------|----------|----------------|
`;
            for (const finding of securityFindings) {
                const severityIcon = {
                    critical: '🔴',
                    high: '🟠',
                    medium: '🟡',
                    low: '🔵',
                    info: 'ℹ️'
                }[finding.severity];
                doc += `| ${severityIcon} ${finding.severity.toUpperCase()} | ${finding.category} | ${finding.description} | \`${finding.location}\` | ${finding.recommendation} |
`;
            }
        } else {
            doc += `✅ No security issues detected by automated scan.

⚠️ **Note**: This is an automated scan. Manual review is still required.

`;
        }

        doc += `---

## 8. Review Checklist (Review Checklist)

### Authentication & Authorization
- [ ] All endpoints require appropriate authentication
- [ ] Role-based access control is implemented
- [ ] Session management is secure

### Input Validation
- [ ] All user inputs are validated
- [ ] File uploads are restricted and scanned
- [ ] SQL/NoSQL injection prevented

### Data Protection
- [ ] Sensitive data is encrypted at rest
- [ ] Data is encrypted in transit (HTTPS)
- [ ] PII is handled according to policy

### Logging & Monitoring
- [ ] Security events are logged
- [ ] Logs do not contain sensitive data
- [ ] Alerting is configured

---

## 9. Sign-off (Sign-off)

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| Security Reviewer | | | |
| Tech Lead | | | |
| PM | | | |

---

_Document generated by TaskAgent Security Review Tool_  
_Generated on: ${new Date().toISOString()}_
`;

        return doc;
    }

    private assessPermissionRisk(permission: string): string {
        const highRisk = ['Database access', 'File system access', 'Admin role required'];
        const mediumRisk = ['Authentication required', 'Bearer token', 'API key', 'OAuth'];
        
        if (highRisk.some(r => permission.includes(r))) return '🔴 High';
        if (mediumRisk.some(r => permission.includes(r))) return '🟡 Medium';
        return '🟢 Low';
    }

    private async saveDocument(outputPath: string, content: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder');
        }

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, outputPath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    }
}














