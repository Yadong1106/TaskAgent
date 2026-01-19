import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface CreateDocumentInput {
    filename: string;
    content: string;
    format?: 'markdown' | 'txt' | 'json' | 'html';
}

/**
 * CreateDocumentTool - Document creation tool
 * Similar to Eigent Document Agent capability
 */
export class CreateDocumentTool implements vscode.LanguageModelTool<CreateDocumentInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CreateDocumentInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const preview = options.input.content.length > 200
            ? options.input.content.slice(0, 200) + '...'
            : options.input.content;

        return {
            invocationMessage: `Creating document: ${options.input.filename}`,
            confirmationMessages: {
                title: 'Create Document',
                message: new vscode.MarkdownString(
                    `Create file: **${options.input.filename}**\n\n` +
                    `Format: ${options.input.format || 'auto-detect'}\n\n` +
                    `Preview:\n\`\`\`\n${preview}\n\`\`\``
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<CreateDocumentInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filename, content, format } = options.input;

        try {
            // Determine the file path
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            // Ensure proper extension
            let finalFilename = filename;
            if (format && !filename.endsWith(`.${format}`)) {
                const ext = format === 'markdown' ? 'md' : format;
                if (!filename.includes('.')) {
                    finalFilename = `${filename}.${ext}`;
                }
            }

            const filePath = path.join(workspaceFolder.uri.fsPath, finalFilename);

            // Create directory if needed
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Format content based on type
            let finalContent = content;
            if (format === 'json') {
                try {
                    // Pretty print JSON if it's valid JSON
                    const parsed = JSON.parse(content);
                    finalContent = JSON.stringify(parsed, null, 2);
                } catch {
                    // Keep original content if not valid JSON
                }
            }

            // Write the file
            fs.writeFileSync(filePath, finalContent, 'utf-8');

            // Open the file in editor
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Document created successfully!\n\n` +
                    `File: ${filePath}\n` +
                    `Size: ${finalContent.length} characters`
                )
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to create document: ${errorMsg}`)
            ]);
        }
    }
}














