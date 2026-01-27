import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryModule, MemoryEntry } from './memory';

/**
 * Training Example - A single training data point
 */
export interface TrainingExample {
    id: string;
    instruction: string;
    input: string;
    output: string;
    quality: number;
    source: 'feedback' | 'manual' | 'generated' | 'roleplay';
    metadata: {
        agentId?: string;
        taskType?: string;
        timestamp: number;
        tags?: string[];
    };
}

/**
 * CoT (Chain-of-Thought) Example
 */
export interface CoTExample {
    question: string;
    thinking: string[];  // Step-by-step reasoning
    answer: string;
    quality: number;
}

/**
 * DataGenerator - Generate training data from agent interactions
 * Inspired by CAMEL's datagen module
 * 
 * Features:
 * - Collect high-quality examples from feedback
 * - Generate CoT (Chain-of-Thought) data
 * - Self-Instruct data generation
 * - Export in various formats (Alpaca, ShareGPT, etc.)
 */
export class DataGenerator {
    private examples: TrainingExample[] = [];
    private cotExamples: CoTExample[] = [];
    private storagePath: string;

    constructor(
        private context: vscode.ExtensionContext,
        private memoryModule: MemoryModule
    ) {
        this.storagePath = path.join(context.globalStorageUri.fsPath, 'training_data');
        this.ensureStorageExists();
        this.loadExamples();
    }

