import * as vscode from 'vscode';
import { AgentRegistry, AgentConfig } from './agentRegistry';

/**
 * Reflection feedback from critic
 */
export interface ReflectionFeedback {
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    overallScore: number;  // 0-10
    requiresRevision: boolean;
}

/**
 * A single reflection iteration
 */
export interface ReflectionIteration {
    iteration: number;
    response: string;
    feedback: ReflectionFeedback | null;
    improvedResponse: string | null;
    timestamp: Date;
}

/**
 * Result of the self-reflection process
 */
export interface SelfReflectionResult {
    originalTask: string;
    iterations: ReflectionIteration[];
    finalResponse: string;
    totalIterations: number;
    improvementSummary: string;
}

/**
 * Configuration for self-reflection
 */
export interface ReflectionConfig {
    maxIterations: number;      // Maximum reflection loops
    minScore: number;           // Minimum acceptable score (0-10)
    criticAgent: string;        // Agent ID for critic role
    executorAgent: string;      // Agent ID for task execution
}

/**
 * SelfReflectionEngine - Agent self-critique and improvement
 * Implements the reflection pattern from CAMEL and other frameworks
 */
export class SelfReflectionEngine {
    private defaultConfig: ReflectionConfig = {
        maxIterations: 3,
        minScore: 7,
        criticAgent: 'codereview',
        executorAgent: 'developer'
    };

    constructor(
        private agentRegistry: AgentRegistry
    ) {}

    /**
     * Execute task with self-reflection loop
     */
    async executeWithReflection(
        task: string,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken,
        config?: Partial<ReflectionConfig>,
        context?: string
    ): Promise<SelfReflectionResult> {
        const finalConfig = { ...this.defaultConfig, ...config };
        const iterations: ReflectionIteration[] = [];
        let currentResponse = '';

        stream.markdown(`## 🔄 Self-Reflection Process\n\n`);
        stream.markdown(`**Task:** ${task}\n\n`);
        stream.markdown(`**Max Iterations:** ${finalConfig.maxIterations}\n`);
        stream.markdown(`**Target Score:** ${finalConfig.minScore}/10\n\n`);
        stream.markdown(`---\n\n`);

        // Initial execution
        stream.markdown(`### Iteration 1: Initial Response\n\n`);
        stream.progress('Generating initial response...');

        currentResponse = await this.executeTask(
            task,
            finalConfig.executorAgent,
            model,
            token,
            context
        );

        stream.markdown(currentResponse);
        stream.markdown(`\n\n`);

        iterations.push({
            iteration: 1,
            response: currentResponse,
            feedback: null,
            improvedResponse: null,
            timestamp: new Date()
        });

        // Reflection loop
        for (let i = 2; i <= finalConfig.maxIterations; i++) {
            if (token.isCancellationRequested) break;

            stream.markdown(`---\n\n`);
            stream.markdown(`### Iteration ${i}: Critique & Improvement\n\n`);

            // Get critique
            stream.progress('Getting critique...');
            const feedback = await this.getCritique(
                task,
                currentResponse,
                finalConfig.criticAgent,
                model,
                token
            );

            // Display feedback
            stream.markdown(`#### 📝 Critic Feedback\n\n`);
            stream.markdown(`**Score:** ${feedback.overallScore}/10 ${this.renderScoreEmoji(feedback.overallScore)}\n\n`);

            if (feedback.strengths.length > 0) {
                stream.markdown(`**Strengths:**\n`);
                feedback.strengths.forEach(s => stream.markdown(`- ✅ ${s}\n`));
                stream.markdown(`\n`);
            }

            if (feedback.weaknesses.length > 0) {
                stream.markdown(`**Weaknesses:**\n`);
                feedback.weaknesses.forEach(w => stream.markdown(`- ❌ ${w}\n`));
                stream.markdown(`\n`);
            }

            if (feedback.suggestions.length > 0) {
                stream.markdown(`**Suggestions:**\n`);
                feedback.suggestions.forEach(s => stream.markdown(`- 💡 ${s}\n`));
                stream.markdown(`\n`);
            }

            // Check if we've reached acceptable quality
            if (!feedback.requiresRevision || feedback.overallScore >= finalConfig.minScore) {
                stream.markdown(`\n✅ **Quality threshold reached!** No further iterations needed.\n\n`);
                iterations[iterations.length - 1].feedback = feedback;
                break;
            }

            // Generate improved response
            stream.progress('Generating improved response...');
            const improvedResponse = await this.improveResponse(
                task,
                currentResponse,
                feedback,
                finalConfig.executorAgent,
                model,
                token
            );

            stream.markdown(`#### 🔧 Improved Response\n\n`);
            stream.markdown(improvedResponse);
            stream.markdown(`\n\n`);

            iterations.push({
                iteration: i,
                response: currentResponse,
                feedback,
                improvedResponse,
                timestamp: new Date()
            });

            currentResponse = improvedResponse;
        }

        // Generate improvement summary
        const summary = this.generateImprovementSummary(iterations);

        stream.markdown(`---\n\n`);
        stream.markdown(`### 📊 Reflection Summary\n\n`);
        stream.markdown(`**Total Iterations:** ${iterations.length}\n`);
        stream.markdown(`**Final Response Quality:** ${this.getLatestScore(iterations)}/10\n\n`);
        stream.markdown(`**Improvement Summary:**\n${summary}\n\n`);

        return {
            originalTask: task,
            iterations,
            finalResponse: currentResponse,
            totalIterations: iterations.length,
            improvementSummary: summary
        };
    }

