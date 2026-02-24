import * as vscode from 'vscode';

/**
 * Agent Message - Structured inter-agent communication
 */
export interface AgentMessage {
    id: string;
    fromAgent: string;
    toAgent: string;
    type: 'request' | 'response' | 'broadcast' | 'delegate' | 'notify';
    subject: string;
    payload: any;
    timestamp: number;
    /** Correlation ID for request-response pairs */
    correlationId?: string;
    /** Priority: 0 = low, 1 = normal, 2 = high, 3 = critical */
    priority: number;
    /** Whether this message has been processed */
    processed: boolean;
}

/**
 * Delegation Request - When one agent delegates work to another
 */
export interface DelegationRequest {
    id: string;
    fromAgent: string;
    toAgent: string;
    taskDescription: string;
    context: Record<string, any>;
    expectedOutput: string;
    deadline?: number;
    status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'failed';
    result?: any;
}

/**
 * Subscription - Agents can subscribe to message topics
 */
interface Subscription {
    agentId: string;
    topic: string;
    handler: (message: AgentMessage) => Promise<void>;
}

/**
 * AgentBus - Enhanced inter-agent communication system
 * 
 * Features:
 * - Direct messaging between agents
 * - Broadcast messaging to all agents
 * - Request-response pattern with correlation IDs
 * - Task delegation (Agent A → Agent B)
 * - Topic-based pub/sub
 * - Message history for debugging
 */
export class AgentBus {
    private messageQueue: AgentMessage[] = [];
    private delegations: Map<string, DelegationRequest> = new Map();
    private subscriptions: Subscription[] = [];
    private messageHistory: AgentMessage[] = [];
    private _onMessage = new vscode.EventEmitter<AgentMessage>();
    readonly onMessage = this._onMessage.event;
    private _onDelegation = new vscode.EventEmitter<DelegationRequest>();
    readonly onDelegation = this._onDelegation.event;

    private maxHistory = 200;

    constructor() {}

    // ===== Direct Messaging =====

    /**
     * Send a message from one agent to another
     */
    sendMessage(from: string, to: string, subject: string, payload: any, type: AgentMessage['type'] = 'notify', priority: number = 1): AgentMessage {
        const message: AgentMessage = {
            id: this.generateId(),
            fromAgent: from,
            toAgent: to,
            type,
            subject,
            payload,
            timestamp: Date.now(),
            priority,
            processed: false
        };

        this.messageQueue.push(message);
        this.addToHistory(message);
        this._onMessage.fire(message);

        // Also notify topic subscribers
        this.notifySubscribers(subject, message);

        return message;
    }

