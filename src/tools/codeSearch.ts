import * as vscode from 'vscode';

export interface CodeSearchInput {
    query: string;
    filePattern?: string;      // e.g., "*.ts", "*.py"
    includePattern?: string;   // e.g., "src/**"
    excludePattern?: string;   // e.g., "**/node_modules/**"
    maxResults?: number;
    isRegex?: boolean;
    caseSensitive?: boolean;
}

interface SearchMatch {
    file: string;
    line: number;
    column: number;
    text: string;
    preview: string;
}

/**
 * CodeSearchTool - Codebase search tool
 * Uses VS Code workspace.findFiles and TextSearchProvider
 */
export class CodeSearchTool implements vscode.LanguageModelTool<CodeSearchInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CodeSearchInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { query, filePattern } = options.input;
        return {
            invocationMessage: `Searching codebase for "${query}"${filePattern ? ` in ${filePattern}` : ''}...`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<CodeSearchInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { 
            query, 
            filePattern, 
            includePattern, 
            excludePattern,
            maxResults = 20,
            isRegex = false,
            caseSensitive = false 
        } = options.input;

        try {
            const matches = await this.searchWorkspace(
                query, 
                filePattern,
                includePattern,
                excludePattern,
                maxResults,
                isRegex,
                caseSensitive,
                token
            );

            if (matches.length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`No matches found for "${query}"`)
                ]);
            }

            // Format results
            let result = `Found ${matches.length} match(es) for "${query}":\n\n`;
            
            // Group by file
            const byFile = new Map<string, SearchMatch[]>();
            for (const match of matches) {
                const existing = byFile.get(match.file) || [];
                existing.push(match);
                byFile.set(match.file, existing);
            }

            for (const [file, fileMatches] of byFile) {
                result += `📄 **${file}**\n`;
                for (const match of fileMatches) {
                    result += `  Line ${match.line}: ${match.preview.trim()}\n`;
                }
                result += '\n';
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(result)
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
    }

    private async searchWorkspace(
        query: string,
        filePattern?: string,
        includePattern?: string,
        excludePattern?: string,
        maxResults: number = 20,
        isRegex: boolean = false,
        _caseSensitive: boolean = false,
        token?: vscode.CancellationToken
    ): Promise<SearchMatch[]> {
        const matches: SearchMatch[] = [];
        
        // Build include pattern
        let include = includePattern || '**/*';
        if (filePattern) {
            include = `**/${filePattern}`;
        }

        // Default excludes
        const exclude = excludePattern || '**/node_modules/**';

        // Find all matching files first
        const files = await vscode.workspace.findFiles(
            include,
            exclude,
            1000, // Max files to search
            token
        );

        const searchPattern = isRegex ? new RegExp(query, 'gi') : new RegExp(this.escapeRegex(query), 'gi');

        // Search in each file
        for (const fileUri of files) {
            if (matches.length >= maxResults) break;
            if (token?.isCancellationRequested) break;

            try {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const text = document.getText();
                const lines = text.split('\n');

                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    const line = lines[lineIndex];
                    searchPattern.lastIndex = 0; // Reset regex state
                    
                    if (searchPattern.test(line)) {
                        matches.push({
                            file: vscode.workspace.asRelativePath(fileUri),
                            line: lineIndex + 1,
                            column: 1,
                            text: query,
                            preview: line.substring(0, 150)
                        });

                        if (matches.length >= maxResults) break;
                    }
                }
            } catch {
                // Skip files that can't be opened
                continue;
            }
        }

        return matches;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

/**
 * FindFilesTool - File search tool
 * Find files by name/pattern
 */
export class FindFilesTool implements vscode.LanguageModelTool<{ pattern: string; maxResults?: number }> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<{ pattern: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Finding files matching "${options.input.pattern}"...`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ pattern: string; maxResults?: number }>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { pattern, maxResults = 50 } = options.input;

        try {
            const files = await vscode.workspace.findFiles(
                pattern,
                '**/node_modules/**',
                maxResults,
                token
            );

            if (files.length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`No files found matching "${pattern}"`)
                ]);
            }

            let result = `Found ${files.length} file(s) matching "${pattern}":\n\n`;
            for (const file of files) {
                result += `📄 ${vscode.workspace.asRelativePath(file)}\n`;
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(result)
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `File search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
    }
}

/**
 * ReadFileTool - Read file contents
 */
export class ReadFileTool implements vscode.LanguageModelTool<{ filePath: string; startLine?: number; endLine?: number }> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<{ filePath: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Reading file: ${options.input.filePath}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ filePath: string; startLine?: number; endLine?: number }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, startLine, endLine } = options.input;

        try {
            // Find the file in workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            
            let content: string;
            if (startLine !== undefined && endLine !== undefined) {
                const lines = document.getText().split('\n');
                const start = Math.max(0, startLine - 1);
                const end = Math.min(lines.length, endLine);
                content = lines.slice(start, end).join('\n');
            } else {
                content = document.getText();
            }

            // Truncate if too long
            const maxLength = 10000;
            if (content.length > maxLength) {
                content = content.slice(0, maxLength) + '\n\n... [truncated]';
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `📄 **${filePath}**\n\`\`\`${document.languageId}\n${content}\n\`\`\``
                )
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
    }
}

/**
 * GetSymbolsTool - Get symbols from file (functions, classes, etc.)
 */
export class GetSymbolsTool implements vscode.LanguageModelTool<{ filePath: string }> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<{ filePath: string }>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Getting symbols from: ${options.input.filePath}`,
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ filePath: string }>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath } = options.input;

        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                fileUri
            );

            if (!symbols || symbols.length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`No symbols found in ${filePath}`)
                ]);
            }

            let result = `📄 **Symbols in ${filePath}**:\n\n`;
            result += this.formatSymbols(symbols, 0);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(result)
            ]);

        } catch (error) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Failed to get symbols: ${error instanceof Error ? error.message : 'Unknown error'}`
                )
            ]);
        }
    }

    private formatSymbols(symbols: vscode.DocumentSymbol[], indent: number): string {
        let result = '';
        const prefix = '  '.repeat(indent);
        
        for (const symbol of symbols) {
            const icon = this.getSymbolIcon(symbol.kind);
            result += `${prefix}${icon} ${symbol.name} (line ${symbol.range.start.line + 1})\n`;
            
            if (symbol.children && symbol.children.length > 0) {
                result += this.formatSymbols(symbol.children, indent + 1);
            }
        }
        
        return result;
    }

    private getSymbolIcon(kind: vscode.SymbolKind): string {
        const icons: Record<number, string> = {
            [vscode.SymbolKind.Class]: '🔷',
            [vscode.SymbolKind.Function]: '🔹',
            [vscode.SymbolKind.Method]: '🔸',
            [vscode.SymbolKind.Property]: '📌',
            [vscode.SymbolKind.Variable]: '📍',
            [vscode.SymbolKind.Interface]: '🔶',
            [vscode.SymbolKind.Enum]: '📋',
            [vscode.SymbolKind.Constructor]: '🔧',
        };
        return icons[kind] || '•';
    }
}