    /**
     * Execute the task using specified agent
     */
    private async executeTask(
        task: string,
        agentId: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        context?: string
    ): Promise<string> {
        const agent = this.agentRegistry.getAgent(agentId);
        const systemPrompt = agent?.systemPrompt || 'You are a helpful assistant.';

        const prompt = `${systemPrompt}

Task: ${task}
${context ? `\nContext:\n${context}` : ''}

Please complete this task to the best of your ability. Provide a thorough and well-structured response.`;

        const messages = [
            vscode.LanguageModelChatMessage.User(prompt)
        ];

        const response = await model.sendRequest(messages, {}, token);
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }

        return fullResponse;
    }

    /**
     * Get critique from critic agent
     */
    private async getCritique(
        task: string,
        response: string,
        criticAgentId: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<ReflectionFeedback> {
        const agent = this.agentRegistry.getAgent(criticAgentId);
        const systemPrompt = agent?.systemPrompt || 'You are an expert code reviewer and critic.';

        const prompt = `${systemPrompt}

You are reviewing the following response to a task. Provide constructive feedback.

**Original Task:** ${task}

**Response to Review:**
${response}

Analyze this response and provide feedback in the following JSON format:
{
    "strengths": ["strength 1", "strength 2"],
    "weaknesses": ["weakness 1", "weakness 2"],
    "suggestions": ["suggestion for improvement 1", "suggestion 2"],
    "overallScore": 7,
    "requiresRevision": true
}

- overallScore should be 0-10 (10 being perfect)
- requiresRevision should be true if the response needs significant improvement
- Be specific and actionable in your feedback

Only output valid JSON.`;

        const messages = [
            vscode.LanguageModelChatMessage.User(prompt)
        ];

        const critResponse = await model.sendRequest(messages, {}, token);
        let fullResponse = '';
        for await (const chunk of critResponse.text) {
            fullResponse += chunk;
        }

        // Parse feedback
        try {
            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    strengths: parsed.strengths || [],
                    weaknesses: parsed.weaknesses || [],
                    suggestions: parsed.suggestions || [],
                    overallScore: Math.min(10, Math.max(0, parsed.overallScore || 5)),
                    requiresRevision: parsed.requiresRevision !== false
                };
            }
        } catch (e) {
            // Default feedback if parsing fails
        }

        return {
            strengths: [],
            weaknesses: ['Unable to parse critique'],
            suggestions: ['Please try again'],
            overallScore: 5,
            requiresRevision: true
        };
    }

    /**
     * Generate improved response based on feedback
     */
    private async improveResponse(
        task: string,
        previousResponse: string,
        feedback: ReflectionFeedback,
        agentId: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<string> {
        const agent = this.agentRegistry.getAgent(agentId);
        const systemPrompt = agent?.systemPrompt || 'You are a helpful assistant.';

        const feedbackSummary = [
            feedback.weaknesses.length > 0 ? `Weaknesses to address: ${feedback.weaknesses.join('; ')}` : '',
            feedback.suggestions.length > 0 ? `Suggestions: ${feedback.suggestions.join('; ')}` : ''
        ].filter(Boolean).join('\n');

        const prompt = `${systemPrompt}

You previously provided a response that needs improvement. Based on the feedback below, please provide an improved response.

**Original Task:** ${task}

**Your Previous Response:**
${previousResponse}

**Feedback:**
${feedbackSummary}

Please provide an improved response that addresses the feedback while maintaining the strengths of your original response. Focus on the specific improvements suggested.`;

        const messages = [
            vscode.LanguageModelChatMessage.User(prompt)
        ];

        const response = await model.sendRequest(messages, {}, token);
        let fullResponse = '';
        for await (const chunk of response.text) {
            fullResponse += chunk;
        }

        return fullResponse;
    }

    /**
     * Generate summary of improvements across iterations
     */
    private generateImprovementSummary(iterations: ReflectionIteration[]): string {
        if (iterations.length === 1) {
            return 'Single iteration - no improvements needed.';
        }

        const allWeaknesses = iterations
            .filter(i => i.feedback)
            .flatMap(i => i.feedback!.weaknesses);

        const allSuggestions = iterations
            .filter(i => i.feedback)
            .flatMap(i => i.feedback!.suggestions);

        const scoreProgression = iterations
            .filter(i => i.feedback)
            .map(i => i.feedback!.overallScore);

        let summary = '';

        if (scoreProgression.length > 0) {
            const firstScore = scoreProgression[0];
            const lastScore = scoreProgression[scoreProgression.length - 1];
            const improvement = lastScore - firstScore;

            if (improvement > 0) {
                summary += `Score improved from ${firstScore}/10 to ${lastScore}/10 (+${improvement} points). `;
            } else if (improvement === 0) {
                summary += `Score remained stable at ${lastScore}/10. `;
            }
        }

        if (allWeaknesses.length > 0) {
            summary += `Addressed ${allWeaknesses.length} identified weaknesses. `;
        }

        if (allSuggestions.length > 0) {
            summary += `Incorporated ${allSuggestions.length} improvement suggestions.`;
        }

        return summary || 'Response refined through self-reflection.';
    }

    /**
     * Get the latest score from iterations
     */
    private getLatestScore(iterations: ReflectionIteration[]): number {
        for (let i = iterations.length - 1; i >= 0; i--) {
            if (iterations[i].feedback) {
                return iterations[i].feedback!.overallScore;
            }
        }
        return 5;  // Default score
    }

    /**
     * Render emoji based on score
     */
    private renderScoreEmoji(score: number): string {
        if (score >= 9) return '🌟';
        if (score >= 7) return '✅';
        if (score >= 5) return '⚠️';
        return '❌';
    }

    /**
     * Quick reflection for simple tasks (single critique)
     */
    async quickReflect(
        task: string,
        response: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<ReflectionFeedback> {
        return await this.getCritique(
            task,
            response,
            this.defaultConfig.criticAgent,
            model,
            token
        );
    }
}
