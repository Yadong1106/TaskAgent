import * as vscode from 'vscode';
import { AgentRegistry, AgentConfig } from './agentRegistry';

/**
 * Vote from an agent
 */
export interface AgentVote {
    agentId: string;
    agentName: string;
    response: string;
    confidence: number;  // 0-1 scale
    keyPoints: string[];
    timestamp: Date;
}

/**
 * Consensus result after voting
 */
export interface ConsensusResult {
    topic: string;
    votes: AgentVote[];
    consensusResponse: string;
    agreementLevel: number;  // 0-1 scale
    keyInsights: string[];
    dissenting: string[];  // Points where agents disagreed
    recommendation: string;
}

/**
 * Configuration for consensus voting
 */
export interface ConsensusConfig {
    minAgents: number;       // Minimum agents required
    maxAgents: number;       // Maximum agents to poll
    weightByConfidence: boolean;  // Weight votes by confidence
    requireMajority: boolean;     // Require majority agreement
}

/**
 * ConsensusEngine - Multi-agent voting and consensus mechanism
 * Inspired by CAMEL's multi-agent collaboration patterns
 */
export class ConsensusEngine {
    private defaultConfig: ConsensusConfig = {
        minAgents: 2,
        maxAgents: 5,
        weightByConfidence: true,
        requireMajority: true
    };

    constructor(
        private agentRegistry: AgentRegistry
    ) {}

