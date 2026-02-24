import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EmbeddingService, SimilarityResult } from './embedding';

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
    embedding?: number[];  // For semantic search
}

/**
 * Semantic Search Result
 */
export interface SemanticSearchResult {
    memory: MemoryEntry;
    similarity: number;
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
 * - Semantic retrieval with embeddings
 * - Feedback collection for learning
 */
export class MemoryModule {
    private shortTermMemory: MemoryEntry[] = [];
    private longTermMemory: MemoryEntry[] = [];
    private conversationHistory: Map<string, ConversationTurn[]> = new Map();
    private storagePath: string;
    private maxShortTermSize: number = 100;
    private maxLongTermSize: number = 1000;
    private embeddingService: EmbeddingService;
    private embeddingsEnabled: boolean = true;

    constructor(context: vscode.ExtensionContext, embeddingService?: EmbeddingService) {
        this.storagePath = path.join(context.globalStorageUri.fsPath, 'memory');
        this.embeddingService = embeddingService || new EmbeddingService();
        this.ensureStorageExists();
        this.loadLongTermMemory();
        this.loadEmbeddingCache();
    }

    /**
     * Enable or disable embedding generation
     */
    setEmbeddingsEnabled(enabled: boolean) {
        this.embeddingsEnabled = enabled;
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
    async addMemory(
        type: MemoryEntry['type'],
        content: string,
        metadata: MemoryEntry['metadata'] = {}
    ): Promise<MemoryEntry> {
        const entry: MemoryEntry = {
            id: this.generateId(),
            timestamp: Date.now(),
            type,
            content,
            metadata
        };

        // Generate embedding if enabled
        if (this.embeddingsEnabled) {
            try {
                entry.embedding = await this.embeddingService.generateEmbedding(content);
                // Update IDF scores for better local embeddings
                this.embeddingService.updateIdfScores(content);
            } catch (error) {
                console.warn('Failed to generate embedding:', error);
            }
        }

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
     * Add memory synchronously (without embedding)
     */
    addMemorySync(
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
     * Semantic search using embeddings
     * Finds memories that are semantically similar to the query
     */
    async semanticSearch(
        query: string,
        options: {
            type?: MemoryEntry['type'];
            limit?: number;
            threshold?: number;
            includeShortTerm?: boolean;
            includeLongTerm?: boolean;
        } = {}
    ): Promise<SemanticSearchResult[]> {
        const {
            type,
            limit = 10,
            threshold = 0.3,
            includeShortTerm = true,
            includeLongTerm = true
        } = options;

        // Collect memories to search
        let memories: MemoryEntry[] = [];
        if (includeShortTerm) memories.push(...this.shortTermMemory);
        if (includeLongTerm) memories.push(...this.longTermMemory);

        // Filter by type if specified
        if (type) {
            memories = memories.filter(m => m.type === type);
        }

        // Filter to only memories with embeddings
        const memoriesWithEmbeddings = memories.filter(m => m.embedding && m.embedding.length > 0);

        if (memoriesWithEmbeddings.length === 0) {
            // Fallback to text search if no embeddings
            console.log('SemanticSearch: No embeddings found, falling back to text search');
            return this.searchMemories(query, type, limit).map(m => ({
                memory: m,
                similarity: 0.5  // Default similarity for text match
            }));
        }

        // Generate query embedding
        const queryEmbedding = await this.embeddingService.generateEmbedding(query);

        // Find similar memories
        const results = this.embeddingService.findMostSimilar(
            queryEmbedding,
            memoriesWithEmbeddings.map(m => ({ item: m, embedding: m.embedding! })),
            limit,
            threshold
        );

        return results.map(r => ({
            memory: r.item,
            similarity: r.similarity
        }));
    }

    /**
     * Find related memories to a given memory
     */
    async findRelatedMemories(
        memoryId: string,
        limit: number = 5
    ): Promise<SemanticSearchResult[]> {
        // Find the source memory
        const allMemories = [...this.shortTermMemory, ...this.longTermMemory];
        const sourceMemory = allMemories.find(m => m.id === memoryId);

        if (!sourceMemory) {
            return [];
        }

        // If source has embedding, use it directly
        if (sourceMemory.embedding && sourceMemory.embedding.length > 0) {
            const memoriesWithEmbeddings = allMemories
                .filter(m => m.id !== memoryId && m.embedding && m.embedding.length > 0);

            const results = this.embeddingService.findMostSimilar(
                sourceMemory.embedding,
                memoriesWithEmbeddings.map(m => ({ item: m, embedding: m.embedding! })),
                limit,
                0.3
            );

            return results.map(r => ({
                memory: r.item,
                similarity: r.similarity
            }));
        }

        // Fallback to content-based search
        return this.semanticSearch(sourceMemory.content, { limit });
    }

    /**
     * Generate embeddings for all memories that don't have them
     */
    async generateMissingEmbeddings(): Promise<number> {
        const allMemories = [...this.shortTermMemory, ...this.longTermMemory];
        const memoriesWithoutEmbeddings = allMemories.filter(
            m => !m.embedding || m.embedding.length === 0
        );

        let count = 0;
        for (const memory of memoriesWithoutEmbeddings) {
            try {
                memory.embedding = await this.embeddingService.generateEmbedding(memory.content);
                count++;
            } catch (error) {
                console.warn(`Failed to generate embedding for memory ${memory.id}:`, error);
            }
        }

        // Save updated memories
        this.saveLongTermMemory();
        this.saveEmbeddingCache();

        return count;
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
        const allMemories = [...this.shortTermMemory, ...this.longTermMemory];
        const memoriesWithEmbeddings = allMemories.filter(m => m.embedding && m.embedding.length > 0);
        
        return {
            shortTermCount: this.shortTermMemory.length,
            longTermCount: this.longTermMemory.length,
            conversationSessions: this.conversationHistory.size,
            highQualityCount: this.getHighQualityMemories().length,
            feedbackCount: this.longTermMemory.filter(m => m.type === 'feedback').length,
            embeddingStats: {
                totalWithEmbeddings: memoriesWithEmbeddings.length,
                percentageWithEmbeddings: allMemories.length > 0 
                    ? Math.round((memoriesWithEmbeddings.length / allMemories.length) * 100)
                    : 0,
                cacheStats: this.embeddingService.getCacheStats()
            }
        };
    }

    /**
     * Save embedding cache to disk
     */
    private saveEmbeddingCache() {
        const filePath = path.join(this.storagePath, 'embedding_cache.json');
        const cacheData = this.embeddingService.exportCache();
        fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2));
    }

    /**
     * Load embedding cache from disk
     */
    private loadEmbeddingCache() {
        const filePath = path.join(this.storagePath, 'embedding_cache.json');
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                const cacheData = JSON.parse(data);
                this.embeddingService.importCache(cacheData);
                console.log(`Loaded ${cacheData.length} cached embeddings`);
            } catch (error) {
                console.error('Failed to load embedding cache:', error);
            }
        }
    }

    /**
     * Get the embedding service instance
     */
    getEmbeddingService(): EmbeddingService {
        return this.embeddingService;
    }
}
