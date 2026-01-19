import * as vscode from 'vscode';

export interface HumanInputInput {
    question: string;
    options?: string[];
}

/**
 * HumanInputTool - Human interaction tool
 * Implements Eigent Human-in-the-loop functionality
 */
export class HumanInputTool implements vscode.LanguageModelTool<HumanInputInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<HumanInputInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: 'Requesting human input...',
            confirmationMessages: {
                title: 'Human Input Required',
                message: new vscode.MarkdownString(
                    `The AI agent needs your input:\n\n` +
                    `**${options.input.question}**\n\n` +
                    (options.input.options 
                        ? `Options: ${options.input.options.join(', ')}`
                        : 'Please provide your response.')
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<HumanInputInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { question, options: choices } = options.input;

        try {
            let response: string | undefined;

            if (choices && choices.length > 0) {
                // Show quick pick for predefined options
                response = await vscode.window.showQuickPick(choices, {
                    placeHolder: question,
                    title: 'TaskAgent: Human Input Required',
                    ignoreFocusOut: true
                });
            } else {
                // Show input box for free-form input
                response = await vscode.window.showInputBox({
                    prompt: question,
                    title: 'TaskAgent: Human Input Required',
                    ignoreFocusOut: true,
                    placeHolder: 'Enter your response...'
                });
            }

            if (response === undefined) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        'User cancelled the input request. The agent should decide whether to proceed with a default action or stop.'
                    )
                ]);
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Human response to "${question}":\n\n${response}`
                )
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to get human input: ${errorMsg}`)
            ]);
        }
    }
}














