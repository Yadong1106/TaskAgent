import * as vscode from 'vscode';

export interface NoteEntry {
    agentId: string;
    timestamp: Date;
    title: string;
    content: string;
}

/**
 * NoteTakingTool - Core mechanism for inter-agent communication
 * Inspired by Eigent's NoteTakingToolkit
 * 
 * Purpose:
 * 1. Agents can write notes to record findings
 * 2. Other agents can read notes to get context
 * 3. Enables information sharing between agents
 */
export class NoteTakingTool implements vscode.LanguageModelTool<WriteNoteInput | ReadNoteInput> {
    private notes: Map<string, NoteEntry[]> = new Map(); // taskId -> notes

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<WriteNoteInput | ReadNoteInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const input = options.input as any;
        
        if ('content' in input) {
            // Write note
            return {
                invocationMessage: `Writing note: ${input.title || 'Untitled'}`,
            };
        } else {
            // Read notes
            return {
                invocationMessage: 'Reading notes from all agents...',
            };
        }
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<WriteNoteInput | ReadNoteInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input as any;

        if ('content' in input) {
            return this.writeNote(input as WriteNoteInput);
        } else {
            return this.readNotes(input as ReadNoteInput);
        }
    }

    private writeNote(input: WriteNoteInput): vscode.LanguageModelToolResult {
        const taskId = input.taskId || 'default';
        const note: NoteEntry = {
            agentId: input.agentId,
            timestamp: new Date(),
            title: input.title || 'Untitled',
            content: input.content
        };

        if (!this.notes.has(taskId)) {
            this.notes.set(taskId, []);
        }
        this.notes.get(taskId)!.push(note);

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
                `Note saved successfully.\n` +
                `Title: ${note.title}\n` +
                `Agent: ${note.agentId}\n` +
                `Time: ${note.timestamp.toISOString()}`
            )
        ]);
    }

    private readNotes(input: ReadNoteInput): vscode.LanguageModelToolResult {
        const taskId = input.taskId || 'default';
        const notes = this.notes.get(taskId) || [];

        if (notes.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No notes found for this task.')
            ]);
        }

        // Filter by agent if specified
        const filteredNotes = input.fromAgent 
            ? notes.filter(n => n.agentId === input.fromAgent)
            : notes;

        let formatted = `Found ${filteredNotes.length} note(s):\n\n`;
        filteredNotes.forEach((note, index) => {
            formatted += `--- Note ${index + 1} ---\n`;
            formatted += `Agent: ${note.agentId}\n`;
            formatted += `Title: ${note.title}\n`;
            formatted += `Time: ${note.timestamp.toISOString()}\n`;
            formatted += `Content:\n${note.content}\n\n`;
        });

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(formatted)
        ]);
    }

    // Clear notes for a specific task
    clearNotes(taskId: string) {
        this.notes.delete(taskId);
    }
}

export interface WriteNoteInput {
    taskId?: string;
    agentId: string;
    title?: string;
    content: string;
}

export interface ReadNoteInput {
    taskId?: string;
    fromAgent?: string; // Optional: only read notes from a specific agent
}














