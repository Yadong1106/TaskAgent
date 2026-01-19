import * as vscode from 'vscode';
import { BackendServer } from '../server/backendServer';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface BrowseWebpageInput {
    url: string;
    extractType?: 'text' | 'html' | 'screenshot';
}

/**
 * BrowseWebpageTool - Webpage browsing and content extraction tool
 * Similar to Eigent's Browser Agent capability
 */
export class BrowseWebpageTool implements vscode.LanguageModelTool<BrowseWebpageInput> {

    constructor(private backendServer: BackendServer) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<BrowseWebpageInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Browsing: ${options.input.url}`,
            confirmationMessages: {
                title: 'Browse Webpage',
                message: new vscode.MarkdownString(
                    `Open and extract content from:\n\n**${options.input.url}**\n\n` +
                    `Extract type: ${options.input.extractType || 'text'}`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<BrowseWebpageInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { url, extractType = 'text' } = options.input;

        try {
            // Try backend server (has Playwright for full browser automation)
            if (this.backendServer.isRunning() && extractType === 'screenshot') {
                const result = await this.backendServer.browseWebpage(url, extractType);
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(result)
                ]);
            }

            // Fallback: use axios + cheerio for text extraction
            const content = await this.extractContent(url, extractType);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(content)
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Failed to browse webpage: ${errorMsg}`)
            ]);
        }
    }

    private async extractContent(url: string, extractType: string): Promise<string> {
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            maxRedirects: 5
        });

        if (extractType === 'html') {
            return response.data;
        }

        // Extract text using cheerio
        const $ = cheerio.load(response.data);

        // Remove script, style, and other non-content elements
        $('script, style, nav, footer, header, aside, noscript, iframe').remove();

        // Get title
        const title = $('title').text().trim();

        // Get main content (try common content selectors)
        let mainContent = '';
        const contentSelectors = [
            'main',
            'article',
            '[role="main"]',
            '.content',
            '.post-content',
            '.entry-content',
            '#content',
            '.article-body'
        ];

        for (const selector of contentSelectors) {
            const element = $(selector);
            if (element.length > 0) {
                mainContent = element.text();
                break;
            }
        }

        // Fallback to body
        if (!mainContent) {
            mainContent = $('body').text();
        }

        // Clean up whitespace
        mainContent = mainContent
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n\n')
            .trim();

        // Truncate if too long
        const maxLength = 10000;
        if (mainContent.length > maxLength) {
            mainContent = mainContent.slice(0, maxLength) + '\n\n[Content truncated...]';
        }

        return `# ${title}\n\nURL: ${url}\n\n${mainContent}`;
    }
}














