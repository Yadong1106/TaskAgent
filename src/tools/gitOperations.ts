import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type GitOperation =
    | 'status'
    | 'commit'
    | 'push'
    | 'pull'
    | 'branch'
    | 'merge'
    | 'diff'
    | 'log'
    | 'checkout'
    | 'stash'
    | 'add'
    | 'reset'
    | 'resolveConflict';

export interface GitOperationInput {
    operation: GitOperation;
    message?: string;           // For commit
    branch?: string;            // For branch, checkout, merge
    remote?: string;            // For push, pull (default: origin)
    files?: string[];           // For add, commit specific files
    numCommits?: number;        // For log (default: 10)
    createNew?: boolean;        // For branch/checkout (create new branch)
    stashAction?: 'save' | 'pop' | 'list' | 'drop';  // For stash
    conflictStrategy?: 'ours' | 'theirs';  // For resolveConflict
}

interface GitOperationResult {
    success: boolean;
    operation: GitOperation;
    output: string;
    currentBranch?: string;
    hasChanges?: boolean;
    hasConflicts?: boolean;
}

/**
 * GitOperationsTool - Git version control operations
 * Supports: status, commit, push, pull, branch, merge, diff, log, checkout, stash, add, reset, conflict resolution
 */
export class GitOperationsTool implements vscode.LanguageModelTool<GitOperationInput> {

    private workspaceRoot: string | undefined;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GitOperationInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { operation, message, branch, files, remote } = options.input;

        // Destructive operations require confirmation
        const destructiveOps = ['commit', 'push', 'merge', 'checkout', 'reset', 'resolveConflict'];

        if (destructiveOps.includes(operation)) {
            let confirmMessage = `**Operation:** \`git ${operation}\`\n\n`;

            if (message) {
                confirmMessage += `**Message:** ${message}\n\n`;
            }
            if (branch) {
                confirmMessage += `**Branch:** ${branch}\n\n`;
            }
            if (files && files.length > 0) {
                confirmMessage += `**Files:** ${files.join(', ')}\n\n`;
            }
            if (remote) {
                confirmMessage += `**Remote:** ${remote}\n\n`;
            }

            confirmMessage += `Do you want to proceed?`;

            return {
                invocationMessage: `Executing git ${operation}...`,
                confirmationMessages: {
                    title: `Git ${operation.charAt(0).toUpperCase() + operation.slice(1)}`,
                    message: new vscode.MarkdownString(confirmMessage)
                }
            };
        }

