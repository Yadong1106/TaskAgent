import * as vscode from 'vscode';
import axios from 'axios';

export interface StackOverflowSearchInput {
    query: string;
    tags?: string[];
    sort?: 'relevance' | 'votes' | 'creation' | 'activity';
    maxResults?: number;
}

interface StackOverflowResult {
    title: string;
    url: string;
    score: number;
    answerCount: number;
    isAnswered: boolean;
    tags: string[];
}

/**
 * StackOverflowSearchTool - Search Stack Overflow for programming questions
 * Uses Stack Exchange public API (no auth required)
 */
export class StackOverflowSearchTool implements vscode.LanguageModelTool<StackOverflowSearchInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<StackOverflowSearchInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { query, tags } = options.input;
        const tagStr = tags?.length ? ` [${tags.join(', ')}]` : '';
        return {
            invocationMessage: `Searching Stack Overflow for: "${query}"${tagStr}`,
            confirmationMessages: {
                title: 'Stack Overflow Search',
                message: new vscode.MarkdownString(
                    `Search Stack Overflow for:\n\n**"${query}"**${tagStr}`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<StackOverflowSearchInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { query, tags, sort = 'relevance', maxResults = 10 } = options.input;

        try {
            const results = await this.searchStackOverflow(query, tags, sort, maxResults);
            return this.formatResults(results);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Stack Overflow search failed: ${errorMsg}`)
            ]);
        }
    }

    private async searchStackOverflow(
        query: string,
        tags?: string[],
        sort: string = 'relevance',
        maxResults: number = 10
    ): Promise<StackOverflowResult[]> {
        const params: Record<string, string | number> = {
            order: 'desc',
            sort: sort,
            intitle: query,
            site: 'stackoverflow',
            pagesize: maxResults,
            filter: 'default'
        };

        if (tags && tags.length > 0) {
            params.tagged = tags.join(';');
        }

        const response = await axios.get('https://api.stackexchange.com/2.3/search/advanced', {
            params,
            timeout: 15000
        });

        const results: StackOverflowResult[] = [];

        for (const item of response.data.items || []) {
            results.push({
                title: this.decodeHtmlEntities(item.title),
                url: item.link,
                score: item.score,
                answerCount: item.answer_count,
                isAnswered: item.is_answered,
                tags: item.tags || []
            });
        }

        return results;
    }

    private decodeHtmlEntities(text: string): string {
        return text
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'");
    }

    private formatResults(results: StackOverflowResult[]): vscode.LanguageModelToolResult {
        if (results.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No Stack Overflow results found.')
            ]);
        }

        let formatted = `Found ${results.length} Stack Overflow questions:\n\n`;
        results.forEach((result, index) => {
            const answeredIcon = result.isAnswered ? '✅' : '❓';
            formatted += `${index + 1}. ${answeredIcon} **${result.title}**\n`;
            formatted += `   ${result.url}\n`;
            formatted += `   Score: ${result.score} | Answers: ${result.answerCount}\n`;
            formatted += `   Tags: ${result.tags.slice(0, 5).join(', ')}\n\n`;
        });

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(formatted)
        ]);
    }
}
