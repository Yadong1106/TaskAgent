import * as vscode from 'vscode';
import { AgentRegistry } from './agentRegistry';
import { MemoryModule } from './memory';

/**
 * Metrics for a single agent execution
 */
export interface AgentExecutionMetric {
    agentId: string;
    taskId: string;
    taskName: string;
    startTime: Date;
    endTime: Date;
    duration: number;  // milliseconds
    success: boolean;
    tokenCount?: number;
    errorMessage?: string;
}

/**
 * Aggregated statistics for an agent
 */
export interface AgentStats {
    agentId: string;
    agentName: string;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;  // 0-1
    averageDuration: number;  // milliseconds
    minDuration: number;
    maxDuration: number;
    totalTokens: number;
    lastExecution: Date | null;
    recentExecutions: AgentExecutionMetric[];
}

/**
 * Overall system analytics
 */
export interface SystemAnalytics {
    totalExecutions: number;
    totalAgentsUsed: number;
    overallSuccessRate: number;
    averageDuration: number;
    agentStats: Map<string, AgentStats>;
    mostUsedAgent: string | null;
    mostReliableAgent: string | null;
    fastestAgent: string | null;
    peakUsageHour: number | null;
    executionsByHour: Map<number, number>;
}

/**
 * AgentAnalytics - Track and analyze agent performance
 */
export class AgentAnalytics {
    private executions: AgentExecutionMetric[] = [];
    private maxStoredExecutions = 1000;

    constructor(
        private agentRegistry: AgentRegistry,
        private memoryModule?: MemoryModule
    ) {
        // Load historical data from memory if available
        this.loadFromMemory();
    }

    /**
     * Record an agent execution
     */
    recordExecution(metric: Omit<AgentExecutionMetric, 'duration'>) {
        const duration = metric.endTime.getTime() - metric.startTime.getTime();

        const fullMetric: AgentExecutionMetric = {
            ...metric,
            duration
        };

        this.executions.push(fullMetric);

        // Trim old executions
        if (this.executions.length > this.maxStoredExecutions) {
            this.executions = this.executions.slice(-this.maxStoredExecutions);
        }

        // Persist to memory
        this.saveToMemory();
    }

    /**
     * Start tracking an execution (returns a finish function)
     */
    startTracking(agentId: string, taskId: string, taskName: string): {
        finish: (success: boolean, tokenCount?: number, errorMessage?: string) => void;
    } {
        const startTime = new Date();

        return {
            finish: (success: boolean, tokenCount?: number, errorMessage?: string) => {
                this.recordExecution({
                    agentId,
                    taskId,
                    taskName,
                    startTime,
                    endTime: new Date(),
                    success,
                    tokenCount,
                    errorMessage
                });
            }
        };
    }

    /**
     * Get statistics for a specific agent
     */
    getAgentStats(agentId: string): AgentStats {
        const agent = this.agentRegistry.getAgent(agentId);
        const agentExecutions = this.executions.filter(e => e.agentId === agentId);

        if (agentExecutions.length === 0) {
            return {
                agentId,
                agentName: agent?.name || agentId,
                totalExecutions: 0,
                successfulExecutions: 0,
                failedExecutions: 0,
                successRate: 0,
                averageDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                totalTokens: 0,
                lastExecution: null,
                recentExecutions: []
            };
        }

        const successful = agentExecutions.filter(e => e.success);
        const failed = agentExecutions.filter(e => !e.success);
        const durations = agentExecutions.map(e => e.duration);
        const tokens = agentExecutions.map(e => e.tokenCount || 0);

        return {
            agentId,
            agentName: agent?.name || agentId,
            totalExecutions: agentExecutions.length,
            successfulExecutions: successful.length,
            failedExecutions: failed.length,
            successRate: successful.length / agentExecutions.length,
            averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
            minDuration: Math.min(...durations),
            maxDuration: Math.max(...durations),
            totalTokens: tokens.reduce((a, b) => a + b, 0),
            lastExecution: agentExecutions[agentExecutions.length - 1].endTime,
            recentExecutions: agentExecutions.slice(-10)
        };
    }

    /**
     * Get all agent statistics
     */
    getAllAgentStats(): AgentStats[] {
        const agentIds = new Set(this.executions.map(e => e.agentId));
        return Array.from(agentIds).map(id => this.getAgentStats(id));
    }

