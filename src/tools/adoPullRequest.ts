import * as vscode from 'vscode';
import * as path from 'path';
import axios, { AxiosInstance } from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ===== Interfaces =====

export interface AdoPrInput {
    /** Target branch (e.g., 'main', 'develop'). Defaults to repo's default branch. */
    targetBranch?: string;
    /** PR title. Auto-generated from commits if not provided. */
    title?: string;
    /** PR description. Auto-generated from diff if not provided. */
    description?: string;
    /** Work item IDs to link */
    workItemIds?: number[];
    /** Set PR to auto-complete after approval */
    autoComplete?: boolean;
    /** Add reviewers by email */
    reviewers?: string[];
    /** Draft PR */
    isDraft?: boolean;
}

interface GitInfo {
    currentBranch: string;
    remoteName: string;
    remoteUrl: string;
    defaultBranch: string;
    adoOrg: string;
    adoProject: string;
    adoRepo: string;
    commits: string[];
    diffSummary: string;
    diffStat: string;
    changedFiles: string[];
}

interface AdoPrResult {
    pullRequestId: number;
    title: string;
    description: string;
    url: string;
    webUrl: string;
    sourceBranch: string;
    targetBranch: string;
    status: string;
}

// ===== ADO Pull Request Tool =====

/**
 * AdoPullRequestTool - Create Azure DevOps Pull Requests
 *
 * Features:
 * - Auto-detect ADO org/project/repo from git remote
 * - Auto-generate PR title from commit messages
 * - Auto-generate PR description from git diff (LLM-powered)
 * - Link work items
 * - Add reviewers
 * - Draft PR support
 * - Auto-complete option
 */
