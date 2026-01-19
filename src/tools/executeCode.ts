import * as vscode from 'vscode';

export interface ExecuteCodeInput {
    code: string;
    language: 'shell' | 'python' | 'javascript' | 'typescript';
    workingDirectory?: string;
}

/**
 * ExecuteCodeTool - Code execution tool
 * Similar to Eigent Developer Agent capability
 */
export class ExecuteCodeTool implements vscode.LanguageModelTool<ExecuteCodeInput> {
    
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ExecuteCodeInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const input = options.input;
        
        // Show confirmation dialog (Human-in-the-loop)
        const codePreview = input.code.length > 200 
            ? input.code.slice(0, 200) + '...' 
            : input.code;
        
        return {
            invocationMessage: `Executing ${input.language} code...`,
            confirmationMessages: {
                title: 'Execute Code',
                message: new vscode.MarkdownString(
                    `**Language:** ${input.language}\n\n` +
                    `**Code:**\n\`\`\`${input.language}\n${codePreview}\n\`\`\`\n\n` +
                    `Do you want to execute this code?`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ExecuteCodeInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { code, language, workingDirectory } = options.input;

        try {
            let result: string;

            switch (language) {
                case 'shell':
                    result = await this.executeShell(code, workingDirectory);
                    break;
                case 'python':
                    result = await this.executePython(code, workingDirectory);
                    break;
                case 'javascript':
                case 'typescript':
                    result = await this.executeNode(code, language, workingDirectory);
                    break;
                default:
                    throw new Error(`Unsupported language: ${language}`);
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Execution successful:\n\n${result}`)
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Execution failed:\n\n${errorMsg}`)
            ]);
        }
    }

    private async executeShell(code: string, cwd?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const terminal = vscode.window.createTerminal({
                name: 'TaskAgent Execute',
                cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            });
            terminal.show();
            terminal.sendText(code);
            
            // Note: In a real implementation, you would capture output
            // This requires additional setup or using child_process directly
            resolve(`Command sent to terminal: ${code}\nCheck terminal for output.`);
        });
    }

    private async executePython(code: string, cwd?: string): Promise<string> {
        const { exec } = require('child_process');
        const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        return new Promise((resolve, reject) => {
            exec(`python -c "${code.replace(/"/g, '\\"')}"`, { cwd: workDir }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout || 'Execution completed (no output)');
                }
            });
        });
    }

    private async executeNode(code: string, language: string, cwd?: string): Promise<string> {
        const { exec } = require('child_process');
        const workDir = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        
        const cmd = language === 'typescript' 
            ? `npx ts-node -e "${code.replace(/"/g, '\\"')}"`
            : `node -e "${code.replace(/"/g, '\\"')}"`;

        return new Promise((resolve, reject) => {
            exec(cmd, { cwd: workDir }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout || 'Execution completed (no output)');
                }
            });
        });
    }
}