        return {
            invocationMessage: `Running git ${operation}...`
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GitOperationInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input;

        try {
            const result = await this.executeGitOperation(input);

            let output = `## Git ${input.operation} ${result.success ? 'Succeeded' : 'Failed'}\n\n`;
            output += `\`\`\`\n${result.output}\n\`\`\``;

            if (result.currentBranch) {
                output += `\n\n**Current Branch:** ${result.currentBranch}`;
            }
            if (result.hasConflicts) {
                output += `\n\n**Warning:** Merge conflicts detected. Use \`resolveConflict\` operation to resolve.`;
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(output)
            ]);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`## Git Operation Failed\n\n**Error:** ${errorMsg}`)
            ]);
        }
    }

    private async executeGitOperation(input: GitOperationInput): Promise<GitOperationResult> {
        const cwd = this.workspaceRoot;
        if (!cwd) {
            throw new Error('No workspace folder open. Please open a folder first.');
        }

        // Verify git is available
        try {
            await execAsync('git --version', { cwd });
        } catch {
            throw new Error('Git is not installed or not available in PATH.');
        }

        switch (input.operation) {
            case 'status':
                return this.gitStatus(cwd);
            case 'add':
                return this.gitAdd(cwd, input.files);
            case 'commit':
                return this.gitCommit(cwd, input.message || 'Auto commit by TaskAgent', input.files);
            case 'push':
                return this.gitPush(cwd, input.remote || 'origin', input.branch);
            case 'pull':
                return this.gitPull(cwd, input.remote || 'origin', input.branch);
            case 'branch':
                return this.gitBranch(cwd, input.branch, input.createNew);
            case 'merge':
                return this.gitMerge(cwd, input.branch!);
            case 'diff':
                return this.gitDiff(cwd, input.files);
            case 'log':
                return this.gitLog(cwd, input.numCommits || 10);
            case 'checkout':
                return this.gitCheckout(cwd, input.branch!, input.createNew);
            case 'stash':
                return this.gitStash(cwd, input.stashAction || 'save', input.message);
            case 'reset':
                return this.gitReset(cwd, input.files);
            case 'resolveConflict':
                return this.gitResolveConflict(cwd, input.files, input.conflictStrategy);
            default:
                throw new Error(`Unknown operation: ${input.operation}`);
        }
    }

    private async gitStatus(cwd: string): Promise<GitOperationResult> {
        const { stdout: statusOutput } = await execAsync('git status', { cwd });
        const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd });

        const hasChanges = !statusOutput.includes('nothing to commit');
        const hasConflicts = statusOutput.includes('Unmerged paths') ||
                            statusOutput.includes('both modified') ||
                            statusOutput.includes('both added');

        return {
            success: true,
            operation: 'status',
            output: statusOutput.trim(),
            currentBranch: branchOutput.trim(),
            hasChanges,
            hasConflicts
        };
    }

    private async gitAdd(cwd: string, files?: string[]): Promise<GitOperationResult> {
        const fileArgs = files && files.length > 0 ? files.join(' ') : '.';
        const { stdout } = await execAsync(`git add ${fileArgs}`, { cwd });

        return {
            success: true,
            operation: 'add',
            output: stdout || `Added files: ${fileArgs}`
        };
    }

    private async gitCommit(cwd: string, message: string, files?: string[]): Promise<GitOperationResult> {
        // First add files if specified
        if (files && files.length > 0) {
            await execAsync(`git add ${files.join(' ')}`, { cwd });
        }

        // Escape double quotes in message
        const escapedMessage = message.replace(/"/g, '\\"');
        const { stdout } = await execAsync(`git commit -m "${escapedMessage}"`, { cwd });

        return {
            success: true,
            operation: 'commit',
            output: stdout.trim()
        };
    }

    private async gitPush(cwd: string, remote: string, branch?: string): Promise<GitOperationResult> {
        const branchArg = branch ? ` ${branch}` : '';
        const { stdout, stderr } = await execAsync(`git push ${remote}${branchArg}`, { cwd });

        return {
            success: true,
            operation: 'push',
            output: stdout || stderr || `Pushed to ${remote}${branchArg}`
        };
    }

    private async gitPull(cwd: string, remote: string, branch?: string): Promise<GitOperationResult> {
        const branchArg = branch ? ` ${branch}` : '';
        const { stdout, stderr } = await execAsync(`git pull ${remote}${branchArg}`, { cwd });

        const hasConflicts = (stdout + stderr).includes('CONFLICT') ||
                            (stdout + stderr).includes('Automatic merge failed');

        return {
            success: true,
            operation: 'pull',
            output: stdout || stderr || `Pulled from ${remote}${branchArg}`,
            hasConflicts
        };
    }

    private async gitBranch(cwd: string, branch?: string, createNew?: boolean): Promise<GitOperationResult> {
        let output: string;

        if (!branch) {
            // List branches
            const { stdout } = await execAsync('git branch -a', { cwd });
            output = stdout.trim();
        } else if (createNew) {
            // Create new branch
            const { stdout, stderr } = await execAsync(`git branch ${branch}`, { cwd });
            output = stdout || stderr || `Created branch: ${branch}`;
        } else {
            // Delete branch (only if -d flag would be safe)
            const { stdout, stderr } = await execAsync(`git branch -d ${branch}`, { cwd });
            output = stdout || stderr || `Deleted branch: ${branch}`;
        }

        const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd });

        return {
            success: true,
            operation: 'branch',
            output,
            currentBranch: currentBranch.trim()
        };
    }

    private async gitMerge(cwd: string, branch: string): Promise<GitOperationResult> {
        try {
            const { stdout, stderr } = await execAsync(`git merge ${branch}`, { cwd });
            const output = stdout || stderr;

            const hasConflicts = output.includes('CONFLICT') || output.includes('Automatic merge failed');

            return {
                success: !hasConflicts,
                operation: 'merge',
                output: output.trim(),
                hasConflicts
            };
        } catch (error: any) {
            const output = error.stdout || error.stderr || error.message;
            const hasConflicts = output.includes('CONFLICT') || output.includes('Automatic merge failed');

            return {
                success: false,
                operation: 'merge',
                output: output.trim(),
                hasConflicts
            };
        }
    }

    private async gitDiff(cwd: string, files?: string[]): Promise<GitOperationResult> {
        const fileArgs = files && files.length > 0 ? ` -- ${files.join(' ')}` : '';
        const { stdout } = await execAsync(`git diff${fileArgs}`, { cwd });

        return {
            success: true,
            operation: 'diff',
            output: stdout || 'No changes detected'
        };
    }

    private async gitLog(cwd: string, numCommits: number): Promise<GitOperationResult> {
        const { stdout } = await execAsync(
            `git log --oneline --graph --decorate -n ${numCommits}`,
            { cwd }
        );

        return {
            success: true,
            operation: 'log',
            output: stdout.trim() || 'No commits found'
        };
    }

    private async gitCheckout(cwd: string, branch: string, createNew?: boolean): Promise<GitOperationResult> {
        const createFlag = createNew ? '-b ' : '';
        const { stdout, stderr } = await execAsync(`git checkout ${createFlag}${branch}`, { cwd });

        const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd });

        return {
            success: true,
            operation: 'checkout',
            output: stdout || stderr || `Switched to branch: ${branch}`,
            currentBranch: currentBranch.trim()
        };
    }

    private async gitStash(cwd: string, action: string, message?: string): Promise<GitOperationResult> {
        let cmd: string;

        switch (action) {
            case 'save':
                cmd = message ? `git stash push -m "${message}"` : 'git stash push';
                break;
            case 'pop':
                cmd = 'git stash pop';
                break;
            case 'list':
                cmd = 'git stash list';
                break;
            case 'drop':
                cmd = 'git stash drop';
                break;
            default:
                cmd = 'git stash';
        }

        const { stdout, stderr } = await execAsync(cmd, { cwd });

        return {
            success: true,
            operation: 'stash',
            output: stdout || stderr || `Stash ${action} completed`
        };
    }

    private async gitReset(cwd: string, files?: string[]): Promise<GitOperationResult> {
        const fileArgs = files && files.length > 0 ? ` -- ${files.join(' ')}` : '';
        const { stdout, stderr } = await execAsync(`git reset HEAD${fileArgs}`, { cwd });

        return {
            success: true,
            operation: 'reset',
            output: stdout || stderr || `Reset completed${fileArgs}`
        };
    }

    private async gitResolveConflict(
        cwd: string,
        files?: string[],
        strategy?: 'ours' | 'theirs'
    ): Promise<GitOperationResult> {
        if (!files || files.length === 0) {
            // Get list of conflicted files
            const { stdout } = await execAsync('git diff --name-only --diff-filter=U', { cwd });
            files = stdout.trim().split('\n').filter(f => f);

            if (files.length === 0) {
                return {
                    success: true,
                    operation: 'resolveConflict',
                    output: 'No conflicts to resolve'
                };
            }
        }

        let output = '';

        for (const file of files) {
            if (strategy === 'ours') {
                await execAsync(`git checkout --ours "${file}"`, { cwd });
                output += `Resolved ${file} using 'ours' (current branch)\n`;
            } else if (strategy === 'theirs') {
                await execAsync(`git checkout --theirs "${file}"`, { cwd });
                output += `Resolved ${file} using 'theirs' (incoming branch)\n`;
            } else {
                output += `File ${file} needs manual resolution\n`;
            }
        }

        // Stage resolved files if strategy was specified
        if (strategy && files.length > 0) {
            await execAsync(`git add ${files.join(' ')}`, { cwd });
            output += '\nResolved files have been staged.';
        }

        return {
            success: true,
            operation: 'resolveConflict',
            output: output.trim()
        };
    }
}