    private ensureStorageExists() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    private generateId(): string {
        return `train_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Add a training example manually
     */
    addExample(
        instruction: string,
        input: string,
        output: string,
        quality: number = 3,
        source: TrainingExample['source'] = 'manual',
        metadata: Partial<TrainingExample['metadata']> = {}
    ): TrainingExample {
        const example: TrainingExample = {
            id: this.generateId(),
            instruction,
            input,
            output,
            quality,
            source,
            metadata: {
                timestamp: Date.now(),
                ...metadata
            }
        };

        this.examples.push(example);
        this.saveExamples();
        return example;
    }

    /**
     * Add a CoT example
     */
    addCoTExample(
        question: string,
        thinking: string[],
        answer: string,
        quality: number = 3
    ): CoTExample {
        const example: CoTExample = {
            question,
            thinking,
            answer,
            quality
        };

        this.cotExamples.push(example);
        this.saveExamples();
        return example;
    }

    /**
     * Generate training examples from high-quality feedback
     */
    generateFromFeedback(minQuality: number = 4): TrainingExample[] {
        const highQualityMemories = this.memoryModule.getHighQualityMemories(minQuality);
        const newExamples: TrainingExample[] = [];

        for (const memory of highQualityMemories) {
            if (memory.type === 'task' && memory.metadata.context) {
                const example = this.addExample(
                    'Complete the following task based on the context provided.',
                    memory.metadata.context,
                    memory.content,
                    memory.metadata.quality || 4,
                    'feedback',
                    {
                        agentId: memory.metadata.agentId,
                        tags: memory.metadata.tags
                    }
                );
                newExamples.push(example);
            }
        }

        return newExamples;
    }

    /**
     * Generate CoT data from a task using LLM
     */
    async generateCoTFromTask(
        task: string,
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken
    ): Promise<CoTExample | null> {
        const prompt = `You are generating Chain-of-Thought training data.

Given this task: "${task}"

Generate a step-by-step reasoning process to solve it.

Output in this exact JSON format:
{
    "question": "the original task/question",
    "thinking": [
        "Step 1: First, I need to...",
        "Step 2: Then, I should...",
        "Step 3: Finally..."
    ],
    "answer": "the final answer"
}

Only output valid JSON.`;

        try {
            const messages = [vscode.LanguageModelChatMessage.User(prompt)];
            const response = await model.sendRequest(messages, {}, token);
            
            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
            }

            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return this.addCoTExample(
                    parsed.question,
                    parsed.thinking,
                    parsed.answer,
                    4
                );
            }
        } catch (error) {
            console.error('CoT generation failed:', error);
        }

        return null;
    }

    /**
     * Self-Instruct: Generate new instructions from seed examples
     * Inspired by CAMEL's self-instruct datagen
     */
    async selfInstruct(
        seedInstructions: string[],
        model: vscode.LanguageModelChat,
        token: vscode.CancellationToken,
        count: number = 5
    ): Promise<TrainingExample[]> {
        const prompt = `You are generating diverse training instructions.

Here are some example instructions:
${seedInstructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Generate ${count} NEW and DIVERSE instructions that are different from the examples above.
The instructions should be clear, specific, and actionable.

Output in this exact JSON format:
{
    "instructions": [
        {
            "instruction": "the instruction",
            "input": "sample input for this instruction",
            "output": "expected output for this instruction"
        }
    ]
}

Only output valid JSON.`;

        const newExamples: TrainingExample[] = [];

        try {
            const messages = [vscode.LanguageModelChatMessage.User(prompt)];
            const response = await model.sendRequest(messages, {}, token);
            
            let fullResponse = '';
            for await (const chunk of response.text) {
                fullResponse += chunk;
            }

            const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                for (const item of parsed.instructions || []) {
                    const example = this.addExample(
                        item.instruction,
                        item.input || '',
                        item.output || '',
                        3,
                        'generated'
                    );
                    newExamples.push(example);
                }
            }
        } catch (error) {
            console.error('Self-instruct generation failed:', error);
        }

        return newExamples;
    }

    /**
     * Export in Alpaca format (instruction, input, output)
     */
    exportAlpacaFormat(minQuality: number = 3): object[] {
        return this.examples
            .filter(e => e.quality >= minQuality)
            .map(e => ({
                instruction: e.instruction,
                input: e.input,
                output: e.output
            }));
    }

    /**
     * Export in ShareGPT format (conversations)
     */
    exportShareGPTFormat(minQuality: number = 3): object[] {
        return this.examples
            .filter(e => e.quality >= minQuality)
            .map(e => ({
                conversations: [
                    {
                        from: 'human',
                        value: e.input ? `${e.instruction}\n\n${e.input}` : e.instruction
                    },
                    {
                        from: 'gpt',
                        value: e.output
                    }
                ]
            }));
    }

    /**
     * Export CoT examples in training format
     */
    exportCoTFormat(minQuality: number = 3): object[] {
        return this.cotExamples
            .filter(e => e.quality >= minQuality)
            .map(e => ({
                instruction: 'Solve the following problem step by step.',
                input: e.question,
                output: `Let me think through this step by step:\n\n${e.thinking.join('\n\n')}\n\nTherefore, the answer is: ${e.answer}`
            }));
    }

    /**
     * Export all data to a JSON file
     */
    exportToFile(filename: string, format: 'alpaca' | 'sharegpt' | 'cot' = 'alpaca', minQuality: number = 3) {
        let data: object[];
        
        switch (format) {
            case 'sharegpt':
                data = this.exportShareGPTFormat(minQuality);
                break;
            case 'cot':
                data = this.exportCoTFormat(minQuality);
                break;
            default:
                data = this.exportAlpacaFormat(minQuality);
        }

        const filePath = path.join(this.storagePath, filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return filePath;
    }

    /**
     * Get statistics about collected data
     */
    getStats(): object {
        const qualityDistribution: Record<number, number> = {};
        for (const e of this.examples) {
            qualityDistribution[e.quality] = (qualityDistribution[e.quality] || 0) + 1;
        }

        return {
            totalExamples: this.examples.length,
            cotExamples: this.cotExamples.length,
            qualityDistribution,
            sources: {
                feedback: this.examples.filter(e => e.source === 'feedback').length,
                manual: this.examples.filter(e => e.source === 'manual').length,
                generated: this.examples.filter(e => e.source === 'generated').length,
                roleplay: this.examples.filter(e => e.source === 'roleplay').length
            }
        };
    }

    /**
     * Save examples to disk
     */
    private saveExamples() {
        const examplesPath = path.join(this.storagePath, 'examples.json');
        const cotPath = path.join(this.storagePath, 'cot_examples.json');
        
        fs.writeFileSync(examplesPath, JSON.stringify(this.examples, null, 2));
        fs.writeFileSync(cotPath, JSON.stringify(this.cotExamples, null, 2));
    }

    /**
     * Load examples from disk
     */
    private loadExamples() {
        const examplesPath = path.join(this.storagePath, 'examples.json');
        const cotPath = path.join(this.storagePath, 'cot_examples.json');

        if (fs.existsSync(examplesPath)) {
            try {
                this.examples = JSON.parse(fs.readFileSync(examplesPath, 'utf-8'));
            } catch (error) {
                console.error('Failed to load examples:', error);
            }
        }

        if (fs.existsSync(cotPath)) {
            try {
                this.cotExamples = JSON.parse(fs.readFileSync(cotPath, 'utf-8'));
            } catch (error) {
                console.error('Failed to load CoT examples:', error);
            }
        }
    }
}
