import * as vscode from 'vscode';
import { MemoryModule } from './memory';

/**
 * Role definition for role-playing
 */
export interface RoleDefinition {
    name: string;
    description: string;
    systemPrompt: string;
    personality?: string;
    expertise?: string[];
    constraints?: string[];
}

/**
 * Role-Playing Session
 */
export interface RolePlaySession {
    id: string;
    roles: RoleDefinition[];
    topic: string;
    maxTurns: number;
    currentTurn: number;
    status: 'active' | 'completed' | 'paused';
}

/**
 * RolePlayEngine - Multi-agent role-playing for diverse perspectives
 * Inspired by CAMEL's role-playing framework
 * 
 * Features:
 * - Define custom roles with personas
 * - Multi-turn dialogues between agents
 * - Collect diverse viewpoints on a topic
 * - Generate training data from role-play
 */
export class RolePlayEngine {
    private activeSessions: Map<string, RolePlaySession> = new Map();
    
    // Pre-defined roles
    static PREDEFINED_ROLES: Record<string, RoleDefinition> = {
        'security_expert': {
            name: 'Security Expert',
            description: 'A cybersecurity specialist focused on vulnerabilities and threats',
            systemPrompt: `You are a senior cybersecurity expert with 15+ years of experience.
You analyze code and systems for security vulnerabilities, threat vectors, and compliance issues.
You are thorough, detail-oriented, and always consider the worst-case scenarios.
When reviewing, focus on: authentication, authorization, data validation, encryption, and secure coding practices.`,
            expertise: ['penetration testing', 'threat modeling', 'compliance', 'secure coding'],
            personality: 'cautious, thorough, skeptical'
        },
        'architect': {
            name: 'Software Architect',
            description: 'A system architect focused on design and scalability',
            systemPrompt: `You are a principal software architect with expertise in distributed systems.
You evaluate code and designs for scalability, maintainability, and architectural soundness.
You think about long-term implications, technical debt, and system evolution.
Focus on: design patterns, SOLID principles, microservices, API design, and system boundaries.`,
            expertise: ['system design', 'microservices', 'API design', 'scalability'],
            personality: 'strategic, pragmatic, forward-thinking'
        },
        'developer': {
            name: 'Senior Developer',
            description: 'An experienced developer focused on code quality',
            systemPrompt: `You are a senior software developer with expertise in multiple languages.
You review code for quality, readability, performance, and best practices.
You care about clean code, proper testing, and developer experience.
Focus on: code organization, naming, error handling, testing, and documentation.`,
            expertise: ['clean code', 'testing', 'refactoring', 'debugging'],
            personality: 'practical, detail-oriented, collaborative'
        },
        'product_manager': {
            name: 'Product Manager',
            description: 'A PM focused on user needs and business value',
            systemPrompt: `You are a product manager who bridges technical and business perspectives.
You evaluate features and implementations from a user and business standpoint.
You care about user experience, business value, and time-to-market.
Focus on: user stories, acceptance criteria, edge cases, and business impact.`,
            expertise: ['user research', 'prioritization', 'requirements', 'stakeholder management'],
            personality: 'user-focused, pragmatic, communicative'
        },
        'qa_engineer': {
            name: 'QA Engineer',
            description: 'A quality assurance specialist focused on testing',
            systemPrompt: `You are a senior QA engineer specialized in test strategy and quality assurance.
You evaluate code and features for testability, edge cases, and potential bugs.
You think about all possible failure modes and how to prevent them.
Focus on: test coverage, edge cases, integration testing, and regression risks.`,
            expertise: ['test automation', 'integration testing', 'performance testing', 'bug analysis'],
            personality: 'meticulous, curious, systematic'
        },
        'devops_engineer': {
            name: 'DevOps Engineer',
            description: 'An infrastructure specialist focused on deployment and operations',
            systemPrompt: `You are a DevOps engineer with expertise in CI/CD, infrastructure, and operations.
You evaluate code and systems for deployability, observability, and operational concerns.
You care about reliability, monitoring, and incident response.
Focus on: deployment strategy, logging, metrics, error handling, and configuration.`,
            expertise: ['CI/CD', 'Kubernetes', 'monitoring', 'incident response'],
            personality: 'reliability-focused, systematic, automation-minded'
        },
        'devil_advocate': {
            name: "Devil's Advocate",
            description: 'Challenges assumptions and finds weaknesses',
            systemPrompt: `You are a critical thinker who challenges assumptions and finds weaknesses.
Your job is to question everything, find holes in arguments, and stress-test ideas.
You are not negative - you help make ideas stronger by identifying blind spots.
Focus on: assumptions, edge cases, failure modes, and overlooked risks.`,
            expertise: ['critical thinking', 'risk analysis', 'debate'],
            personality: 'challenging, thorough, constructive'
        }
    };

    constructor(private memoryModule: MemoryModule) {}

