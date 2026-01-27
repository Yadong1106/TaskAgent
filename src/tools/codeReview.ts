import * as vscode from 'vscode';

export interface CodeReviewInput {
    filePath?: string;
    code?: string;
    reviewType?: 'security' | 'performance' | 'quality' | 'all';
    language?: string;
}

interface ReviewIssue {
    severity: 'critical' | 'warning' | 'info' | 'suggestion';
    category: string;
    line?: number;
    message: string;
    suggestion?: string;
}

/**
 * CodeReviewTool - Automated code review with security, performance, and quality checks
 */
export class CodeReviewTool implements vscode.LanguageModelTool<CodeReviewInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CodeReviewInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { filePath, reviewType = 'all' } = options.input;
        return {
            invocationMessage: `Reviewing code: ${filePath || 'provided snippet'} (${reviewType})`,
            confirmationMessages: {
                title: 'Code Review',
                message: new vscode.MarkdownString(
                    `Review code for:\n\n**${filePath || 'Code snippet'}**\n\nReview type: ${reviewType}`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<CodeReviewInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, code, reviewType = 'all', language } = options.input;

        try {
            let sourceCode = code;
            let detectedLanguage = language;

            // Read file if path provided
            if (filePath && !sourceCode) {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    throw new Error('No workspace folder open');
                }
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                sourceCode = Buffer.from(fileContent).toString('utf-8');
                detectedLanguage = this.detectLanguage(filePath);
            }

            if (!sourceCode) {
                throw new Error('No code provided for review');
            }

            // Perform reviews based on type
            const issues: ReviewIssue[] = [];

            if (reviewType === 'all' || reviewType === 'security') {
                issues.push(...this.reviewSecurity(sourceCode, detectedLanguage || 'javascript'));
            }
            if (reviewType === 'all' || reviewType === 'performance') {
                issues.push(...this.reviewPerformance(sourceCode, detectedLanguage || 'javascript'));
            }
            if (reviewType === 'all' || reviewType === 'quality') {
                issues.push(...this.reviewQuality(sourceCode, detectedLanguage || 'javascript'));
            }

            return this.formatReviewResults(issues, filePath || 'code snippet');

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Code review failed: ${errorMsg}`)
            ]);
        }
    }

    private detectLanguage(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const langMap: Record<string, string> = {
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'py': 'python',
            'go': 'go',
            'rs': 'rust',
            'java': 'java',
            'cs': 'csharp',
            'rb': 'ruby',
            'php': 'php'
        };
        return langMap[ext || ''] || 'javascript';
    }

    private reviewSecurity(code: string, language: string): ReviewIssue[] {
        const issues: ReviewIssue[] = [];
        const lines = code.split('\n');

        // Common security patterns across languages
        const securityPatterns: Array<{
            pattern: RegExp;
            category: string;
            message: string;
            suggestion: string;
            severity: 'critical' | 'warning';
        }> = [
            // SQL Injection
            {
                pattern: /(\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE))|(?:query|execute)\s*\([^)]*\+/i,
                category: 'SQL Injection',
                message: 'Possible SQL injection vulnerability - string concatenation in query',
                suggestion: 'Use parameterized queries or prepared statements',
                severity: 'critical'
            },
            // Command Injection
            {
                pattern: /(?:exec|spawn|system|eval)\s*\([^)]*\+/i,
                category: 'Command Injection',
                message: 'Possible command injection - user input in system command',
                suggestion: 'Sanitize input or use safer alternatives',
                severity: 'critical'
            },
            // Hardcoded Secrets
            {
                pattern: /(?:password|secret|api_?key|token|auth)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i,
                category: 'Hardcoded Secret',
                message: 'Possible hardcoded secret or credential',
                suggestion: 'Use environment variables or secret management',
                severity: 'critical'
            },
            // Eval usage
            {
                pattern: /\beval\s*\(/,
                category: 'Code Injection',
                message: 'Use of eval() is dangerous and can lead to code injection',
                suggestion: 'Avoid eval() - use safer alternatives like JSON.parse()',
                severity: 'critical'
            },
            // innerHTML
            {
                pattern: /\.innerHTML\s*=/,
                category: 'XSS',
                message: 'Direct innerHTML assignment may lead to XSS',
                suggestion: 'Use textContent or sanitize HTML input',
                severity: 'warning'
            },
            // Unsafe deserialization
            {
                pattern: /pickle\.loads?|yaml\.load\s*\([^)]*\)/,
                category: 'Insecure Deserialization',
                message: 'Unsafe deserialization can lead to RCE',
                suggestion: 'Use yaml.safe_load() or validate input before deserializing',
                severity: 'critical'
            },
            // Path traversal
            {
                pattern: /(?:readFile|writeFile|open)\s*\([^)]*\+/,
                category: 'Path Traversal',
                message: 'File path includes user input - possible path traversal',
                suggestion: 'Validate and sanitize file paths, use path.resolve()',
                severity: 'warning'
            }
        ];

        lines.forEach((line, index) => {
            for (const check of securityPatterns) {
                if (check.pattern.test(line)) {
                    issues.push({
                        severity: check.severity,
                        category: check.category,
                        line: index + 1,
                        message: check.message,
                        suggestion: check.suggestion
                    });
                }
            }
        });

        return issues;
    }

    private reviewPerformance(code: string, language: string): ReviewIssue[] {
        const issues: ReviewIssue[] = [];
        const lines = code.split('\n');

        const perfPatterns: Array<{
            pattern: RegExp;
            category: string;
            message: string;
            suggestion: string;
        }> = [
            // Nested loops
            {
                pattern: /for\s*\([^)]*\)[\s\S]*for\s*\([^)]*\)/,
                category: 'Nested Loops',
                message: 'Nested loops detected - O(n²) complexity',
                suggestion: 'Consider using Map/Set for lookups or restructuring logic'
            },
            // Array methods in loops
            {
                pattern: /for\s*\([^)]*\)[\s\S]*\.(?:find|filter|includes)\s*\(/,
                category: 'Inefficient Search',
                message: 'Array search method inside loop',
                suggestion: 'Pre-compute lookups using Map or Set'
            },
            // Synchronous operations
            {
                pattern: /(?:readFileSync|writeFileSync|execSync)/,
                category: 'Blocking I/O',
                message: 'Synchronous file/exec operation blocks event loop',
                suggestion: 'Use async versions for better performance'
            },
            // Large regex in loops
            {
                pattern: /(?:for|while)\s*\([^)]*\)[\s\S]*new RegExp/,
                category: 'Regex in Loop',
                message: 'Creating RegExp inside loop',
                suggestion: 'Move regex creation outside the loop'
            },
            // Console.log in production
            {
                pattern: /console\.(?:log|debug|info)\s*\(/,
                category: 'Debug Code',
                message: 'Console logging should be removed in production',
                suggestion: 'Use a proper logging framework or remove debug logs'
            },
            // Memory leaks - event listeners
            {
                pattern: /addEventListener\s*\([^)]+\)/,
                category: 'Memory Leak Risk',
                message: 'Event listener added - ensure cleanup',
                suggestion: 'Add corresponding removeEventListener in cleanup'
            }
        ];

        const fullCode = lines.join('\n');
        lines.forEach((line, index) => {
            for (const check of perfPatterns) {
                if (check.pattern.test(line) || (index === 0 && check.pattern.test(fullCode))) {
                    if (!issues.find(i => i.category === check.category && i.line === index + 1)) {
                        issues.push({
                            severity: 'warning',
                            category: check.category,
                            line: index + 1,
                            message: check.message,
                            suggestion: check.suggestion
                        });
                    }
                }
            }
        });

        return issues;
    }

    private reviewQuality(code: string, language: string): ReviewIssue[] {
        const issues: ReviewIssue[] = [];
        const lines = code.split('\n');

        // Check for long functions
        let functionLines = 0;
        let functionStart = 0;
        let braceCount = 0;
        let inFunction = false;

        lines.forEach((line, index) => {
            // Detect function start
            if (/(?:function\s+\w+|=>\s*\{|(?:async\s+)?(?:\w+\s*)?\([^)]*\)\s*\{)/.test(line)) {
                if (!inFunction) {
                    inFunction = true;
                    functionStart = index;
                    functionLines = 0;
                }
            }

            if (inFunction) {
                functionLines++;
                braceCount += (line.match(/\{/g) || []).length;
                braceCount -= (line.match(/\}/g) || []).length;

                if (braceCount === 0 && functionLines > 50) {
                    issues.push({
                        severity: 'warning',
                        category: 'Function Length',
                        line: functionStart + 1,
                        message: `Function is ${functionLines} lines long`,
                        suggestion: 'Consider breaking into smaller functions (< 50 lines recommended)'
                    });
                    inFunction = false;
                } else if (braceCount === 0) {
                    inFunction = false;
                }
            }

            // Check line length
            if (line.length > 120) {
                issues.push({
                    severity: 'info',
                    category: 'Line Length',
                    line: index + 1,
                    message: `Line is ${line.length} characters long`,
                    suggestion: 'Keep lines under 120 characters for readability'
                });
            }

            // Check for TODO/FIXME
            if (/\/\/\s*(?:TODO|FIXME|HACK|XXX)/i.test(line)) {
                issues.push({
                    severity: 'info',
                    category: 'Incomplete Code',
                    line: index + 1,
                    message: 'TODO/FIXME comment found',
                    suggestion: 'Address or track this technical debt'
                });
            }

            // Check for magic numbers
            if (/(?<![.\w])(?:0x[a-f0-9]+|\d{4,})(?![.\w])/i.test(line) &&
                !/(?:const|let|var|=|port|size|length|width|height)/i.test(line)) {
                issues.push({
                    severity: 'suggestion',
                    category: 'Magic Number',
                    line: index + 1,
                    message: 'Magic number detected',
                    suggestion: 'Extract to named constant for clarity'
                });
            }

            // Check for empty catch blocks
            if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
                issues.push({
                    severity: 'warning',
                    category: 'Error Handling',
                    line: index + 1,
                    message: 'Empty catch block swallows errors',
                    suggestion: 'Log the error or handle it appropriately'
                });
            }

            // Check for any type in TypeScript
            if (language === 'typescript' && /:\s*any(?:\s|;|,|\)|$)/.test(line)) {
                issues.push({
                    severity: 'warning',
                    category: 'Type Safety',
                    line: index + 1,
                    message: 'Using "any" type bypasses type checking',
                    suggestion: 'Use specific types or "unknown" with type guards'
                });
            }
        });

        return issues;
    }

    private formatReviewResults(issues: ReviewIssue[], target: string): vscode.LanguageModelToolResult {
        const critical = issues.filter(i => i.severity === 'critical');
        const warnings = issues.filter(i => i.severity === 'warning');
        const info = issues.filter(i => i.severity === 'info');
        const suggestions = issues.filter(i => i.severity === 'suggestion');

        let report = `# Code Review Report\n\n`;
        report += `**Target:** ${target}\n\n`;
        report += `## Summary\n\n`;
        report += `| Severity | Count |\n`;
        report += `|----------|-------|\n`;
        report += `| 🔴 Critical | ${critical.length} |\n`;
        report += `| 🟡 Warning | ${warnings.length} |\n`;
        report += `| 🔵 Info | ${info.length} |\n`;
        report += `| 💡 Suggestion | ${suggestions.length} |\n\n`;

        if (critical.length > 0) {
            report += `## 🔴 Critical Issues\n\n`;
            for (const issue of critical) {
                report += `### ${issue.category}${issue.line ? ` (Line ${issue.line})` : ''}\n`;
                report += `${issue.message}\n\n`;
                if (issue.suggestion) {
                    report += `**Fix:** ${issue.suggestion}\n\n`;
                }
            }
        }

        if (warnings.length > 0) {
            report += `## 🟡 Warnings\n\n`;
            for (const issue of warnings) {
                report += `- **${issue.category}**${issue.line ? ` (Line ${issue.line})` : ''}: ${issue.message}\n`;
                if (issue.suggestion) {
                    report += `  - Fix: ${issue.suggestion}\n`;
                }
            }
            report += '\n';
        }

        if (info.length > 0) {
            report += `## 🔵 Info\n\n`;
            for (const issue of info) {
                report += `- **${issue.category}**${issue.line ? ` (Line ${issue.line})` : ''}: ${issue.message}\n`;
            }
            report += '\n';
        }

        if (suggestions.length > 0) {
            report += `## 💡 Suggestions\n\n`;
            for (const issue of suggestions) {
                report += `- **${issue.category}**${issue.line ? ` (Line ${issue.line})` : ''}: ${issue.message}\n`;
            }
            report += '\n';
        }

        if (issues.length === 0) {
            report += `✅ No issues found! Code looks good.\n`;
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(report)
        ]);
    }
}
