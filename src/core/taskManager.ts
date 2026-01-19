import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

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
export class TaskManager implements vscode.TreeDataProvider<Task | SubTask> {
    private tasks: Map<string, Task> = new Map();
    private _onDidChangeTreeData = new vscode.EventEmitter<Task | SubTask | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _onTaskUpdate = new vscode.EventEmitter<Task>();
    readonly onTaskUpdate = this._onTaskUpdate.event;

    createTask(name: string): Task {
        const task: Task = {
            id: uuidv4(),
            name,
            status: 'pending',
            progress: 0,
            subtasks: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.tasks.set(task.id, task);
        this._onDidChangeTreeData.fire(undefined);
        return task;
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
            item.description = `${element.progress}% - ${element.status}`;
            item.iconPath = this.getStatusIcon(element.status);
            return item;
        } else {
            // It's a SubTask
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
            item.description = element.status;
            item.iconPath = this.getStatusIcon(element.status);
            return item;
        }
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














