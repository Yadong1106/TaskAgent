import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';

export interface Task {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_human';
    progress: number;
    subtasks: SubTask[];
    createdAt: Date;
    updatedAt: Date;
    result?: any;
    error?: string;
    // Priority queue support
    priority: TaskPriority;
    deadline?: Date;
    estimatedDuration?: number;  // in minutes
    tags?: string[];
}

export interface SubTask {
    id: string;
    agentId: string;
    name: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    input: any;
    output?: any;
}

/**
 * TaskManager - Manages the lifecycle of all tasks
 * Similar to Eigent's task decomposition and execution tracking
 */
/**
 * Priority weight for sorting
 */
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
    'critical': 4,
    'high': 3,
    'normal': 2,
    'low': 1
};

export class TaskManager implements vscode.TreeDataProvider<Task | SubTask> {
    private tasks: Map<string, Task> = new Map();
    private _onDidChangeTreeData = new vscode.EventEmitter<Task | SubTask | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _onTaskUpdate = new vscode.EventEmitter<Task>();
    readonly onTaskUpdate = this._onTaskUpdate.event;

    createTask(name: string, options?: {
        priority?: TaskPriority;
        deadline?: Date;
        estimatedDuration?: number;
        tags?: string[];
    }): Task {
        const task: Task = {
            id: uuidv4(),
            name,
            status: 'pending',
            progress: 0,
            subtasks: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            priority: options?.priority || 'normal',
            deadline: options?.deadline,
            estimatedDuration: options?.estimatedDuration,
            tags: options?.tags || []
        };
        this.tasks.set(task.id, task);
        this._onDidChangeTreeData.fire(undefined);
        return task;
    }

