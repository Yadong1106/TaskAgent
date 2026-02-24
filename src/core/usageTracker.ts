import * as vscode from 'vscode';

/**
 * Single LLM call record
 */
export interface LlmCallRecord {
    id: string;
    timestamp: number;
    modelId: string;
    modelFamily: string;
    /** Who initiated the call: orchestrator, workforce, embedding, adoPR, etc. */
    caller: string;
    /** What the call was for */
    purpose: string;
    /** Estimated input tokens (from prompt length) */
    inputTokens: number;
    /** Estimated output tokens (from response length) */
    outputTokens: number;
    /** Total estimated tokens */
    totalTokens: number;
    /** Duration in ms */
    duration: number;
    /** Whether the call succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
}

/**
 * Aggregated model usage stats
 */
export interface ModelUsageStats {
    modelId: string;
    modelFamily: string;
    callCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    avgDuration: number;
    totalDuration: number;
    successCount: number;
    failureCount: number;
    /** Estimated cost in USD (rough) */
    estimatedCost: number;
}

/**
 * Caller (component) usage stats
 */
export interface CallerUsageStats {
    caller: string;
    callCount: number;
    totalTokens: number;
    totalDuration: number;
    modelBreakdown: { modelId: string; tokens: number; calls: number }[];
}

/**
 * Time-series data point for charts
 */
export interface UsageDataPoint {
    timestamp: number;
    hour: string;
    tokens: number;
    calls: number;
}

// Rough pricing per 1M tokens (USD, as of 2026 estimates)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'claude-3.5-sonnet': { input: 3.00, output: 15.00 },
    'claude-3-opus': { input: 15.00, output: 75.00 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    'copilot': { input: 0, output: 0 }, // Included in subscription
    'default': { input: 2.50, output: 10.00 }
};

/**
 * Rough token estimation from text length
 * ~4 characters per token for English, ~2 for code
 */
function estimateTokens(text: string): number {
    if (!text) return 0;
    // Heuristic: code has more tokens per char than prose
    const hasCode = text.includes('{') || text.includes('function') || text.includes('import');
    const charsPerToken = hasCode ? 3 : 4;
    return Math.ceil(text.length / charsPerToken);
}

/**
 * UsageTracker - Track LLM token usage across the extension
 * 
 * Features:
 * - Record every LLM call with token estimates
 * - Per-model aggregated stats
 * - Per-caller (component) breakdown
 * - Time-series usage data for charts
 * - Estimated cost calculation
 * - Session and all-time tracking
 */
export class UsageTracker {
    private records: LlmCallRecord[] = [];
    private sessionStart: number = Date.now();
    private _onUpdate = new vscode.EventEmitter<void>();
    readonly onUpdate = this._onUpdate.event;

    private maxRecords = 5000;

    /**
     * Record an LLM call
     */
    recordCall(params: {
        modelId: string;
        modelFamily?: string;
        caller: string;
        purpose: string;
        inputText: string;
        outputText: string;
        duration: number;
        success: boolean;
        error?: string;
    }): LlmCallRecord {
        const inputTokens = estimateTokens(params.inputText);
        const outputTokens = estimateTokens(params.outputText);

        const record: LlmCallRecord = {
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            modelId: params.modelId,
            modelFamily: params.modelFamily || this.extractFamily(params.modelId),
            caller: params.caller,
            purpose: params.purpose,
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            duration: params.duration,
            success: params.success,
            error: params.error
        };

        this.records.push(record);

        // Trim old records
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }

        this._onUpdate.fire();
        return record;
    }

    /**
     * Wrap an LLM sendRequest call with automatic tracking
     */
    async trackLlmCall<T>(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options: vscode.LanguageModelChatRequestOptions,
        token: vscode.CancellationToken,
        caller: string,
        purpose: string
    ): Promise<{ response: vscode.LanguageModelChatResponse; text: string }> {
        const inputText = messages.map(m => {
            // Extract text from message parts
            const parts = (m as any).content || [];
            if (typeof parts === 'string') return parts;
            if (Array.isArray(parts)) {
                return parts.map((p: any) => p.value || p.text || '').join('');
            }
            return String(m);
        }).join('\n');

        const startTime = Date.now();
        let outputText = '';
        let success = true;
        let error: string | undefined;

        try {
            const response = await model.sendRequest(messages, options, token);
            
            // Collect full text
            for await (const chunk of response.text) {
                outputText += chunk;
            }

            return { response, text: outputText };
        } catch (err) {
            success = false;
            error = err instanceof Error ? err.message : String(err);
            throw err;
        } finally {
            this.recordCall({
                modelId: model.id || 'unknown',
                modelFamily: model.family || 'unknown',
                caller,
                purpose,
                inputText,
                outputText,
                duration: Date.now() - startTime,
                success,
                error
            });
        }
    }

    // ===== Aggregated Stats =====

    /**
     * Get per-model usage stats
     */
    getModelStats(): ModelUsageStats[] {
        const map = new Map<string, ModelUsageStats>();

        for (const r of this.records) {
            const key = r.modelId || r.modelFamily;
            let stats = map.get(key);
            if (!stats) {
                stats = {
                    modelId: r.modelId,
                    modelFamily: r.modelFamily,
                    callCount: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    totalTokens: 0,
                    avgDuration: 0,
                    totalDuration: 0,
                    successCount: 0,
                    failureCount: 0,
                    estimatedCost: 0
                };
                map.set(key, stats);
            }

            stats.callCount++;
            stats.totalInputTokens += r.inputTokens;
            stats.totalOutputTokens += r.outputTokens;
            stats.totalTokens += r.totalTokens;
            stats.totalDuration += r.duration;
            if (r.success) stats.successCount++;
            else stats.failureCount++;
        }

        // Calculate averages and costs
        for (const stats of map.values()) {
            stats.avgDuration = stats.callCount > 0 ? Math.round(stats.totalDuration / stats.callCount) : 0;
            stats.estimatedCost = this.estimateCost(stats.modelFamily, stats.totalInputTokens, stats.totalOutputTokens);
        }

        return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    }

