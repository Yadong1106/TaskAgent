import * as vscode from 'vscode';

/**
 * Embedding Result
 */
export interface EmbeddingResult {
    text: string;
    embedding: number[];
    model?: string;
    timestamp: number;
}

/**
 * Similarity Result for semantic search
 */
export interface SimilarityResult<T> {
    item: T;
    similarity: number;
    embedding: number[];
}

/**
 * Embedding Service Configuration
 */
export interface EmbeddingConfig {
    /** Use local computation as fallback */
    useLocalFallback: boolean;
    /** Cache embeddings to disk */
    cacheEmbeddings: boolean;
    /** Embedding dimension for local computation */
    localDimension: number;
    /** Batch size for embedding generation */
    batchSize: number;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
    useLocalFallback: true,
    cacheEmbeddings: true,
    localDimension: 384,  // Common dimension for small models
    batchSize: 10
};

/**
 * EmbeddingService - Generate and manage text embeddings
 * 
 * Supports:
 * - VS Code Language Model API (when available)
 * - Local TF-IDF based fallback
 * - Caching for performance
 * - Batch processing
 */
export class EmbeddingService {
    private config: EmbeddingConfig;
    private embeddingCache: Map<string, EmbeddingResult> = new Map();
    private vocabulary: Map<string, number> = new Map();
    private idfScores: Map<string, number> = new Map();
    private documentCount: number = 0;

    constructor(config: Partial<EmbeddingConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Generate embedding for a single text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        // Check cache first
        const cacheKey = this.hashText(text);
        if (this.config.cacheEmbeddings && this.embeddingCache.has(cacheKey)) {
            return this.embeddingCache.get(cacheKey)!.embedding;
        }

        let embedding: number[];

        // Try VS Code Language Model API first
        try {
            embedding = await this.generateWithLMAPI(text);
        } catch (error) {
            // Fallback to local computation
            if (this.config.useLocalFallback) {
                console.log('EmbeddingService: Using local TF-IDF fallback');
                embedding = this.generateLocalEmbedding(text);
            } else {
                throw error;
            }
        }

        // Cache the result
        if (this.config.cacheEmbeddings) {
            this.embeddingCache.set(cacheKey, {
                text: text.slice(0, 100),  // Store truncated text
                embedding,
                timestamp: Date.now()
            });
        }

        return embedding;
    }

    /**
     * Generate embeddings for multiple texts (batch)
     */
    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        
        // Process in batches
        for (let i = 0; i < texts.length; i += this.config.batchSize) {
            const batch = texts.slice(i, i + this.config.batchSize);
            const batchResults = await Promise.all(
                batch.map(text => this.generateEmbedding(text))
            );
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * Generate embedding using VS Code Language Model API
     */
    private async generateWithLMAPI(text: string): Promise<number[]> {
        // Check if embeddings API is available
        const models = await vscode.lm.selectChatModels({
            vendor: 'copilot'
        });

        if (models.length === 0) {
            throw new Error('No language model available for embeddings');
        }

        // Use chat model to generate a semantic representation
        // Note: This is a workaround since direct embedding API may not be available
        const model = models[0];
        
        // Create a prompt that asks the model to create semantic features
        const messages = [
            vscode.LanguageModelChatMessage.User(
                `Generate a semantic fingerprint for the following text. ` +
                `Return only a JSON array of 64 floating point numbers between -1 and 1 ` +
                `that capture the semantic meaning. No explanation.\n\nText: "${text.slice(0, 500)}"`
            )
        ];

        try {
            const response = await model.sendRequest(messages, {});
            let result = '';
            for await (const chunk of response.text) {
                result += chunk;
            }

            // Try to parse the response as JSON array
            const match = result.match(/\[[\d\s,.\-e]+\]/);
            if (match) {
                const embedding = JSON.parse(match[0]) as number[];
                // Normalize to desired dimension
                return this.normalizeEmbedding(embedding, this.config.localDimension);
            }
        } catch (error) {
            console.error('LM API embedding failed:', error);
        }

        // Fallback to local if LM parsing fails
        return this.generateLocalEmbedding(text);
    }

    /**
     * Generate local TF-IDF based embedding
     * This is a fallback when LM API is not available
     */
    private generateLocalEmbedding(text: string): number[] {
        const tokens = this.tokenize(text);
        const tfIdf = this.computeTfIdf(tokens);
        
        // Convert TF-IDF to fixed dimension embedding
        const embedding = new Array(this.config.localDimension).fill(0);
        
        tokens.forEach((token, idx) => {
            const vocabIdx = this.getVocabIndex(token);
            const tfidfScore = tfIdf.get(token) || 0;
            
            // Use hash-based feature mapping
            const featureIdx = this.hashToIndex(token, this.config.localDimension);
            embedding[featureIdx] += tfidfScore;
        });

        // L2 normalize
        return this.l2Normalize(embedding);
    }

    /**
     * Compute cosine similarity between two embeddings
     */
    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) {
            // Pad shorter array
            const maxLen = Math.max(a.length, b.length);
            a = this.padArray(a, maxLen);
            b = this.padArray(b, maxLen);
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        return magnitude === 0 ? 0 : dotProduct / magnitude;
    }

