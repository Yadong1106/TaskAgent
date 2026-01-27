import * as vscode from 'vscode';
import { MemoryModule } from './memory';
import { DataGenerator } from './dataGenerator';

/**
 * Feedback Record - User feedback on agent responses
 */
export interface FeedbackRecord {
    id: string;
    taskId: string;
    responseId: string;
    rating: 1 | 2 | 3 | 4 | 5;
    feedback: string;
    improvements?: string;
    timestamp: number;
}

/**
 * Learning Insight - Patterns learned from feedback
 */
export interface LearningInsight {
    pattern: string;
    frequency: number;
    examples: string[];
    improvement: string;
}

/**
 * FeedbackCollector - Collect and learn from user feedback
 * Inspired by CAMEL's RLHF approach
 * 
 * Features:
 * - Collect thumbs up/down feedback
 * - Detailed feedback with ratings
 * - Identify improvement patterns
 * - Generate learning insights
 */
export class FeedbackCollector {
    private feedbackRecords: FeedbackRecord[] = [];
    private learningInsights: LearningInsight[] = [];

    constructor(
        private memoryModule: MemoryModule,
        private dataGenerator: DataGenerator
    ) {}

    private generateId(): string {
        return `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Record simple feedback (thumbs up/down)
     */
    recordQuickFeedback(
        taskId: string,
        responseId: string,
        isPositive: boolean
    ) {
        const rating = isPositive ? 5 : 1;
        this.recordDetailedFeedback(taskId, responseId, rating, 
            isPositive ? 'Good response' : 'Poor response');
    }

    /**
     * Record detailed feedback with rating
     */
    recordDetailedFeedback(
        taskId: string,
        responseId: string,
        rating: 1 | 2 | 3 | 4 | 5,
        feedback: string,
        improvements?: string
    ): FeedbackRecord {
        const record: FeedbackRecord = {
            id: this.generateId(),
            taskId,
            responseId,
            rating,
            feedback,
            improvements,
            timestamp: Date.now()
        };

        this.feedbackRecords.push(record);

        // Also record in memory module
        this.memoryModule.recordFeedback(taskId, rating, feedback, ['user_feedback']);

        // If high quality, add to training data
        if (rating >= 4) {
            this.dataGenerator.addExample(
                'Respond to the user request',
                taskId,
                feedback,
                rating,
                'feedback',
                { tags: ['positive_feedback'] }
            );
        }

        return record;
    }

    /**
     * Show feedback prompt to user
     */
    async promptForFeedback(
        taskId: string,
        responseId: string
    ): Promise<FeedbackRecord | undefined> {
        // Quick feedback first
        const quickChoice = await vscode.window.showInformationMessage(
            'Was this response helpful?',
            'Yes 👍',
            'No 👎',
            'Provide Details'
        );

        if (quickChoice === 'Yes 👍') {
            return this.recordDetailedFeedback(taskId, responseId, 5, 'Helpful response');
        } else if (quickChoice === 'No 👎') {
            return this.recordDetailedFeedback(taskId, responseId, 1, 'Not helpful');
        } else if (quickChoice === 'Provide Details') {
            // Detailed feedback
            const rating = await vscode.window.showQuickPick(
                ['⭐⭐⭐⭐⭐ Excellent (5)', '⭐⭐⭐⭐ Good (4)', '⭐⭐⭐ Average (3)', '⭐⭐ Poor (2)', '⭐ Very Poor (1)'],
                { placeHolder: 'Rate this response' }
            );

            if (!rating) return undefined;

            const ratingValue = parseInt(rating.match(/\((\d)\)/)?.[1] || '3') as 1 | 2 | 3 | 4 | 5;

            const feedback = await vscode.window.showInputBox({
                prompt: 'What did you think of this response?',
                placeHolder: 'Your feedback...'
            });

            if (!feedback) return undefined;

            let improvements: string | undefined;
            if (ratingValue < 4) {
                improvements = await vscode.window.showInputBox({
                    prompt: 'How could this response be improved?',
                    placeHolder: 'Suggestions for improvement...'
                });
            }

            return this.recordDetailedFeedback(taskId, responseId, ratingValue, feedback, improvements);
        }

        return undefined;
    }

    /**
     * Analyze feedback to find improvement patterns
     */
    analyzeFeedback(): LearningInsight[] {
        const negativeRecords = this.feedbackRecords.filter(r => r.rating <= 2);
        const patterns: Map<string, { count: number; examples: string[]; improvement: string }> = new Map();

        // Simple pattern detection based on keywords
        const patternKeywords = [
            { pattern: 'too_long', keywords: ['long', 'verbose', 'too much', 'shorter'] },
            { pattern: 'too_short', keywords: ['short', 'brief', 'more detail', 'elaborate'] },
            { pattern: 'incorrect', keywords: ['wrong', 'incorrect', 'error', 'mistake'] },
            { pattern: 'unclear', keywords: ['unclear', 'confusing', 'understand', 'explain'] },
            { pattern: 'off_topic', keywords: ['relevant', 'topic', 'not what I asked', 'different'] },
            { pattern: 'missing_info', keywords: ['missing', 'forgot', 'include', 'left out'] }
        ];

        for (const record of negativeRecords) {
            const feedbackLower = (record.feedback + ' ' + (record.improvements || '')).toLowerCase();
            
            for (const { pattern, keywords } of patternKeywords) {
                if (keywords.some(kw => feedbackLower.includes(kw))) {
                    if (!patterns.has(pattern)) {
                        patterns.set(pattern, { count: 0, examples: [], improvement: '' });
                    }
                    const p = patterns.get(pattern)!;
                    p.count++;
                    p.examples.push(record.feedback);
                    if (record.improvements) {
                        p.improvement = record.improvements;
                    }
                }
            }
        }

        this.learningInsights = Array.from(patterns.entries()).map(([pattern, data]) => ({
            pattern,
            frequency: data.count,
            examples: data.examples.slice(0, 3),
            improvement: data.improvement || this.getDefaultImprovement(pattern)
        }));

        return this.learningInsights;
    }

    /**
     * Get default improvement suggestion for a pattern
     */
    private getDefaultImprovement(pattern: string): string {
        const improvements: Record<string, string> = {
            'too_long': 'Be more concise and focus on key points',
            'too_short': 'Provide more detailed explanations and examples',
            'incorrect': 'Verify information before responding',
            'unclear': 'Use clearer language and structure responses better',
            'off_topic': 'Focus on the specific question asked',
            'missing_info': 'Ensure all relevant aspects are covered'
        };
        return improvements[pattern] || 'Improve response quality';
    }

    /**
     * Generate a learning prompt based on feedback
     */
    generateLearningPrompt(): string {
        if (this.learningInsights.length === 0) {
            this.analyzeFeedback();
        }

        if (this.learningInsights.length === 0) {
            return '';
        }

        return `Based on user feedback, please improve your responses by:
${this.learningInsights
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 3)
    .map((insight, i) => `${i + 1}. ${insight.improvement} (reported ${insight.frequency} times)`)
    .join('\n')}`;
    }

    /**
     * Get feedback statistics
     */
    getStats(): object {
        const total = this.feedbackRecords.length;
        const avgRating = total > 0 
            ? this.feedbackRecords.reduce((sum, r) => sum + r.rating, 0) / total 
            : 0;

        const ratingDistribution: Record<number, number> = {};
        for (const record of this.feedbackRecords) {
            ratingDistribution[record.rating] = (ratingDistribution[record.rating] || 0) + 1;
        }

        return {
            totalFeedback: total,
            averageRating: avgRating.toFixed(2),
            ratingDistribution,
            positiveRate: total > 0 
                ? ((this.feedbackRecords.filter(r => r.rating >= 4).length / total) * 100).toFixed(1) + '%'
                : '0%',
            topIssues: this.learningInsights.slice(0, 3).map(i => i.pattern)
        };
    }

    /**
     * Export feedback for analysis
     */
    exportFeedback(): FeedbackRecord[] {
        return [...this.feedbackRecords];
    }
}