    /**
     * Get per-caller (component) usage stats
     */
    getCallerStats(): CallerUsageStats[] {
        const map = new Map<string, CallerUsageStats>();

        for (const r of this.records) {
            let stats = map.get(r.caller);
            if (!stats) {
                stats = {
                    caller: r.caller,
                    callCount: 0,
                    totalTokens: 0,
                    totalDuration: 0,
                    modelBreakdown: []
                };
                map.set(r.caller, stats);
            }
            stats.callCount++;
            stats.totalTokens += r.totalTokens;
            stats.totalDuration += r.duration;
        }

        // Build model breakdown per caller
        for (const [caller, stats] of map) {
            const modelMap = new Map<string, { tokens: number; calls: number }>();
            for (const r of this.records.filter(r => r.caller === caller)) {
                const key = r.modelId || r.modelFamily;
                const m = modelMap.get(key) || { tokens: 0, calls: 0 };
                m.tokens += r.totalTokens;
                m.calls++;
                modelMap.set(key, m);
            }
            stats.modelBreakdown = Array.from(modelMap.entries())
                .map(([modelId, data]) => ({ modelId, ...data }))
                .sort((a, b) => b.tokens - a.tokens);
        }

        return Array.from(map.values()).sort((a, b) => b.totalTokens - a.totalTokens);
    }

    /**
     * Get hourly usage for time-series chart
     */
    getHourlyUsage(hours: number = 24): UsageDataPoint[] {
        const now = Date.now();
        const cutoff = now - hours * 60 * 60 * 1000;
        const recentRecords = this.records.filter(r => r.timestamp >= cutoff);

        const hourMap = new Map<string, UsageDataPoint>();

        for (const r of recentRecords) {
            const date = new Date(r.timestamp);
            const hourKey = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
            let point = hourMap.get(hourKey);
            if (!point) {
                point = { timestamp: r.timestamp, hour: hourKey, tokens: 0, calls: 0 };
                hourMap.set(hourKey, point);
            }
            point.tokens += r.totalTokens;
            point.calls++;
        }

        return Array.from(hourMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Get recent call log
     */
    getRecentCalls(limit: number = 30): LlmCallRecord[] {
        return this.records.slice(-limit).reverse();
    }

    // ===== Summary Stats =====

    getSummary() {
        const totalCalls = this.records.length;
        const totalTokens = this.records.reduce((sum, r) => sum + r.totalTokens, 0);
        const totalInput = this.records.reduce((sum, r) => sum + r.inputTokens, 0);
        const totalOutput = this.records.reduce((sum, r) => sum + r.outputTokens, 0);
        const totalDuration = this.records.reduce((sum, r) => sum + r.duration, 0);
        const successCount = this.records.filter(r => r.success).length;
        const failureCount = this.records.filter(r => !r.success).length;
        const modelStats = this.getModelStats();
        const totalCost = modelStats.reduce((sum, m) => sum + m.estimatedCost, 0);
        const sessionDuration = Date.now() - this.sessionStart;

        return {
            totalCalls,
            totalTokens,
            totalInput,
            totalOutput,
            totalDuration,
            avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
            successCount,
            failureCount,
            successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 0,
            totalEstimatedCost: totalCost,
            sessionDurationMs: sessionDuration,
            uniqueModels: new Set(this.records.map(r => r.modelId)).size,
            tokensPerMinute: sessionDuration > 0 ? Math.round(totalTokens / (sessionDuration / 60000)) : 0
        };
    }

    // ===== Helpers =====

    private extractFamily(modelId: string): string {
        const lower = modelId.toLowerCase();
        if (lower.includes('gpt-4o-mini')) return 'gpt-4o-mini';
        if (lower.includes('gpt-4o')) return 'gpt-4o';
        if (lower.includes('gpt-4')) return 'gpt-4';
        if (lower.includes('gpt-3.5')) return 'gpt-3.5-turbo';
        if (lower.includes('claude') && lower.includes('opus')) return 'claude-3-opus';
        if (lower.includes('claude') && lower.includes('sonnet')) return 'claude-3.5-sonnet';
        if (lower.includes('claude') && lower.includes('haiku')) return 'claude-3-haiku';
        if (lower.includes('copilot')) return 'copilot';
        return modelId;
    }

    private estimateCost(modelFamily: string, inputTokens: number, outputTokens: number): number {
        const pricing = MODEL_PRICING[modelFamily] || MODEL_PRICING['default'];
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
    }

    /**
     * Format tokens for display (e.g., 1234 → "1.2K", 1234567 → "1.2M")
     */
    static formatTokens(tokens: number): string {
        if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M';
        if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K';
        return String(tokens);
    }

    /**
     * Format duration for display
     */
    static formatDuration(ms: number): string {
        if (ms >= 60_000) return (ms / 60_000).toFixed(1) + 'm';
        if (ms >= 1_000) return (ms / 1_000).toFixed(1) + 's';
        return ms + 'ms';
    }

    /**
     * Format cost for display
     */
    static formatCost(cost: number): string {
        if (cost === 0) return 'Free';
        if (cost < 0.01) return '<$0.01';
        return '$' + cost.toFixed(2);
    }
}
