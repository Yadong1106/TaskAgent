import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Memory Entry - A single memory item
 */
export interface MemoryEntry {
    id: string;
    timestamp: number;
    type: 'conversation' | 'task' | 'feedback' | 'learning';
    content: string;
    metadata: {
        taskId?: string;
        agentId?: string;
        quality?: number;  // 1-5 rating
        tags?: string[];
        context?: string;
    };
    embedding?: number[];  // For semantic search (future)
}

/**
 * Conversation Turn - For role-playing and dialogue history
 */
export interface ConversationTurn {
    role: string;
    content: string;
    timestamp: number;
}

/**
 * Memory Module - Stateful memory for agents
 * Inspired by CAMEL's memory system
 * 
 * Features:
 * - Short-term memory (current session)
 * - Long-term memory (persisted to disk)
 * - Semantic retrieval (future: embeddings)
 * - Feedback collection for learning
 */
export class MemoryModule {
    private shortTermMemory: MemoryEntry[] = [];
    private longTermMemory: MemoryEntry[] = [];
    private conversationHistory: Map<string, ConversationTurn[]> = new Map();
    private storagePath: string;
    private maxShortTermSize: number = 100;
    private maxLongTermSize: number = 1000;

    constructor(context: vscode.ExtensionContext) {
        this.storagePath = path.join(context.globalStorageUri.fsPath, 'memory');
        this.ensureStorageExists();
        this.loadLongTermMemory();
    }

    private ensureStorageExists() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    private generateId(): string {
        return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Add a memory entry
     */
    addMemory(
        type: MemoryEntry['type'],
        content: string,
        metadata: MemoryEntry['metadata'] = {}
    ): MemoryEntry {
        const entry: MemoryEntry = {
            id: this.generateId(),
            timestamp: Date.now(),
            type,
            content,
            metadata
        };

        this.shortTermMemory.push(entry);

        // Trim short-term memory if too large
        if (this.shortTermMemory.length > this.maxShortTermSize) {
            // Move oldest to long-term memory
            const oldest = this.shortTermMemory.shift()!;
            this.promotToLongTerm(oldest);
        }

        return entry;
    }

    /**
     * Add a conversation turn (for role-playing)
     */
    addConversationTurn(sessionId: string, role: string, content: string) {
        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        
        this.conversationHistory.get(sessionId)!.push({
            role,
            content,
            timestamp: Date.now()
        });
    }

    /**
     * Get conversation history for a session
     */
    getConversationHistory(sessionId: string, limit?: number): ConversationTurn[] {
        const history = this.conversationHistory.get(sessionId) || [];
        if (limit) {
            return history.slice(-limit);
        }
        return history;
    }

    /**
     * Format conversation history as context
     */
    formatConversationContext(sessionId: string, limit: number = 10): string {
        const history = this.getConversationHistory(sessionId, limit);
        if (history.length === 0) return '';

        return history
            .map(turn => `[${turn.role}]: ${turn.content}`)
            .join('\n\n');
    }

    /**
     * Move memory to long-term storage
     */
    private promotToLongTerm(entry: MemoryEntry) {
        this.longTermMemory.push(entry);
        
        // Trim long-term memory if too large
        if (this.longTermMemory.length > this.maxLongTermSize) {
            // Remove lowest quality entries first
            this.longTermMemory.sort((a, b) => 
                (b.metadata.quality || 3) - (a.metadata.quality || 3)
            );
            this.longTermMemory = this.longTermMemory.slice(0, this.maxLongTermSize);
        }

        this.saveLongTermMemory();
    }

    /**
     * Record feedback for a task/response
     */
    recordFeedback(
        taskId: string,
        quality: number,
        feedback: string,
        tags?: string[]
    ) {
        this.addMemory('feedback', feedback, {
            taskId,
            quality,
            tags
        });

        // Update quality rating of related memories
        this.shortTermMemory
            .filter(m => m.metadata.taskId === taskId)
            .forEach(m => m.metadata.quality = quality);
    }

    /**
     * Search memories by content (simple text match)
     * Future: Use embeddings for semantic search
     */
    searchMemories(query: string, type?: MemoryEntry['type'], limit: number = 10): MemoryEntry[] {
        const allMemories = [...this.shortTermMemory, ...this.longTermMemory];
        const queryLower = query.toLowerCase();

        return allMemories
            .filter(m => {
                if (type && m.type !== type) return false;
                return m.content.toLowerCase().includes(queryLower) ||
                       m.metadata.tags?.some(t => t.toLowerCase().includes(queryLower));
            })
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get recent memories for context
     */
    getRecentContext(limit: number = 5): string {
        const recent = this.shortTermMemory.slice(-limit);
        if (recent.length === 0) return '';

        return recent
            .map(m => `[${m.type}] ${m.content.slice(0, 200)}...`)
            .join('\n');
    }

    /**
     * Get high-quality memories for learning
     */
    getHighQualityMemories(minQuality: number = 4): MemoryEntry[] {
        return [...this.shortTermMemory, ...this.longTermMemory]
            .filter(m => (m.metadata.quality || 0) >= minQuality);
    }

    /**
     * Export memories for training data generation
     */
    exportForTraining(type?: MemoryEntry['type']): object[] {
        const memories = type 
            ? this.longTermMemory.filter(m => m.type === type)
            : this.longTermMemory;

        return memories.map(m => ({
            input: m.metadata.context || '',
            output: m.content,
            quality: m.metadata.quality || 3,
            tags: m.metadata.tags || []
        }));
    }

    /**
     * Clear short-term memory
     */
    clearShortTerm() {
        this.shortTermMemory = [];
    }

    /**
     * Save long-term memory to disk
     */
    private saveLongTermMemory() {
        const filePath = path.join(this.storagePath, 'long_term_memory.json');
        fs.writeFileSync(filePath, JSON.stringify(this.longTermMemory, null, 2));
    }

    /**
     * Load long-term memory from disk
     */
    private loadLongTermMemory() {
        const filePath = path.join(this.storagePath, 'long_term_memory.json');
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                this.longTermMemory = JSON.parse(data);
            } catch (error) {
                console.error('Failed to load long-term memory:', error);
                this.longTermMemory = [];
            }
        }
    }

    /**
     * Get memory statistics
     */
    getStats(): object {
        return {
            shortTermCount: this.shortTermMemory.length,
            longTermCount: this.longTermMemory.length,
            conversationSessions: this.conversationHistory.size,
            highQualityCount: this.getHighQualityMemories().length,
            feedbackCount: this.longTermMemory.filter(m => m.type === 'feedback').length
        };
    }
}