export class AdoPullRequestTool implements vscode.LanguageModelTool<AdoPrInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<AdoPrInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const input = options.input;

        // Try to show detected repo info in the confirmation
        let repoInfo = '';
        try {
            const repoRoot = await this.resolveRepoRoot();
            const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf-8' });
            const { stdout: remoteRaw } = await execAsync('git remote -v', { cwd: repoRoot, encoding: 'utf-8' });
            const pushLine = remoteRaw.split('\n').find(l => l.includes('(push)')) || '';
            const remoteUrl = pushLine.split(/\s+/)[1] || 'unknown';
            repoInfo = `**Repo:** ${path.basename(repoRoot)}\n\n**Remote:** ${remoteUrl}\n\n**Branch:** ${branch.trim()}\n\n`;
        } catch {
            repoInfo = '**Repo:** (will auto-detect)\n\n';
        }

        return {
            invocationMessage: `Creating ADO Pull Request${input.title ? ': ' + input.title : ''}...`,
            confirmationMessages: {
                title: 'Create Azure DevOps Pull Request',
                message: new vscode.MarkdownString(
                    repoInfo +
                    `**Target Branch:** ${input.targetBranch || 'default'}\n\n` +
                    `**Title:** ${input.title || '(auto-generate from commits)'}\n\n` +
                    `**Draft:** ${input.isDraft ? 'Yes' : 'No'}\n\n` +
                    `Do you want to create this Pull Request?`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<AdoPrInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        try {
            const input = options.input;

            // Step 0: Detect the correct git repository root
            const repoRoot = await this.resolveRepoRoot();

            // Step 1: Gather git info
            const gitInfo = await this.getGitInfo(repoRoot, input.targetBranch);

            // Step 2: Get PAT
            const pat = this.getAdoPat();
            if (!pat) {
                throw new Error(
                    'Azure DevOps PAT not configured. Set `taskagent.adoPat` in VS Code settings, ' +
                    'or set the `AZURE_DEVOPS_PAT` environment variable.'
                );
            }

            // Step 3: Generate title & description if not provided
            const title = input.title || this.generateTitle(gitInfo);
            const description = input.description || await this.generateDescription(gitInfo, token);

            // Step 4: Create PR via ADO REST API
            const result = await this.createPullRequest(
                gitInfo, pat, title, description, input
            );

            // Step 5: Link work items if provided
            if (input.workItemIds?.length) {
                await this.linkWorkItems(gitInfo, pat, result.pullRequestId, input.workItemIds);
            }

            // Step 6: Add reviewers if provided
            if (input.reviewers?.length) {
                await this.addReviewers(gitInfo, pat, result.pullRequestId, input.reviewers);
            }

            const summary = [
                `✅ **Pull Request Created Successfully!**`,
                ``,
                `| Field | Value |`,
                `|-------|-------|`,
                `| **PR ID** | #${result.pullRequestId} |`,
                `| **Title** | ${result.title} |`,
                `| **Source** | ${gitInfo.currentBranch} |`,
                `| **Target** | ${result.targetBranch} |`,
                `| **Status** | ${result.status} |`,
                `| **URL** | [Open in Browser](${result.webUrl}) |`,
                ``,
                `### Description`,
                result.description.slice(0, 500) + (result.description.length > 500 ? '...' : '')
            ].join('\n');

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(summary)
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`❌ Failed to create PR: ${errorMsg}`)
            ]);
        }
    }

    // ===== Smart Repo Detection =====

    /**
     * Resolve the git repository root using multiple strategies:
     * 1. VS Code Git extension API — find repo for the current active editor file
     * 2. Active editor file path — walk up to find .git directory
     * 3. Workspace folder — fallback to first workspace folder
     */
    private async resolveRepoRoot(): Promise<string> {
        // Strategy 1: Use VS Code Git extension API
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension) {
                const git = gitExtension.isActive
                    ? gitExtension.exports.getAPI(1)
                    : (await gitExtension.activate()).getAPI(1);

                const repos = git.repositories;
                if (repos.length === 1) {
                    return repos[0].rootUri.fsPath;
                }
                if (repos.length > 1) {
                    // Find repo matching the active editor file
                    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
                    if (activeFile) {
                        const matchingRepo = repos.find((r: any) =>
                            activeFile.startsWith(r.rootUri.fsPath)
                        );
                        if (matchingRepo) {
                            return matchingRepo.rootUri.fsPath;
                        }
                    }

                    // Ask user to pick a repo
                    const items: vscode.QuickPickItem[] = repos.map((r: any) => ({
                        label: path.basename(r.rootUri.fsPath),
                        description: r.rootUri.fsPath as string
                    }));
                    const picked = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Multiple git repos found. Which one do you want to create a PR for?'
                    });
                    if (picked && picked.description) {
                        return picked.description;
                    }
                }
            }
        } catch {
            // Git extension not available, fall through
        }

        // Strategy 2: Walk up from active editor file to find .git
        const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (activeFile) {
            try {
                const { stdout } = await execAsync(
                    'git rev-parse --show-toplevel',
                    { cwd: path.dirname(activeFile), encoding: 'utf-8' }
                );
                return stdout.trim();
            } catch {
                // Not in a git repo, fall through
            }
        }

        // Strategy 3: First workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri.fsPath;
        }

        throw new Error('No git repository found. Open a workspace with a git repo first.');
    }

    // ===== Git Information Gathering =====

    private async getGitInfo(workspaceRoot: string, targetBranch?: string): Promise<GitInfo> {
        const run = (cmd: string) => execAsync(cmd, { cwd: workspaceRoot, encoding: 'utf-8' });

        // Current branch
        const { stdout: branch } = await run('git rev-parse --abbrev-ref HEAD');
        const currentBranch = branch.trim();

        if (currentBranch === 'HEAD') {
            throw new Error('Detached HEAD state. Please checkout a branch first.');
        }

        // Remote info — smart selection when multiple remotes exist
        const { stdout: remoteRaw } = await run('git remote -v');
        const remoteLines = remoteRaw.trim().split('\n').filter(l => l.includes('(push)'));
        
        let remoteName: string;
        let remoteUrl: string;

        if (remoteLines.length === 0) {
            throw new Error('No git remotes configured. Add a remote first: git remote add origin <url>');
        } else if (remoteLines.length === 1) {
            const parts = remoteLines[0].split(/\s+/);
            remoteName = parts[0];
            remoteUrl = parts[1];
        } else {
            // Multiple remotes — prefer the one that points to ADO
            const adoRemote = remoteLines.find(l =>
                l.includes('dev.azure.com') || l.includes('visualstudio.com') || l.includes('ssh.dev.azure.com')
            );
            if (adoRemote) {
                const parts = adoRemote.split(/\s+/);
                remoteName = parts[0];
                remoteUrl = parts[1];
            } else {
                // Ask user to pick
                const items = remoteLines.map(l => {
                    const parts = l.split(/\s+/);
                    return { label: parts[0], description: parts[1] };
                });
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Multiple remotes found. Which one is the ADO remote?'
                });
                if (picked) {
                    remoteName = picked.label;
                    remoteUrl = picked.description!;
                } else {
                    // Default to first
                    const parts = remoteLines[0].split(/\s+/);
                    remoteName = parts[0];
                    remoteUrl = parts[1];
                }
            }
        }

        // Parse ADO org/project/repo from remote URL
        const adoInfo = this.parseAdoRemote(remoteUrl);

        // Default branch
        let defaultBranch = targetBranch || 'main';
        if (!targetBranch) {
            try {
                const { stdout: defRef } = await run(`git symbolic-ref refs/remotes/${remoteName}/HEAD`);
                defaultBranch = defRef.trim().replace(`refs/remotes/${remoteName}/`, '');
            } catch {
                // Try common defaults
                try {
                    await run(`git rev-parse --verify ${remoteName}/main`);
                    defaultBranch = 'main';
                } catch {
                    defaultBranch = 'master';
                }
            }
        }

        // Commits on this branch vs target
        const { stdout: commitLog } = await run(
            `git log ${remoteName}/${defaultBranch}..HEAD --oneline --no-decorate`
        );
        const commits = commitLog.trim().split('\n').filter(l => l.length > 0);

        // Diff summary
        const { stdout: diffStat } = await run(
            `git diff ${remoteName}/${defaultBranch}...HEAD --stat`
        );

        const { stdout: diffSummary } = await run(
            `git diff ${remoteName}/${defaultBranch}...HEAD --shortstat`
        );

        // Changed files
        const { stdout: filesRaw } = await run(
            `git diff ${remoteName}/${defaultBranch}...HEAD --name-only`
        );
        const changedFiles = filesRaw.trim().split('\n').filter(f => f.length > 0);

        return {
            currentBranch,
            remoteName,
            remoteUrl,
            defaultBranch,
            ...adoInfo,
            commits,
            diffSummary: diffSummary.trim(),
            diffStat: diffStat.trim(),
            changedFiles
        };
    }

    /**
     * Parse Azure DevOps organization, project, and repo name from remote URL
     * Supports both HTTPS and SSH formats:
     *   https://dev.azure.com/{org}/{project}/_git/{repo}
     *   https://{org}@dev.azure.com/{org}/{project}/_git/{repo}
     *   https://{org}.visualstudio.com/{project}/_git/{repo}
     *   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
     */
    private parseAdoRemote(url: string): { adoOrg: string; adoProject: string; adoRepo: string } {
        // HTTPS: dev.azure.com
        let match = url.match(/dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_git\/([^\s\/]+)/);
        if (match) {
            return { adoOrg: match[1], adoProject: match[2], adoRepo: match[3].replace('.git', '') };
        }

        // HTTPS: visualstudio.com (legacy)
        match = url.match(/([^\/]+)\.visualstudio\.com\/([^\/]+)\/_git\/([^\s\/]+)/);
        if (match) {
            return { adoOrg: match[1], adoProject: match[2], adoRepo: match[3].replace('.git', '') };
        }

        // SSH: ssh.dev.azure.com
        match = url.match(/ssh\.dev\.azure\.com:v3\/([^\/]+)\/([^\/]+)\/([^\s\/]+)/);
        if (match) {
            return { adoOrg: match[1], adoProject: match[2], adoRepo: match[3].replace('.git', '') };
        }

        throw new Error(
            `Could not parse Azure DevOps info from remote URL: ${url}\n` +
            `Expected format: https://dev.azure.com/{org}/{project}/_git/{repo}`
        );
    }

    // ===== PAT Management =====

    private getAdoPat(): string | undefined {
        // 1. Try VS Code setting
        const config = vscode.workspace.getConfiguration('taskagent');
        const pat = config.get<string>('adoPat');
        if (pat) return pat;

        // 2. Try environment variable
        return process.env.AZURE_DEVOPS_PAT || process.env.ADO_PAT;
    }

    // ===== Title & Description Generation =====

    private generateTitle(gitInfo: GitInfo): string {
        // If only one commit, use its message
        if (gitInfo.commits.length === 1) {
            // Strip the short hash prefix
            return gitInfo.commits[0].replace(/^[a-f0-9]+\s+/, '');
        }

        // Multiple commits: try to find a common theme
        const branch = gitInfo.currentBranch;

        // Parse common branch naming patterns
        // e.g., feature/add-pr-creation → Add pr creation
        // e.g., bugfix/WORK-1234-fix-login → WORK-1234: Fix login
        const branchParts = branch.split('/');
        const namepart = branchParts[branchParts.length - 1];

        // Check for work item ID pattern
        const workItemMatch = namepart.match(/^([A-Z]+-\d+)[-_](.+)/);
        if (workItemMatch) {
            const readableName = workItemMatch[2].replace(/[-_]/g, ' ');
            return `${workItemMatch[1]}: ${readableName.charAt(0).toUpperCase() + readableName.slice(1)}`;
        }

        // Default: format branch name
        const readableName = namepart.replace(/[-_]/g, ' ');
        return readableName.charAt(0).toUpperCase() + readableName.slice(1);
    }

    private async generateDescription(gitInfo: GitInfo, token: vscode.CancellationToken): Promise<string> {
        // Try LLM-powered description
        try {
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
            const model = models[0];
            if (model) {
                return await this.generateDescriptionWithLLM(model, gitInfo, token);
            }
        } catch {
            // fallback below
        }

        // Fallback: structured template
        return this.generateDescriptionTemplate(gitInfo);
    }

    private async generateDescriptionWithLLM(
        model: vscode.LanguageModelChat,
        gitInfo: GitInfo,
        token: vscode.CancellationToken
    ): Promise<string> {
        const prompt = `Generate a professional Pull Request description in Markdown for an Azure DevOps PR.

Branch: ${gitInfo.currentBranch} → ${gitInfo.defaultBranch}

Commits:
${gitInfo.commits.slice(0, 20).map(c => `- ${c}`).join('\n')}

Changed files (${gitInfo.changedFiles.length}):
${gitInfo.changedFiles.slice(0, 30).map(f => `- ${f}`).join('\n')}

Diff stats:
${gitInfo.diffSummary}

Generate description with these sections:
## Summary
(What this PR does in 2-3 sentences)

## Changes
(Bullet points of key changes)

## Testing
(Suggested testing approach)

## Notes
(Any reviewer notes)

Keep it concise and professional.`;

        const messages = [vscode.LanguageModelChatMessage.User(prompt)];
        const response = await model.sendRequest(messages, {}, token);

        let description = '';
        for await (const chunk of response.text) {
            description += chunk;
        }
        return description;
    }

    private generateDescriptionTemplate(gitInfo: GitInfo): string {
        const filesByExtension = new Map<string, string[]>();
        for (const file of gitInfo.changedFiles) {
            const ext = file.split('.').pop() || 'other';
            if (!filesByExtension.has(ext)) filesByExtension.set(ext, []);
            filesByExtension.get(ext)!.push(file);
        }

        return [
            `## Summary`,
            ``,
            `Branch \`${gitInfo.currentBranch}\` → \`${gitInfo.defaultBranch}\``,
            ``,
            `${gitInfo.diffSummary}`,
            ``,
            `## Commits`,
            ``,
            ...gitInfo.commits.slice(0, 20).map(c => `- ${c}`),
            gitInfo.commits.length > 20 ? `- ... and ${gitInfo.commits.length - 20} more` : '',
            ``,
            `## Changed Files (${gitInfo.changedFiles.length})`,
            ``,
            ...gitInfo.changedFiles.slice(0, 30).map(f => `- \`${f}\``),
            gitInfo.changedFiles.length > 30 ? `- ... and ${gitInfo.changedFiles.length - 30} more` : '',
            ``,
            `## File Types`,
            ``,
            ...Array.from(filesByExtension.entries()).map(([ext, files]) => `- **${ext}**: ${files.length} file(s)`),
            ``,
            `## Testing`,
            ``,
            `- [ ] Unit tests pass`,
            `- [ ] Manual testing completed`,
            `- [ ] No regressions observed`,
            ``
        ].filter(l => l !== '').join('\n');
    }

    // ===== Azure DevOps REST API =====

    private createAdoClient(org: string, pat: string): AxiosInstance {
        return axios.create({
            baseURL: `https://dev.azure.com/${org}`,
            headers: {
                'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    private async createPullRequest(
        gitInfo: GitInfo,
        pat: string,
        title: string,
        description: string,
        options: AdoPrInput
    ): Promise<AdoPrResult> {
        const client = this.createAdoClient(gitInfo.adoOrg, pat);

        const body: any = {
            sourceRefName: `refs/heads/${gitInfo.currentBranch}`,
            targetRefName: `refs/heads/${gitInfo.defaultBranch}`,
            title,
            description,
            isDraft: options.isDraft || false
        };

        if (options.autoComplete) {
            body.completionOptions = {
                deleteSourceBranch: true,
                mergeStrategy: 'squash'
            };
        }

        const response = await client.post(
            `/${gitInfo.adoProject}/_apis/git/repositories/${gitInfo.adoRepo}/pullrequests?api-version=7.1`,
            body
        );

        const pr = response.data;
        const webUrl = `https://dev.azure.com/${gitInfo.adoOrg}/${gitInfo.adoProject}/_git/${gitInfo.adoRepo}/pullrequest/${pr.pullRequestId}`;

        // Set auto-complete if requested
        if (options.autoComplete && pr.createdBy?.id) {
            try {
                await client.patch(
                    `/${gitInfo.adoProject}/_apis/git/repositories/${gitInfo.adoRepo}/pullrequests/${pr.pullRequestId}?api-version=7.1`,
                    {
                        autoCompleteSetBy: { id: pr.createdBy.id },
                        completionOptions: {
                            deleteSourceBranch: true,
                            mergeStrategy: 'squash',
                            transitionWorkItems: true
                        }
                    }
                );
            } catch {
                // auto-complete is best-effort
            }
        }

        return {
            pullRequestId: pr.pullRequestId,
            title: pr.title,
            description: pr.description,
            url: pr.url,
            webUrl,
            sourceBranch: gitInfo.currentBranch,
            targetBranch: gitInfo.defaultBranch,
            status: pr.isDraft ? 'Draft' : 'Active'
        };
    }

    private async linkWorkItems(
        gitInfo: GitInfo,
        pat: string,
        prId: number,
        workItemIds: number[]
    ): Promise<void> {
        const client = this.createAdoClient(gitInfo.adoOrg, pat);

        for (const wiId of workItemIds) {
            try {
                // Get PR artifact link
                const prUrl = `vstfs:///Git/PullRequestId/${gitInfo.adoProject}%2F${gitInfo.adoRepo}%2F${prId}`;
                
                await client.patch(
                    `/${gitInfo.adoProject}/_apis/wit/workitems/${wiId}?api-version=7.1`,
                    [
                        {
                            op: 'add',
                            path: '/relations/-',
                            value: {
                                rel: 'ArtifactLink',
                                url: prUrl,
                                attributes: {
                                    name: 'Pull Request'
                                }
                            }
                        }
                    ],
                    { headers: { 'Content-Type': 'application/json-patch+json' } }
                );
            } catch (error) {
                console.warn(`Failed to link work item ${wiId}:`, error);
            }
        }
    }

    private async addReviewers(
        gitInfo: GitInfo,
        pat: string,
        prId: number,
        reviewerEmails: string[]
    ): Promise<void> {
        const client = this.createAdoClient(gitInfo.adoOrg, pat);

        for (const email of reviewerEmails) {
            try {
                // Search for user by email
                const searchClient = axios.create({
                    baseURL: `https://vssps.dev.azure.com/${gitInfo.adoOrg}`,
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
                        'Content-Type': 'application/json'
                    }
                });

                const userResponse = await searchClient.get(
                    `/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(email)}&api-version=7.1`
                );

                if (userResponse.data.value?.length > 0) {
                    const userId = userResponse.data.value[0].id;
                    await client.put(
                        `/${gitInfo.adoProject}/_apis/git/repositories/${gitInfo.adoRepo}/pullrequests/${prId}/reviewers/${userId}?api-version=7.1`,
                        { vote: 0, isRequired: false }
                    );
                }
            } catch (error) {
                console.warn(`Failed to add reviewer ${email}:`, error);
            }
        }
    }
}

// ===== Standalone helper for chat commands =====

/**
 * Create a PR from the current branch with auto-generated content.
 * Used directly by the /pr chat command.
 */
export async function createPrFromCurrentBranch(
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    options: {
        targetBranch?: string;
        isDraft?: boolean;
        workItemIds?: number[];
        reviewers?: string[];
        autoComplete?: boolean;
    } = {}
): Promise<AdoPrResult | null> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        stream.markdown('❌ No workspace folder open.');
        return null;
    }

    const tool = new AdoPullRequestTool();
    const result = await tool.invoke(
        { input: options } as any,
        token
    );

    // Extract text from result
    for (const part of (result as any)._parts || []) {
        if (part.value) {
            stream.markdown(part.value);
        }
    }

    return null;
}