    /**
     * Send a request and wait for response (with timeout)
     */
    async sendRequest(from: string, to: string, subject: string, payload: any, timeoutMs: number = 30000): Promise<AgentMessage | null> {
        const correlationId = this.generateId();
        
        const request: AgentMessage = {
            id: this.generateId(),
            fromAgent: from,
            toAgent: to,
            type: 'request',
            subject,
            payload,
            timestamp: Date.now(),
            correlationId,
            priority: 1,
            processed: false
        };

        this.messageQueue.push(request);
        this.addToHistory(request);
        this._onMessage.fire(request);

        // Wait for response with matching correlation ID
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                resolve(null);
            }, timeoutMs);

            const disposable = this.onMessage((msg) => {
                if (msg.type === 'response' && msg.correlationId === correlationId) {
                    clearTimeout(timeout);
                    disposable.dispose();
                    resolve(msg);
                }
            });
        });
    }

    /**
     * Send a response to a request
     */
    sendResponse(originalMessage: AgentMessage, payload: any): AgentMessage {
        return this.sendMessage(
            originalMessage.toAgent,
            originalMessage.fromAgent,
            `RE: ${originalMessage.subject}`,
            payload,
            'response',
            originalMessage.priority
        );
    }

    /**
     * Broadcast a message to all agents
     */
    broadcast(from: string, subject: string, payload: any, priority: number = 1): AgentMessage {
        return this.sendMessage(from, '*', subject, payload, 'broadcast', priority);
    }

    // ===== Task Delegation =====

    /**
     * Delegate a task from one agent to another
     */
    delegateTask(from: string, to: string, taskDescription: string, context: Record<string, any> = {}, expectedOutput: string = ''): DelegationRequest {
        const delegation: DelegationRequest = {
            id: this.generateId(),
            fromAgent: from,
            toAgent: to,
            taskDescription,
            context,
            expectedOutput,
            status: 'pending'
        };

        this.delegations.set(delegation.id, delegation);

        // Send delegation message
        this.sendMessage(from, to, `Delegation: ${taskDescription}`, {
            delegationId: delegation.id,
            taskDescription,
            context,
            expectedOutput
        }, 'delegate', 2);

        this._onDelegation.fire(delegation);
        return delegation;
    }

    /**
     * Update delegation status
     */
    updateDelegation(delegationId: string, status: DelegationRequest['status'], result?: any) {
        const delegation = this.delegations.get(delegationId);
        if (delegation) {
            delegation.status = status;
            if (result !== undefined) {
                delegation.result = result;
            }
            this._onDelegation.fire(delegation);

            // Notify the requesting agent
            if (status === 'completed' || status === 'failed') {
                this.sendMessage(delegation.toAgent, delegation.fromAgent, 
                    `Delegation ${status}: ${delegation.taskDescription}`,
                    { delegationId, status, result },
                    'notify', 2);
            }
        }
    }

    getDelegation(id: string): DelegationRequest | undefined {
        return this.delegations.get(id);
    }

    getActiveDelegations(): DelegationRequest[] {
        return Array.from(this.delegations.values()).filter(
            d => d.status === 'pending' || d.status === 'accepted' || d.status === 'in-progress'
        );
    }

    // ===== Pub/Sub =====

    /**
     * Subscribe to messages on a specific topic
     */
    subscribe(agentId: string, topic: string, handler: (message: AgentMessage) => Promise<void>): vscode.Disposable {
        const subscription: Subscription = { agentId, topic, handler };
        this.subscriptions.push(subscription);

        return new vscode.Disposable(() => {
            const index = this.subscriptions.indexOf(subscription);
            if (index >= 0) {
                this.subscriptions.splice(index, 1);
            }
        });
    }

    private async notifySubscribers(topic: string, message: AgentMessage) {
        const matching = this.subscriptions.filter(s => 
            s.topic === topic || s.topic === '*'
        );
        for (const sub of matching) {
            try {
                await sub.handler(message);
            } catch (error) {
                console.error(`Subscriber ${sub.agentId} error on topic ${topic}:`, error);
            }
        }
    }

    // ===== Message Queue Operations =====

    /**
     * Get unprocessed messages for an agent
     */
    getMessagesFor(agentId: string): AgentMessage[] {
        return this.messageQueue.filter(
            m => !m.processed && (m.toAgent === agentId || m.toAgent === '*')
        );
    }

    /**
     * Mark a message as processed
     */
    markProcessed(messageId: string) {
        const msg = this.messageQueue.find(m => m.id === messageId);
        if (msg) msg.processed = true;
    }

    /**
     * Get message history (for debugging & dashboard)
     */
    getHistory(limit?: number): AgentMessage[] {
        const history = this.messageHistory.slice().reverse();
        return limit ? history.slice(0, limit) : history;
    }

    /**
     * Get conversation between two agents
     */
    getConversation(agent1: string, agent2: string): AgentMessage[] {
        return this.messageHistory.filter(m =>
            (m.fromAgent === agent1 && m.toAgent === agent2) ||
            (m.fromAgent === agent2 && m.toAgent === agent1)
        );
    }

    // ===== Stats =====

    getStats() {
        return {
            totalMessages: this.messageHistory.length,
            pendingMessages: this.messageQueue.filter(m => !m.processed).length,
            activeDelegations: this.getActiveDelegations().length,
            totalDelegations: this.delegations.size,
            activeSubscriptions: this.subscriptions.length,
            messagesByType: this.countByType()
        };
    }

    private countByType(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const msg of this.messageHistory) {
            counts[msg.type] = (counts[msg.type] || 0) + 1;
        }
        return counts;
    }

    // ===== Summary for prompts =====

    buildContextForAgent(agentId: string): string {
        const pending = this.getMessagesFor(agentId);
        const delegations = this.getActiveDelegations().filter(
            d => d.toAgent === agentId || d.fromAgent === agentId
        );

        if (pending.length === 0 && delegations.length === 0) return '';

        let context = '\n<agent_communication>\n';

        if (pending.length > 0) {
            context += `## Pending Messages (${pending.length}):\n`;
            for (const msg of pending.slice(-5)) {
                context += `- [${msg.type}] From ${msg.fromAgent}: ${msg.subject}\n`;
            }
        }

        if (delegations.length > 0) {
            context += `\n## Active Delegations:\n`;
            for (const del of delegations) {
                const role = del.fromAgent === agentId ? 'Delegated to' : 'Received from';
                const target = del.fromAgent === agentId ? del.toAgent : del.fromAgent;
                context += `- ${role} ${target}: ${del.taskDescription} [${del.status}]\n`;
            }
        }

        context += '</agent_communication>\n';
        return context;
    }

    // ===== Utilities =====

    private addToHistory(message: AgentMessage) {
        this.messageHistory.push(message);
        if (this.messageHistory.length > this.maxHistory) {
            this.messageHistory = this.messageHistory.slice(-this.maxHistory);
        }
    }

    private generateId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }
}
