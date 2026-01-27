import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface PreviewUIInput {
    html?: string;
    css?: string;
    javascript?: string;
    framework?: 'vanilla' | 'react' | 'vue' | 'tailwind';
    title?: string;
}

/**
 * PreviewUITool - Real-time UI preview in VS Code
 * Opens a webview panel to show live preview of HTML/CSS/JS
 */
export class PreviewUITool implements vscode.LanguageModelTool<PreviewUIInput> {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private static lastContent: PreviewUIInput = {};

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<PreviewUIInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const title = options.input.title || 'UI Preview';
        return {
            invocationMessage: `Opening live preview: ${title}`,
            confirmationMessages: {
                title: 'Preview UI',
                message: new vscode.MarkdownString(
                    `**Preview:** ${title}\n\n` +
                    `Framework: ${options.input.framework || 'vanilla'}\n\n` +
                    `This will open a live preview panel.`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<PreviewUIInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { html, css, javascript, framework = 'vanilla', title = 'UI Preview' } = options.input;

        try {
            // Store content
            PreviewUITool.lastContent = options.input;

            // Create or reuse webview panel
            if (PreviewUITool.currentPanel) {
                PreviewUITool.currentPanel.reveal(vscode.ViewColumn.Beside);
            } else {
                PreviewUITool.currentPanel = vscode.window.createWebviewPanel(
                    'taskagentPreview',
                    `🎨 ${title}`,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: []
                    }
                );

                PreviewUITool.currentPanel.onDidDispose(() => {
                    PreviewUITool.currentPanel = undefined;
                });
            }

            // Generate preview HTML
            const previewHtml = this.generatePreviewHtml(html, css, javascript, framework, title);
            PreviewUITool.currentPanel.webview.html = previewHtml;

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `✅ Preview opened: "${title}"\n\n` +
                    `The UI is now visible in the preview panel on the right.\n` +
                    `Framework: ${framework}\n\n` +
                    `You can continue to modify the code and call this tool again to update the preview.`
                )
            ]);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`❌ Preview failed: ${errorMsg}`)
            ]);
        }
    }

    private generatePreviewHtml(
        html?: string,
        css?: string,
        javascript?: string,
        framework?: string,
        title?: string
    ): string {
        // Framework-specific CDN links
        let cdnLinks = '';
        let frameworkScript = '';

        switch (framework) {
            case 'react':
                cdnLinks = `
                    <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
                    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
                    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
                `;
                frameworkScript = 'text/babel';
                break;
            case 'vue':
                cdnLinks = `
                    <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
                `;
                break;
            case 'tailwind':
                cdnLinks = `
                    <script src="https://cdn.tailwindcss.com"></script>
                `;
                break;
        }

        // Default styles for better preview experience
        const defaultStyles = `
            * {
                box-sizing: border-box;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                margin: 0;
                padding: 16px;
                background: #ffffff;
                color: #333333;
            }
            /* Utility classes */
            .container { max-width: 1200px; margin: 0 auto; }
            .flex { display: flex; }
            .flex-col { flex-direction: column; }
            .items-center { align-items: center; }
            .justify-center { justify-content: center; }
            .gap-2 { gap: 0.5rem; }
            .gap-4 { gap: 1rem; }
            .p-4 { padding: 1rem; }
            .m-4 { margin: 1rem; }
            .rounded { border-radius: 0.375rem; }
            .shadow { box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
            .btn { 
                padding: 0.5rem 1rem; 
                border: none; 
                border-radius: 0.375rem; 
                cursor: pointer;
                font-size: 1rem;
            }
            .btn-primary { background: #3b82f6; color: white; }
            .btn-primary:hover { background: #2563eb; }
        `;

        // Wrap React code if needed
        let processedJs = javascript || '';
        if (framework === 'react' && javascript) {
            // Check if it's a component that needs to be rendered
            if (!javascript.includes('ReactDOM.render') && !javascript.includes('createRoot')) {
                processedJs = `
                    ${javascript}
                    
                    // Auto-render if App component exists
                    if (typeof App !== 'undefined') {
                        const root = ReactDOM.createRoot(document.getElementById('root') || document.getElementById('app'));
                        root.render(React.createElement(App));
                    }
                `;
            }
        }

        // Wrap Vue code if needed
        if (framework === 'vue' && javascript) {
            if (!javascript.includes('createApp') && !javascript.includes('Vue.createApp')) {
                processedJs = `
                    const { createApp, ref, reactive, computed, onMounted } = Vue;
                    
                    ${javascript}
                    
                    // Auto-mount if app config exists
                    if (typeof appConfig !== 'undefined') {
                        createApp(appConfig).mount('#app');
                    }
                `;
            }
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title || 'UI Preview'}</title>
    ${cdnLinks}
    <style>
        ${defaultStyles}
        ${css || ''}
    </style>
</head>
<body>
    <div id="app">
        ${html || '<p style="color: #666;">No HTML content provided. Add html parameter to see preview.</p>'}
    </div>
    <div id="root"></div>
    
    ${processedJs ? `<script ${frameworkScript ? `type="${frameworkScript}"` : ''}>
        try {
            ${processedJs}
        } catch (error) {
            document.body.innerHTML = '<div style="color: red; padding: 20px;"><h3>JavaScript Error:</h3><pre>' + error.message + '</pre></div>';
        }
    </script>` : ''}
    
    <!-- Error handling -->
    <script>
        window.onerror = function(msg, url, lineNo, columnNo, error) {
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#fee;color:#c00;padding:10px;font-family:monospace;font-size:12px;';
            errorDiv.textContent = 'Error: ' + msg;
            document.body.appendChild(errorDiv);
            return false;
        };
    </script>
</body>
</html>`;
    }

    /**
     * Static method to update preview from outside
     */
    static updatePreview(input: PreviewUIInput) {
        if (PreviewUITool.currentPanel) {
            const tool = new PreviewUITool();
            const html = tool.generatePreviewHtml(
                input.html,
                input.css,
                input.javascript,
                input.framework,
                input.title
            );
            PreviewUITool.currentPanel.webview.html = html;
        }
    }

    /**
     * Close the preview panel
     */
    static closePreview() {
        if (PreviewUITool.currentPanel) {
            PreviewUITool.currentPanel.dispose();
            PreviewUITool.currentPanel = undefined;
        }
    }
}

/**
 * Create a live server for more complex previews
 */
export class LivePreviewServer {
    private static server: any;
    private static port: number = 5500;

    static async startServer(rootPath: string): Promise<string> {
        // For now, just use the simple webview approach
        // In the future, could integrate with Live Server extension
        return `http://localhost:${this.port}`;
    }

    static stopServer() {
        if (this.server) {
            this.server.close();
            this.server = undefined;
        }
    }
}
