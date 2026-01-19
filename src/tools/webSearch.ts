import * as vscode from 'vscode';
import { BackendServer } from '../server/backendServer';
import axios from 'axios';

export interface WebSearchInput {
    query: string;
    maxResults?: number;
}

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * WebSearchTool - Web search tool
 * Similar to Eigent Search Agent capability
 */
export class WebSearchTool implements vscode.LanguageModelTool<WebSearchInput> {
    
    constructor(private backendServer: BackendServer) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<WebSearchInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        return {
            invocationMessage: `Searching the web for: "${options.input.query}"`,
            confirmationMessages: {
                title: 'Web Search',
                message: new vscode.MarkdownString(
                    `Search the web for:\n\n**"${options.input.query}"**\n\n` +
                    `Max results: ${options.input.maxResults || 5}`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<WebSearchInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { query, maxResults = 5 } = options.input;

        try {
            // Try to use backend server for search
            if (this.backendServer.isRunning()) {
                const results = await this.backendServer.search(query, maxResults);
                return this.formatResults(results);
            }

            // Fallback: use a simple search API (DuckDuckGo instant answer)
            const results = await this.fallbackSearch(query, maxResults);
            return this.formatResults(results);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Search failed: ${errorMsg}`)
            ]);
        }
    }

    private async fallbackSearch(query: string, maxResults: number): Promise<SearchResult[]> {
        // Using DuckDuckGo instant answer API (no API key required)
        try {
            const response = await axios.get('https://api.duckduckgo.com/', {
                params: {
                    q: query,
                    format: 'json',
                    no_html: 1,
                    skip_disambig: 1
                },
                timeout: 10000
            });

            const results: SearchResult[] = [];
            
            // Abstract (main result)
            if (response.data.Abstract) {
                results.push({
                    title: response.data.Heading || query,
                    url: response.data.AbstractURL || '',
                    snippet: response.data.Abstract
                });
            }

            // Related topics
            if (response.data.RelatedTopics) {
                for (const topic of response.data.RelatedTopics.slice(0, maxResults - 1)) {
                    if (topic.Text && topic.FirstURL) {
                        results.push({
                            title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 50),
                            url: topic.FirstURL,
                            snippet: topic.Text
                        });
                    }
                }
            }

            if (results.length === 0) {
                // If no results from DuckDuckGo, return a message
                return [{
                    title: 'No direct results found',
                    url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                    snippet: `No instant answer available. Try searching directly on DuckDuckGo.`
                }];
            }

            return results.slice(0, maxResults);

        } catch (error) {
            console.error('Fallback search failed:', error);
            return [{
                title: 'Search unavailable',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                snippet: 'Could not perform search. Please try manually.'
            }];
        }
    }

    private formatResults(results: SearchResult[]): vscode.LanguageModelToolResult {
        if (results.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No search results found.')
            ]);
        }

        let formatted = `Found ${results.length} result(s):\n\n`;
        results.forEach((result, index) => {
            formatted += `${index + 1}. **${result.title}**\n`;
            formatted += `   URL: ${result.url}\n`;
            formatted += `   ${result.snippet}\n\n`;
        });

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(formatted)
        ]);
    }
}