    /**
     * Gather votes from multiple agents on a topic
     */
    async gatherVotes(
        topic: string,
        agentIds: string[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        context?: string
    ): Promise<AgentVote[]> {
        const votes: AgentVote[] = [];

        // Execute agent queries in parallel
        const votePromises = agentIds.map(async (agentId) => {
            const agent = this.agentRegistry.getAgent(agentId);
            if (!agent) return null;

            try {
                const vote = await this.getAgentVote(agent, topic, model, token, context);
                return vote;
            } catch (error) {
                console.error(`Agent ${agentId} failed to vote:`, error);
                return null;
            }
        });

        const results = await Promise.all(votePromises);

        for (const result of results) {
            if (result) {
                votes.push(result);
            }
        }

        return votes;
    }

    /**
     * Get a single agent's vote
     */
    private async getAgentVote(
        agent: AgentConfig,
        topic: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        context?: string
    ): Promise<AgentVote> {
        const prompt = `You are ${agent.name}. ${agent.systemPrompt}

Analyze the following topic and provide your expert opinion.

Topic: "${topic}"
${context ? `\nContext:\n${context}` : ''}

Respond in this exact JSON format:
{
    "response": "Your detailed analysis and opinion",
    "confidence": 0.8,
    "keyPoints": ["point 1", "point 2", "point 3"]
}

The confidence should be between 0 and 1, where 1 means you are very confident in your analysis.
Only output valid JSON.`;

        const messages = [
            vscode.LanguageModelChatMessage.User(prompt)
        ];

        const response = await model.sendRequest(messages, {}, token);
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }

        // Parse JSON response
        try {
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    agentId: agent.id,
                    agentName: agent.name,
                    response: parsed.response || fullResponse,
                    confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
                    keyPoints: parsed.keyPoints || [],
                    timestamp: new Date()
                };
            }
        } catch (e) {
            // If JSON parsing fails, use raw response
        }

        return {
            agentId: agent.id,
            agentName: agent.name,
            response: fullResponse,
            confidence: 0.5,
            keyPoints: [],
            timestamp: new Date()
        };
    }

    /**
     * Build consensus from collected votes
     */
    async buildConsensus(
        topic: string,
        votes: AgentVote[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        config?: Partial<ConsensusConfig>
    ): Promise<ConsensusResult> {
        const finalConfig = { ...this.defaultConfig, ...config };

        if (votes.length < finalConfig.minAgents) {
            throw new Error(`Not enough votes. Got ${votes.length}, need at least ${finalConfig.minAgents}`);
        }

        // Format votes for synthesis
        const voteSummary = votes.map(v =>
            `**${v.agentName}** (Confidence: ${(v.confidence * 100).toFixed(0)}%):\n${v.response}\nKey Points: ${v.keyPoints.join(', ')}`
        ).join('\n\n---\n\n');

        const synthesisPrompt = `You are a consensus synthesizer. Multiple expert agents have provided their opinions on a topic. Your job is to:
1. Identify areas of agreement
2. Note any significant disagreements
3. Synthesize a balanced consensus response
4. Provide actionable recommendations

Topic: "${topic}"

Agent Votes:
${voteSummary}

Respond in this exact JSON format:
{
    "consensusResponse": "The synthesized consensus opinion",
    "agreementLevel": 0.85,
    "keyInsights": ["insight 1", "insight 2"],
    "dissenting": ["area of disagreement 1"],
    "recommendation": "Final actionable recommendation"
}

agreementLevel should be 0-1 indicating how much the agents agreed.
Only output valid JSON.`;

        const messages = [
            vscode.LanguageModelChatMessage.User(synthesisPrompt)
        ];

        const response = await model.sendRequest(messages, {}, token);
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }

        // Parse consensus result
        try {
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    topic,
                    votes,
                    consensusResponse: parsed.consensusResponse || fullResponse,
                    agreementLevel: Math.min(1, Math.max(0, parsed.agreementLevel || 0.5)),
                    keyInsights: parsed.keyInsights || [],
                    dissenting: parsed.dissenting || [],
                    recommendation: parsed.recommendation || ''
                };
            }
        } catch (e) {
            // If JSON parsing fails, create basic result
        }

        return {
            topic,
            votes,
            consensusResponse: fullResponse,
            agreementLevel: this.calculateAgreementLevel(votes),
            keyInsights: this.extractCommonPoints(votes),
            dissenting: [],
            recommendation: 'Please review individual agent opinions for detailed analysis.'
        };
    }

    /**
     * Run full consensus process: gather votes + build consensus
     */
    async runConsensus(
        topic: string,
        agentIds: string[],
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
        context?: string,
        config?: Partial<ConsensusConfig>
    ): Promise<ConsensusResult> {
        stream.markdown(`## 🗳️ Multi-Agent Consensus\n\n`);
        stream.markdown(`**Topic:** ${topic}\n\n`);
        stream.markdown(`**Participating Agents:** ${agentIds.length}\n\n`);
        stream.markdown(`---\n\n`);

        // Gather votes
        stream.progress('Gathering agent opinions...');
        const votes = await this.gatherVotes(topic, agentIds, model, token, context);

        // Display individual votes
        stream.markdown(`### 📊 Individual Agent Opinions\n\n`);
        for (const vote of votes) {
            const confidenceBar = this.renderConfidenceBar(vote.confidence);
            stream.markdown(`#### ${vote.agentName}\n`);
            stream.markdown(`**Confidence:** ${confidenceBar} ${(vote.confidence * 100).toFixed(0)}%\n\n`);
            stream.markdown(`${vote.response}\n\n`);
            if (vote.keyPoints.length > 0) {
                stream.markdown(`**Key Points:**\n`);
                vote.keyPoints.forEach(point => stream.markdown(`- ${point}\n`));
            }
            stream.markdown(`\n---\n\n`);
        }

        // Build consensus
        stream.progress('Synthesizing consensus...');
        const consensus = await this.buildConsensus(topic, votes, model, token, config);

        // Display consensus result
        stream.markdown(`### 🤝 Consensus Result\n\n`);

        const agreementBar = this.renderConfidenceBar(consensus.agreementLevel);
        stream.markdown(`**Agreement Level:** ${agreementBar} ${(consensus.agreementLevel * 100).toFixed(0)}%\n\n`);

        stream.markdown(`**Synthesized Opinion:**\n${consensus.consensusResponse}\n\n`);

        if (consensus.keyInsights.length > 0) {
            stream.markdown(`**Key Insights:**\n`);
            consensus.keyInsights.forEach(insight => stream.markdown(`- ${insight}\n`));
            stream.markdown(`\n`);
        }

        if (consensus.dissenting.length > 0) {
            stream.markdown(`**Areas of Disagreement:**\n`);
            consensus.dissenting.forEach(point => stream.markdown(`- ⚠️ ${point}\n`));
            stream.markdown(`\n`);
        }

        if (consensus.recommendation) {
            stream.markdown(`**Recommendation:**\n> ${consensus.recommendation}\n\n`);
        }

        return consensus;
    }

    /**
     * Calculate agreement level from votes
     */
    private calculateAgreementLevel(votes: AgentVote[]): number {
        if (votes.length < 2) return 1;

        // Simple calculation based on confidence spread
        const confidences = votes.map(v => v.confidence);
        const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
        const variance = confidences.reduce((sum, c) => sum + Math.pow(c - avgConfidence, 2), 0) / confidences.length;

        // Lower variance = higher agreement
        return Math.max(0, 1 - Math.sqrt(variance));
    }

    /**
     * Extract common key points from votes
     */
    private extractCommonPoints(votes: AgentVote[]): string[] {
        const allPoints = votes.flatMap(v => v.keyPoints);
        const pointCounts = new Map<string, number>();

        allPoints.forEach(point => {
            const lower = point.toLowerCase();
            pointCounts.set(lower, (pointCounts.get(lower) || 0) + 1);
        });

        // Return points mentioned by multiple agents
        return Array.from(pointCounts.entries())
            .filter(([_, count]) => count > 1)
            .map(([point, _]) => point);
    }

    /**
     * Render a visual confidence bar
     */
    private renderConfidenceBar(value: number): string {
        const filled = Math.round(value * 10);
        const empty = 10 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
    }

    /**
     * Get recommended agents for a topic
     */
    getRecommendedAgents(topic: string): string[] {
        const topicLower = topic.toLowerCase();
        const recommended: string[] = [];

        // Always include developer for code-related topics
        if (topicLower.includes('code') || topicLower.includes('implement') ||
            topicLower.includes('bug') || topicLower.includes('function')) {
            recommended.push('developer');
        }

        // Security for security-related topics
        if (topicLower.includes('security') || topicLower.includes('vulnerability') ||
            topicLower.includes('safe') || topicLower.includes('attack')) {
            recommended.push('security');
        }

        // Code review for quality-related topics
        if (topicLower.includes('review') || topicLower.includes('quality') ||
            topicLower.includes('best practice') || topicLower.includes('improve')) {
            recommended.push('codereview');
        }

        // Financial for market/investment topics
        if (topicLower.includes('stock') || topicLower.includes('invest') ||
            topicLower.includes('market') || topicLower.includes('finance')) {
            recommended.push('financial');
        }

        // Search agent for research topics
        if (topicLower.includes('research') || topicLower.includes('find') ||
            topicLower.includes('compare') || topicLower.includes('analyze')) {
            recommended.push('search');
        }

        // If no specific matches, use general agents
        if (recommended.length === 0) {
            recommended.push('developer', 'search', 'document');
        }

        // Ensure at least 2 agents
        if (recommended.length < 2) {
            if (!recommended.includes('developer')) recommended.push('developer');
            if (!recommended.includes('search')) recommended.push('search');
        }

        return recommended.slice(0, 5);  // Max 5 agents
    }
}