    /**
     * Get system-wide analytics
     */
    getSystemAnalytics(): SystemAnalytics {
        const allStats = this.getAllAgentStats();
        const agentStatsMap = new Map(allStats.map(s => [s.agentId, s]));

        // Calculate overall metrics
        const totalExecutions = this.executions.length;
        const successfulExecutions = this.executions.filter(e => e.success).length;
        const durations = this.executions.map(e => e.duration);

        // Find top performers
        const sortedByUsage = [...allStats].sort((a, b) => b.totalExecutions - a.totalExecutions);
        const sortedByReliability = [...allStats].filter(s => s.totalExecutions >= 5)
            .sort((a, b) => b.successRate - a.successRate);
        const sortedBySpeed = [...allStats].filter(s => s.totalExecutions >= 5)
            .sort((a, b) => a.averageDuration - b.averageDuration);

        // Execution distribution by hour
        const executionsByHour = new Map<number, number>();
        for (const exec of this.executions) {
            const hour = exec.startTime.getHours();
            executionsByHour.set(hour, (executionsByHour.get(hour) || 0) + 1);
        }

        // Find peak usage hour
        let peakHour: number | null = null;
        let peakCount = 0;
        for (const [hour, count] of executionsByHour) {
            if (count > peakCount) {
                peakCount = count;
                peakHour = hour;
            }
        }

        return {
            totalExecutions,
            totalAgentsUsed: agentStatsMap.size,
            overallSuccessRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
            averageDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
            agentStats: agentStatsMap,
            mostUsedAgent: sortedByUsage[0]?.agentId || null,
            mostReliableAgent: sortedByReliability[0]?.agentId || null,
            fastestAgent: sortedBySpeed[0]?.agentId || null,
            peakUsageHour: peakHour,
            executionsByHour
        };
    }

    /**
     * Get recent executions
     */
    getRecentExecutions(count: number = 20): AgentExecutionMetric[] {
        return this.executions.slice(-count).reverse();
    }

    /**
     * Get executions for a time range
     */
    getExecutionsInRange(start: Date, end: Date): AgentExecutionMetric[] {
        return this.executions.filter(e =>
            e.startTime >= start && e.startTime <= end
        );
    }

    /**
     * Format analytics for display
     */
    formatAnalyticsReport(): string {
        const analytics = this.getSystemAnalytics();
        const lines: string[] = [];

        lines.push('# Agent Performance Analytics\n');

        // Overview
        lines.push('## Overview\n');
        lines.push(`- **Total Executions:** ${analytics.totalExecutions}`);
        lines.push(`- **Agents Used:** ${analytics.totalAgentsUsed}`);
        lines.push(`- **Overall Success Rate:** ${(analytics.overallSuccessRate * 100).toFixed(1)}%`);
        lines.push(`- **Average Duration:** ${this.formatDuration(analytics.averageDuration)}`);
        lines.push('');

        // Top Performers
        lines.push('## Top Performers\n');
        if (analytics.mostUsedAgent) {
            const agent = this.agentRegistry.getAgent(analytics.mostUsedAgent);
            lines.push(`- **Most Used:** ${agent?.name || analytics.mostUsedAgent}`);
        }
        if (analytics.mostReliableAgent) {
            const agent = this.agentRegistry.getAgent(analytics.mostReliableAgent);
            const stats = analytics.agentStats.get(analytics.mostReliableAgent);
            lines.push(`- **Most Reliable:** ${agent?.name || analytics.mostReliableAgent} (${(stats?.successRate || 0) * 100}%)`);
        }
        if (analytics.fastestAgent) {
            const agent = this.agentRegistry.getAgent(analytics.fastestAgent);
            const stats = analytics.agentStats.get(analytics.fastestAgent);
            lines.push(`- **Fastest:** ${agent?.name || analytics.fastestAgent} (avg ${this.formatDuration(stats?.averageDuration || 0)})`);
        }
        lines.push('');

        // Agent Details
        lines.push('## Agent Statistics\n');
        lines.push('| Agent | Executions | Success Rate | Avg Duration | Tokens |');
        lines.push('|-------|------------|--------------|--------------|--------|');

        for (const stats of this.getAllAgentStats().sort((a, b) => b.totalExecutions - a.totalExecutions)) {
            lines.push(`| ${stats.agentName} | ${stats.totalExecutions} | ${(stats.successRate * 100).toFixed(0)}% | ${this.formatDuration(stats.averageDuration)} | ${stats.totalTokens.toLocaleString()} |`);
        }
        lines.push('');

        // Peak Usage
        if (analytics.peakUsageHour !== null) {
            lines.push('## Usage Patterns\n');
            lines.push(`- **Peak Usage Hour:** ${analytics.peakUsageHour}:00 - ${analytics.peakUsageHour + 1}:00`);
        }

        return lines.join('\n');
    }

