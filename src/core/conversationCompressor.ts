import * as vscode from 'vscode';

/**
 * A compressed conversation segment
 */
export interface CompressedSegment {
    summary: string;
    keyPoints: string[];
    originalMessageCount: number;
    timeRange: {
        start: Date;
        end: Date;
    };
}

/**
 * Conversation message
 */
export interface ConversationMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

/**
 * Compressed conversation state
 */
export interface CompressedConversation {
    compressedHistory: CompressedSegment[];
    recentMessages: ConversationMessage[];
    totalOriginalMessages: number;
    compressionRatio: number;
}

/**
 * Configuration for conversation compression
 */
export interface CompressionConfig {
    maxRecentMessages: number;      // Keep last N messages uncompressed
    compressionThreshold: number;   // Compress when exceeding this many messages
    summaryMaxLength: number;       // Max characters for summary
    preserveKeywords: string[];     // Important keywords to preserve
}

/**
 * ConversationCompressor - Compresses long conversation history
 * Reduces token usage while preserving context
 */
export class ConversationCompressor {
    private defaultConfig: CompressionConfig = {
        maxRecentMessages: 10,
        compressionThreshold: 20,
        summaryMaxLength: 500,
        preserveKeywords: ['error', 'bug', 'fix', 'implement', 'create', 'delete', 'important']
    };

    private conversationHistory: ConversationMessage[] = [];
    private compressedSegments: CompressedSegment[] = [];

    constructor(config?: Partial<CompressionConfig>) {
        if (config) {
            this.defaultConfig = { ...this.defaultConfig, ...config };
        }
    }

    /**
     * Add a message to the conversation
     */
    addMessage(role: 'user' | 'assistant' | 'system', content: string, metadata?: Record<string, any>) {
        this.conversationHistory.push({
            role,
            content,
            timestamp: new Date(),
            metadata
        });
    }

    /**
     * Check if compression is needed
     */
    needsCompression(): boolean {
        return this.conversationHistory.length > this.defaultConfig.compressionThreshold;
    }

    /**
     * Compress older messages
     */
    async compress(
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<CompressedConversation> {
        if (!this.needsCompression()) {
            return {
                compressedHistory: this.compressedSegments,
                recentMessages: this.conversationHistory,
                totalOriginalMessages: this.conversationHistory.length +
                    this.compressedSegments.reduce((sum, s) => sum + s.originalMessageCount, 0),
                compressionRatio: 1
            };
        }

        // Determine how many messages to compress
        const messagesToKeep = this.defaultConfig.maxRecentMessages;
        const messagesToCompress = this.conversationHistory.slice(0, -messagesToKeep);
        const recentMessages = this.conversationHistory.slice(-messagesToKeep);

        if (messagesToCompress.length === 0) {
            return {
                compressedHistory: this.compressedSegments,
                recentMessages: this.conversationHistory,
                totalOriginalMessages: this.conversationHistory.length,
                compressionRatio: 1
            };
        }

        // Compress the older messages
        const compressed = await this.compressMessages(messagesToCompress, model, token);

        this.compressedSegments.push(compressed);
        this.conversationHistory = recentMessages;

        const totalOriginal = this.conversationHistory.length +
            this.compressedSegments.reduce((sum, s) => sum + s.originalMessageCount, 0);

        return {
            compressedHistory: this.compressedSegments,
            recentMessages: this.conversationHistory,
            totalOriginalMessages: totalOriginal,
            compressionRatio: totalOriginal / (this.compressedSegments.length + this.conversationHistory.length)
        };
    }

    /**
     * Compress a batch of messages into a summary
     */
    private async compressMessages(
        messages: ConversationMessage[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<CompressedSegment> {
        const conversationText = messages.map(m =>
            `[${m.role.toUpperCase()}]: ${m.content}`
        ).join('\n\n');

        const prompt = `Summarize the following conversation segment concisely. Extract the key points, decisions made, and important context that should be preserved for future reference.

Conversation:
${conversationText}

Respond in JSON format:
{
    "summary": "A concise summary of the conversation (max ${this.defaultConfig.summaryMaxLength} chars)",
    "keyPoints": ["key point 1", "key point 2", "key point 3"]
}

Focus on:
- Main topics discussed
- Decisions or conclusions reached
- Important technical details
- Any errors or issues mentioned
- Action items or next steps

Only output valid JSON.`;

        const promptMessages = [
            vscode.LanguageModelChatMessage.User(prompt)
        ];

        const response = await model.sendRequest(promptMessages, {}, token);
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }

        // Parse response
        try {
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    summary: parsed.summary || 'Conversation summary unavailable',
                    keyPoints: parsed.keyPoints || [],
                    originalMessageCount: messages.length,
                    timeRange: {
                        start: messages[0].timestamp,
                        end: messages[messages.length - 1].timestamp
                    }
                };
            }
        } catch (e) {
            // Fallback to simple summary
        }

        return {
            summary: this.createSimpleSummary(messages),
            keyPoints: this.extractKeywords(messages),
            originalMessageCount: messages.length,
            timeRange: {
                start: messages[0].timestamp,
                end: messages[messages.length - 1].timestamp
            }
        };
    }