    private generateId(): string {
        return `rp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Create a new role-playing session
     */
    createSession(
        roles: (RoleDefinition | string)[],
        topic: string,
        maxTurns: number = 6
    ): RolePlaySession {
        const resolvedRoles = roles.map(r => 
            typeof r === 'string' 
                ? RolePlayEngine.PREDEFINED_ROLES[r] || this.createCustomRole(r)
                : r
        );

        const session: RolePlaySession = {
            id: this.generateId(),
            roles: resolvedRoles,
            topic,
            maxTurns,
            currentTurn: 0,
            status: 'active'
        };

        this.activeSessions.set(session.id, session);
        return session;
    }

    /**
     * Create a custom role from a simple description
     */
    private createCustomRole(description: string): RoleDefinition {
        return {
            name: description,
            description: description,
            systemPrompt: `You are a ${description}. Provide your perspective and expertise on the topic at hand.`
        };
    }

    /**
     * Run a complete role-playing session
     */
    async runSession(
        session: RolePlaySession,
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<string[]> {
        const responses: string[] = [];
        
        stream.markdown(`## 🎭 Role-Playing Analysis: ${session.topic}\n\n`);
        stream.markdown(`*${session.roles.length} perspectives, ${session.maxTurns} turns each*\n\n`);
        stream.markdown('---\n\n');

        // Each role takes turns responding
        for (let turn = 0; turn < session.maxTurns; turn++) {
            session.currentTurn = turn + 1;
            
            for (const role of session.roles) {
                if (token.isCancellationRequested) {
                    session.status = 'paused';
                    return responses;
                }

                stream.markdown(`### 🎭 ${role.name}\n`);
                if (turn === 0) {
                    stream.markdown(`*${role.description}*\n\n`);
                }

                // Build context from previous responses
                const context = responses.length > 0
                    ? `\n\nPrevious perspectives:\n${responses.slice(-3).join('\n\n')}`
                    : '';

                const messages = [
                    vscode.LanguageModelChatMessage.User(role.systemPrompt),
                    vscode.LanguageModelChatMessage.User(
                        `Topic: ${session.topic}${context}\n\n` +
                        `Turn ${turn + 1}/${session.maxTurns}: Provide your perspective. ` +
                        `${turn > 0 ? 'Build on or challenge previous points.' : 'Start with your initial analysis.'}`
                    )
                ];

                try {
                    const response = await model.sendRequest(messages, {}, token);
                    let roleResponse = '';
                    
                    for await (const chunk of response.text) {
                        roleResponse += chunk;
                        stream.markdown(chunk);
                    }
                    
                    responses.push(`[${role.name}]: ${roleResponse}`);
                    
                    // Record in memory
                    this.memoryModule.addConversationTurn(session.id, role.name, roleResponse);
                    
                    stream.markdown('\n\n');
                } catch (error) {
                    stream.markdown(`\n*Error: ${error}*\n\n`);
                }
            }

            stream.markdown('---\n\n');
        }

        session.status = 'completed';
        
        // Generate synthesis
        await this.synthesizeSession(session, responses, model, stream, token);
        
        return responses;
    }

    /**
     * Synthesize insights from a completed session
     */
    private async synthesizeSession(
        session: RolePlaySession,
        responses: string[],
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) {
        stream.markdown(`## 📋 Synthesis\n\n`);

        const synthesisPrompt = `You are synthesizing insights from a multi-perspective analysis.

Topic: ${session.topic}

Perspectives analyzed:
${responses.join('\n\n')}

Provide a synthesis that:
1. Identifies key agreements across perspectives
2. Highlights important disagreements or tensions
3. Lists concrete recommendations
4. Notes any blind spots or areas needing more investigation

Be concise and actionable.`;

        try {
            const messages = [vscode.LanguageModelChatMessage.User(synthesisPrompt)];
            const response = await model.sendRequest(messages, {}, token);
            
            for await (const chunk of response.text) {
                stream.markdown(chunk);
            }
        } catch (error) {
            stream.markdown(`*Synthesis failed: ${error}*`);
        }

        stream.markdown('\n\n');
    }

    /**
     * Quick multi-perspective analysis without full session
     */
    async quickAnalysis(
        topic: string,
        roleNames: string[],
        model: vscode.LanguageModelChat,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<Map<string, string>> {
        const results = new Map<string, string>();
        
        stream.markdown(`## 🎭 Quick Multi-Perspective Analysis\n\n`);
        stream.markdown(`**Topic:** ${topic}\n\n`);

        for (const roleName of roleNames) {
            const role = RolePlayEngine.PREDEFINED_ROLES[roleName];
            if (!role) continue;

            stream.markdown(`### ${role.name}\n\n`);

            const messages = [
                vscode.LanguageModelChatMessage.User(role.systemPrompt),
                vscode.LanguageModelChatMessage.User(
                    `Analyze this topic from your perspective: ${topic}\n\n` +
                    `Provide a concise analysis (3-5 key points).`
                )
            ];

            try {
                const response = await model.sendRequest(messages, {}, token);
                let roleResponse = '';
                
                for await (const chunk of response.text) {
                    roleResponse += chunk;
                    stream.markdown(chunk);
                }
                
                results.set(roleName, roleResponse);
                stream.markdown('\n\n');
            } catch (error) {
                stream.markdown(`*Error: ${error}*\n\n`);
            }
        }

        return results;
    }

    /**
     * Get available predefined roles
     */
    getAvailableRoles(): RoleDefinition[] {
        return Object.values(RolePlayEngine.PREDEFINED_ROLES);
    }

    /**
     * Get active session
     */
    getSession(id: string): RolePlaySession | undefined {
        return this.activeSessions.get(id);
    }
}