    /**
     * Format duration for display
     */
    private formatDuration(ms: number): string {
        if (ms < 1000) return `${ms.toFixed(0)}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    }

    /**
     * Render analytics dashboard to stream
     */
    async renderDashboard(stream: vscode.ChatResponseStream) {
        const analytics = this.getSystemAnalytics();

        stream.markdown('## 📊 Agent Performance Dashboard\n\n');

        // Overview cards
        stream.markdown('### Overview\n\n');
        stream.markdown(`| Metric | Value |\n`);
        stream.markdown(`|--------|-------|\n`);
        stream.markdown(`| Total Executions | ${analytics.totalExecutions} |\n`);
        stream.markdown(`| Active Agents | ${analytics.totalAgentsUsed} |\n`);
        stream.markdown(`| Success Rate | ${(analytics.overallSuccessRate * 100).toFixed(1)}% |\n`);
        stream.markdown(`| Avg Response Time | ${this.formatDuration(analytics.averageDuration)} |\n`);
        stream.markdown('\n');

        // Agent performance bars
        stream.markdown('### Agent Performance\n\n');

        const allStats = this.getAllAgentStats()
            .filter(s => s.totalExecutions > 0)
            .sort((a, b) => b.totalExecutions - a.totalExecutions);

        for (const stats of allStats) {
            const successBar = this.renderProgressBar(stats.successRate);
            const emoji = stats.successRate >= 0.9 ? '🌟' :
                         stats.successRate >= 0.7 ? '✅' :
                         stats.successRate >= 0.5 ? '⚠️' : '❌';

            stream.markdown(`**${stats.agentName}** ${emoji}\n`);
            stream.markdown(`- Executions: ${stats.totalExecutions} | Success: ${successBar} ${(stats.successRate * 100).toFixed(0)}%\n`);
            stream.markdown(`- Avg Time: ${this.formatDuration(stats.averageDuration)} | Tokens: ${stats.totalTokens.toLocaleString()}\n\n`);
        }

        // Recent activity
        stream.markdown('### Recent Activity\n\n');
        const recent = this.getRecentExecutions(5);

        if (recent.length === 0) {
            stream.markdown('*No recent executions*\n');
        } else {
            stream.markdown('| Time | Agent | Task | Status | Duration |\n');
            stream.markdown('|------|-------|------|--------|----------|\n');

            for (const exec of recent) {
                const status = exec.success ? '✅' : '❌';
                const time = exec.endTime.toLocaleTimeString();
                const agent = this.agentRegistry.getAgent(exec.agentId)?.name || exec.agentId;
                const taskName = exec.taskName.slice(0, 30) + (exec.taskName.length > 30 ? '...' : '');

                stream.markdown(`| ${time} | ${agent} | ${taskName} | ${status} | ${this.formatDuration(exec.duration)} |\n`);
            }
        }
    }

    /**
     * Render a progress bar
     */
    private renderProgressBar(value: number): string {
        const filled = Math.round(value * 10);
        const empty = 10 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    /**
     * Clear all analytics data
     */
    clear() {
        this.executions = [];
        this.saveToMemory();
    }

    /**
     * Save to memory module
     */
    private saveToMemory() {
        if (this.memoryModule) {
            try {
                this.memoryModule.store('agent_analytics', {
                    executions: this.executions.map(e => ({
                        ...e,
                        startTime: e.startTime.toISOString(),
                        endTime: e.endTime.toISOString()
                    }))
                }, { type: 'analytics', persistent: true });
            } catch (e) {
                console.warn('Failed to save analytics to memory:', e);
            }
        }
    }

    /**
     * Load from memory module
     */
    private loadFromMemory() {
        if (this.memoryModule) {
            try {
                const data = this.memoryModule.retrieve('agent_analytics');
                if (data && data.executions) {
                    this.executions = data.executions.map((e: any) => ({
                        ...e,
                        startTime: new Date(e.startTime),
                        endTime: new Date(e.endTime)
                    }));
                }
            } catch (e) {
                console.warn('Failed to load analytics from memory:', e);
            }
        }
    }

    /**
     * Export analytics data
     */
    export(): { executions: AgentExecutionMetric[] } {
        return { executions: [...this.executions] };
    }

    /**
     * Import analytics data
     */
    import(data: { executions: AgentExecutionMetric[] }) {
        this.executions = data.executions || [];
    }
}