    /**
     * Create a simple summary without LLM
     */
    private createSimpleSummary(messages: ConversationMessage[]): string {
        const userMessages = messages.filter(m => m.role === 'user');
        const topics = userMessages.map(m => {
            // Extract first sentence or first N characters
            const firstSentence = m.content.split(/[.!?]/)[0];
            return firstSentence.slice(0, 100);
        });

        return `Discussion covering: ${topics.slice(0, 3).join('; ')}...`;
    }

    /**
     * Extract keywords from messages
     */
    private extractKeywords(messages: ConversationMessage[]): string[] {
        const allText = messages.map(m => m.content).join(' ').toLowerCase();
        const keywords: string[] = [];

        for (const keyword of this.defaultConfig.preserveKeywords) {
            if (allText.includes(keyword)) {
                keywords.push(keyword);
            }
        }

        // Also extract potential code/file references
        const codePattern = /`([^`]+)`/g;
        let match;
        while ((match = codePattern.exec(allText)) !== null) {
            if (match[1].length < 50) {
                keywords.push(match[1]);
            }
        }

        return [...new Set(keywords)].slice(0, 10);
    }

    /**
     * Get full context for LLM (compressed + recent)
     */
    getContextForLLM(): string {
        let context = '';

        // Add compressed history
        if (this.compressedSegments.length > 0) {
            context += '=== Previous Conversation Summary ===\n\n';
            for (const segment of this.compressedSegments) {
                context += `[${segment.originalMessageCount} messages compressed]\n`;
                context += `Summary: ${segment.summary}\n`;
                if (segment.keyPoints.length > 0) {
                    context += `Key Points: ${segment.keyPoints.join(', ')}\n`;
                }
                context += '\n';
            }
            context += '=== Recent Conversation ===\n\n';
        }

        // Add recent messages
        for (const msg of this.conversationHistory) {
            context += `[${msg.role.toUpperCase()}]: ${msg.content}\n\n`;
        }

        return context;
    }

    /**
     * Get conversation stats
     */
    getStats(): {
        totalMessages: number;
        compressedMessages: number;
        recentMessages: number;
        segments: number;
        estimatedTokensSaved: number;
    } {
        const compressedCount = this.compressedSegments.reduce(
            (sum, s) => sum + s.originalMessageCount, 0
        );

        // Rough estimate: average message is ~100 tokens, summary is ~50 tokens
        const tokensSaved = (compressedCount * 100) - (this.compressedSegments.length * 50);

        return {
            totalMessages: compressedCount + this.conversationHistory.length,
            compressedMessages: compressedCount,
            recentMessages: this.conversationHistory.length,
            segments: this.compressedSegments.length,
            estimatedTokensSaved: Math.max(0, tokensSaved)
        };
    }

    /**
     * Clear all history
     */
    clear() {
        this.conversationHistory = [];
        this.compressedSegments = [];
    }

    /**
     * Export conversation for storage
     */
    export(): { messages: ConversationMessage[]; segments: CompressedSegment[] } {
        return {
            messages: [...this.conversationHistory],
            segments: [...this.compressedSegments]
        };
    }

    /**
     * Import conversation from storage
     */
    import(data: { messages: ConversationMessage[]; segments: CompressedSegment[] }) {
        this.conversationHistory = data.messages || [];
        this.compressedSegments = data.segments || [];
    }

    /**
     * Format compression status for display
     */
    formatStatus(): string {
        const stats = this.getStats();

        if (stats.compressedMessages === 0) {
            return `📝 ${stats.recentMessages} messages in history`;
        }

        return [
            `📝 History: ${stats.totalMessages} total messages`,
            `📦 Compressed: ${stats.compressedMessages} messages → ${stats.segments} summaries`,
            `💾 Estimated tokens saved: ~${stats.estimatedTokensSaved}`
        ].join('\n');
    }
}
