import * as vscode from 'vscode';
import axios from 'axios';

export interface GitHubSearchInput {
    query: string;
    searchType: 'code' | 'repositories' | 'issues';
    language?: string;
    maxResults?: number;
}

interface GitHubSearchResult {
    name: string;
    url: string;
    description: string;
    extra?: string;
}

/**
 * GitHubSearchTool - Search GitHub for code, repositories, or issues
 * Uses GitHub's public search API (no auth required for basic searches)
 */
export class GitHubSearchTool implements vscode.LanguageModelTool<GitHubSearchInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GitHubSearchInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { query, searchType } = options.input;
        return {
            invocationMessage: `Searching GitHub ${searchType} for: "${query}"`,
            confirmationMessages: {
                title: 'GitHub Search',
                message: new vscode.MarkdownString(
                    `Search GitHub **${searchType}** for:\n\n**"${query}"**`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GitHubSearchInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { query, searchType, language, maxResults = 10 } = options.input;

        try {
            const results = await this.searchGitHub(query, searchType, language, maxResults);
            return this.formatResults(results, searchType);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`GitHub search failed: ${errorMsg}`)
            ]);
        }
    }

    private async searchGitHub(
        query: string,
        searchType: 'code' | 'repositories' | 'issues',
        language?: string,
        maxResults: number = 10
    ): Promise<GitHubSearchResult[]> {
        // Build search query
        let searchQuery = query;
        if (language) {
            searchQuery += ` language:${language}`;
        }

        const endpoints: Record<string, string> = {
            code: 'https://api.github.com/search/code',
            repositories: 'https://api.github.com/search/repositories',
            issues: 'https://api.github.com/search/issues'
        };

        // Get optional GitHub token for higher rate limits
        const config = vscode.workspace.getConfiguration('taskagent');
        const token = config.get<string>('githubToken');

        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'TaskAgent-VSCode'
        };

        if (token) {
            headers['Authorization'] = `token ${token}`;
        }

        const response = await axios.get(endpoints[searchType], {
            params: {
                q: searchQuery,
                per_page: maxResults
            },
            headers,
            timeout: 15000
        });

        const results: GitHubSearchResult[] = [];

        for (const item of response.data.items || []) {
            switch (searchType) {
                case 'repositories':
                    results.push({
                        name: item.full_name,
                        url: item.html_url,
                        description: item.description || 'No description',
                        extra: `⭐ ${item.stargazers_count} | 🍴 ${item.forks_count} | ${item.language || 'Unknown'}`
                    });
                    break;
                case 'code':
                    results.push({
                        name: item.name,
                        url: item.html_url,
                        description: `${item.repository.full_name}/${item.path}`,
                        extra: item.repository.description || ''
                    });
                    break;
                case 'issues':
                    results.push({
                        name: item.title,
                        url: item.html_url,
                        description: `${item.repository_url.split('/').slice(-2).join('/')} #${item.number}`,
                        extra: `State: ${item.state} | Comments: ${item.comments}`
                    });
                    break;
            }
        }

        return results;
    }

    private formatResults(results: GitHubSearchResult[], searchType: string): vscode.LanguageModelToolResult {
        if (results.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No GitHub results found.')
            ]);
        }

        let formatted = `Found ${results.length} GitHub ${searchType}:\n\n`;
        results.forEach((result, index) => {
            formatted += `${index + 1}. **${result.name}**\n`;
            formatted += `   ${result.url}\n`;
            formatted += `   ${result.description}\n`;
            if (result.extra) {
                formatted += `   ${result.extra}\n`;
            }
            formatted += '\n';
        });

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(formatted)
        ]);
    }
}