    /**
     * Find most similar items from a list
     */
    findMostSimilar<T>(
        queryEmbedding: number[],
        items: Array<{ item: T; embedding: number[] }>,
        topK: number = 5,
        threshold: number = 0.0
    ): SimilarityResult<T>[] {
        const results: SimilarityResult<T>[] = items.map(({ item, embedding }) => ({
            item,
            embedding,
            similarity: this.cosineSimilarity(queryEmbedding, embedding)
        }));

        return results
            .filter(r => r.similarity >= threshold)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    /**
     * Semantic search: find items similar to a query text
     */
    async semanticSearch<T>(
        query: string,
        items: Array<{ item: T; text: string; embedding?: number[] }>,
        topK: number = 5,
        threshold: number = 0.3
    ): Promise<SimilarityResult<T>[]> {
        // Generate query embedding
        const queryEmbedding = await this.generateEmbedding(query);

        // Generate embeddings for items that don't have them
        const itemsWithEmbeddings = await Promise.all(
            items.map(async ({ item, text, embedding }) => ({
                item,
                embedding: embedding || await this.generateEmbedding(text)
            }))
        );

        return this.findMostSimilar(queryEmbedding, itemsWithEmbeddings, topK, threshold);
    }

    // ===== Helper Methods =====

    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length > 2);
    }

    private computeTfIdf(tokens: string[]): Map<string, number> {
        const tf = new Map<string, number>();
        const totalTokens = tokens.length;

        // Compute term frequency
        tokens.forEach(token => {
            tf.set(token, (tf.get(token) || 0) + 1);
        });

        // Normalize by document length and apply IDF
        const tfIdf = new Map<string, number>();
        tf.forEach((count, token) => {
            const termFreq = count / totalTokens;
            const idf = this.idfScores.get(token) || Math.log(10);  // Default IDF
            tfIdf.set(token, termFreq * idf);
        });

        return tfIdf;
    }

    private getVocabIndex(token: string): number {
        if (!this.vocabulary.has(token)) {
            this.vocabulary.set(token, this.vocabulary.size);
        }
        return this.vocabulary.get(token)!;
    }

    private hashToIndex(token: string, dimension: number): number {
        let hash = 0;
        for (let i = 0; i < token.length; i++) {
            hash = ((hash << 5) - hash) + token.charCodeAt(i);
            hash = hash & hash;  // Convert to 32-bit integer
        }
        return Math.abs(hash) % dimension;
    }

    private hashText(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash = hash & hash;
        }
        return `emb_${hash}`;
    }

    private l2Normalize(vector: number[]): number[] {
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (norm === 0) return vector;
        return vector.map(val => val / norm);
    }

    private normalizeEmbedding(embedding: number[], targetDim: number): number[] {
        if (embedding.length === targetDim) {
            return this.l2Normalize(embedding);
        }

        // Resize embedding to target dimension
        const result = new Array(targetDim).fill(0);
        const scale = embedding.length / targetDim;

        for (let i = 0; i < targetDim; i++) {
            const srcIdx = Math.floor(i * scale);
            result[i] = embedding[srcIdx] || 0;
        }

        return this.l2Normalize(result);
    }

    private padArray(arr: number[], length: number): number[] {
        if (arr.length >= length) return arr;
        return [...arr, ...new Array(length - arr.length).fill(0)];
    }

    /**
     * Update IDF scores with a new document
     */
    updateIdfScores(text: string) {
        this.documentCount++;
        const tokens = new Set(this.tokenize(text));
        
        tokens.forEach(token => {
            const currentDf = (this.idfScores.get(token) || 0) + 1;
            this.idfScores.set(token, Math.log(this.documentCount / currentDf));
        });
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; hitRate?: number } {
        return {
            size: this.embeddingCache.size,
            hitRate: undefined  // Could track hits/misses for this
        };
    }

    /**
     * Clear embedding cache
     */
    clearCache() {
        this.embeddingCache.clear();
    }

    /**
     * Export cache for persistence
     */
    exportCache(): EmbeddingResult[] {
        return Array.from(this.embeddingCache.values());
    }

    /**
     * Import cache from persistence
     */
    importCache(data: EmbeddingResult[]) {
        data.forEach(result => {
            const key = this.hashText(result.text);
            this.embeddingCache.set(key, result);
        });
    }
}

/**
 * Helper function to compute cosine similarity
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    const service = new EmbeddingService();
    return service.cosineSimilarity(a, b);
}