    /**
     * Update task priority
     */
    updateTaskPriority(taskId: string, priority: TaskPriority) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.priority = priority;
        task.updatedAt = new Date();
        this._onTaskUpdate.fire(task);
        this._onDidChangeTreeData.fire(task);
    }

    /**
     * Set task deadline
     */
    setTaskDeadline(taskId: string, deadline: Date) {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.deadline = deadline;
        task.updatedAt = new Date();
        this._onTaskUpdate.fire(task);
        this._onDidChangeTreeData.fire(task);
    }

    /**
     * Get next task from priority queue
     */
    getNextPriorityTask(): Task | undefined {
        const pendingTasks = this.getAllTasks().filter(t => t.status === 'pending');
        if (pendingTasks.length === 0) return undefined;

        // Sort by priority (descending), then by deadline (ascending), then by creation time
        return pendingTasks.sort((a, b) => {
            // Priority comparison
            const priorityDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
            if (priorityDiff !== 0) return priorityDiff;

            // Deadline comparison (tasks with deadlines come first)
            if (a.deadline && b.deadline) {
                return a.deadline.getTime() - b.deadline.getTime();
            }
            if (a.deadline) return -1;
            if (b.deadline) return 1;

            // Creation time (older first)
            return a.createdAt.getTime() - b.createdAt.getTime();
        })[0];
    }

    /**
     * Get tasks by priority
     */
    getTasksByPriority(priority: TaskPriority): Task[] {
        return this.getAllTasks().filter(t => t.priority === priority);
    }

    /**
     * Get overdue tasks
     */
    getOverdueTasks(): Task[] {
        const now = new Date();
        return this.getAllTasks().filter(t =>
            t.deadline &&
            t.deadline < now &&
            t.status !== 'completed' &&
            t.status !== 'failed'
        );
    }

    /**
     * Get tasks due soon (within N hours)
     */
    getTasksDueSoon(hoursAhead: number = 24): Task[] {
        const now = new Date();
        const threshold = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

        return this.getAllTasks().filter(t =>
            t.deadline &&
            t.deadline > now &&
            t.deadline <= threshold &&
            t.status !== 'completed' &&
            t.status !== 'failed'
        );
    }

    /**
     * Get priority queue stats
     */
    getPriorityStats(): {
        critical: number;
        high: number;
        normal: number;
        low: number;
        overdue: number;
        dueSoon: number;
    } {
        const tasks = this.getAllTasks().filter(t =>
            t.status !== 'completed' && t.status !== 'failed'
        );

        return {
            critical: tasks.filter(t => t.priority === 'critical').length,
            high: tasks.filter(t => t.priority === 'high').length,
            normal: tasks.filter(t => t.priority === 'normal').length,
            low: tasks.filter(t => t.priority === 'low').length,
            overdue: this.getOverdueTasks().length,
            dueSoon: this.getTasksDueSoon(24).length
        };
    }

    addSubtask(taskId: string, agentId: string, name: string, input: any): SubTask {
        const task = this.tasks.get(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);
        
        const subtask: SubTask = {
            id: uuidv4(),
            agentId,
            name,
            status: 'pending',
            input
        };
        task.subtasks.push(subtask);
        task.updatedAt = new Date();
        this._onDidChangeTreeData.fire(task);
        return subtask;
    }

    updateTaskStatus(taskId: string, status: Task['status'], progress?: number) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        
        task.status = status;
        if (progress !== undefined) task.progress = progress;
        task.updatedAt = new Date();
        this._onTaskUpdate.fire(task);
        this._onDidChangeTreeData.fire(task);
    }

    updateSubtaskStatus(taskId: string, subtaskId: string, status: SubTask['status'], output?: any) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        
        const subtask = task.subtasks.find(s => s.id === subtaskId);
        if (!subtask) return;
        
        subtask.status = status;
        if (output !== undefined) subtask.output = output;
        task.updatedAt = new Date();
        
        // Calculate overall progress
        const completed = task.subtasks.filter(s => s.status === 'completed').length;
        task.progress = Math.round((completed / task.subtasks.length) * 100);
        
        this._onTaskUpdate.fire(task);
        this._onDidChangeTreeData.fire(task);
    }

    completeTask(taskId: string, result: any) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        
        task.status = 'completed';
        task.progress = 100;
        task.result = result;
        task.updatedAt = new Date();
        this._onTaskUpdate.fire(task);
        this._onDidChangeTreeData.fire(task);
    }

    failTask(taskId: string, error: string) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        
        task.status = 'failed';
        task.error = error;
        task.updatedAt = new Date();
        this._onTaskUpdate.fire(task);
        this._onDidChangeTreeData.fire(task);
    }

    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    getActiveTasks(): Task[] {
        return this.getAllTasks().filter(t => t.status === 'running' || t.status === 'pending');
    }

    // TreeDataProvider implementation
    getTreeItem(element: Task | SubTask): vscode.TreeItem {
        if ('subtasks' in element) {
            // It's a Task
            const item = new vscode.TreeItem(
                element.name,
                element.subtasks.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None
            );
            const priorityIcon = this.getPriorityIcon(element.priority);
            item.description = `${priorityIcon} ${element.progress}% - ${element.status}`;
            item.iconPath = this.getStatusIcon(element.status);
            item.tooltip = this.getTaskTooltip(element);
            return item;
        } else {
            // It's a SubTask
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
            item.description = element.status;
            item.iconPath = this.getStatusIcon(element.status);
            return item;
        }
    }

    private getPriorityIcon(priority: TaskPriority): string {
        switch (priority) {
            case 'critical': return '🔴';
            case 'high': return '🟠';
            case 'normal': return '🟢';
            case 'low': return '⚪';
        }
    }

    private getTaskTooltip(task: Task): string {
        const lines = [
            `Name: ${task.name}`,
            `Status: ${task.status}`,
            `Priority: ${task.priority}`,
            `Progress: ${task.progress}%`
        ];

        if (task.deadline) {
            lines.push(`Deadline: ${task.deadline.toLocaleString()}`);
        }

        if (task.estimatedDuration) {
            lines.push(`Est. Duration: ${task.estimatedDuration} min`);
        }

        if (task.tags && task.tags.length > 0) {
            lines.push(`Tags: ${task.tags.join(', ')}`);
        }

        return lines.join('\n');
    }

    getChildren(element?: Task | SubTask): (Task | SubTask)[] {
        if (!element) {
            return this.getAllTasks().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if ('subtasks' in element) {
            return element.subtasks;
        }
        return [];
    }

    private getStatusIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'running': return new vscode.ThemeIcon('sync~spin');
            case 'completed': return new vscode.ThemeIcon('check');
            case 'failed': return new vscode.ThemeIcon('error');
            case 'waiting_human': return new vscode.ThemeIcon('account');
            default: return new vscode.ThemeIcon('circle-outline');
        }
    }
}














