import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskDecomposition } from './orchestrator';

/**
 * Template Parameter Definition
 */
export interface TemplateParameter {
    name: string;
    description: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'select';
    defaultValue?: any;
    options?: string[];  // For 'select' type
    required: boolean;
}

/**
 * Task Template Interface
 */
export interface TaskTemplate {
    id: string;
    name: string;
    description: string;
    category: 'research' | 'code' | 'automation' | 'review' | 'git' | 'custom';
    version: string;
    createdAt: number;
    updatedAt: number;

    // Template definition with placeholders
    baseDecomposition: {
        mainGoalPattern: string;  // With {{param}} placeholders
        subtasks: {
            descriptionPattern: string;
            agentId: string;
            priority: number;
            dependencies: number[];
        }[];
    };

    // Parameters for customization
    parameters: TemplateParameter[];

    // Metadata
    metadata: {
        author?: string;
        tags?: string[];
        usageCount: number;
        rating?: number;
        isBuiltIn: boolean;
    };
}

/**
 * Template Manager - Manages workflow templates
 * Follows the same storage pattern as MemoryModule
 */
export class TemplateManager {
    private templates: Map<string, TaskTemplate> = new Map();
    private storagePath: string;
    private templatesFile: string;

    constructor(context: vscode.ExtensionContext) {
        this.storagePath = path.join(context.globalStorageUri.fsPath, 'templates');
        this.templatesFile = path.join(this.storagePath, 'templates.json');
        this.ensureStorageExists();
        this.loadTemplates();
        this.registerBuiltInTemplates();
    }

    private ensureStorageExists() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    private generateId(): string {
        return `tpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Save current workflow decomposition as a template
     */
    async saveAsTemplate(
        decomposition: TaskDecomposition,
        name: string,
        description: string,
        category: TaskTemplate['category'] = 'custom',
        parameters: TemplateParameter[] = []
    ): Promise<TaskTemplate> {
        const template: TaskTemplate = {
            id: this.generateId(),
            name,
            description,
            category,
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            baseDecomposition: {
                mainGoalPattern: decomposition.mainGoal,
                subtasks: decomposition.subtasks.map(st => ({
                    descriptionPattern: st.description,
                    agentId: st.agentId,
                    priority: st.priority,
                    dependencies: st.dependencies
                }))
            },
            parameters,
            metadata: {
                usageCount: 0,
                isBuiltIn: false,
                tags: []
            }
        };

        this.templates.set(template.id, template);
        await this.saveTemplates();

        vscode.window.showInformationMessage(`Template "${name}" saved successfully!`);
        return template;
    }

    /**
     * Instantiate template with parameter values
     * Returns a TaskDecomposition ready for execution
     */
    instantiateTemplate(
        templateId: string,
        parameterValues: Record<string, any>
    ): TaskDecomposition {
        const template = this.templates.get(templateId);
        if (!template) {
            throw new Error(`Template "${templateId}" not found`);
        }

        // Validate required parameters
        for (const param of template.parameters) {
            if (param.required && !(param.name in parameterValues)) {
                // Use default value if available
                if (param.defaultValue !== undefined) {
                    parameterValues[param.name] = param.defaultValue;
                } else {
                    throw new Error(`Required parameter "${param.name}" is missing`);
                }
            }
        }

        // Apply parameter substitution
        const mainGoal = this.substituteParameters(
            template.baseDecomposition.mainGoalPattern,
            parameterValues
        );

        const subtasks = template.baseDecomposition.subtasks.map(st => ({
            description: this.substituteParameters(st.descriptionPattern, parameterValues),
            agentId: st.agentId,
            priority: st.priority,
            dependencies: st.dependencies
        }));

        // Update usage count
        template.metadata.usageCount++;
        template.updatedAt = Date.now();
        this.saveTemplates();

        return { mainGoal, subtasks };
    }

    /**
     * Substitute {{param}} placeholders with values
     */
    private substituteParameters(pattern: string, values: Record<string, any>): string {
        let result = pattern;
        for (const [key, value] of Object.entries(values)) {
            const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            result = result.replace(placeholder, String(value));
        }
        return result;
    }

    /**
     * Get all templates
     */
    getAllTemplates(): TaskTemplate[] {
        return Array.from(this.templates.values());
    }

    /**
     * Get templates by category
     */
    getTemplatesByCategory(category: TaskTemplate['category']): TaskTemplate[] {
        return this.getAllTemplates().filter(t => t.category === category);
    }

    /**
     * Get template by ID
     */
    getTemplate(id: string): TaskTemplate | undefined {
        return this.templates.get(id);
    }

    /**
     * Get template by name
     */
    getTemplateByName(name: string): TaskTemplate | undefined {
        return this.getAllTemplates().find(t =>
            t.name.toLowerCase() === name.toLowerCase()
        );
    }

    /**
     * Search templates by keyword
     */
    searchTemplates(query: string): TaskTemplate[] {
        const queryLower = query.toLowerCase();
        return this.getAllTemplates().filter(t =>
            t.name.toLowerCase().includes(queryLower) ||
            t.description.toLowerCase().includes(queryLower) ||
            t.metadata.tags?.some(tag => tag.toLowerCase().includes(queryLower))
        );
    }

    /**
     * Delete template (only non-built-in)
     */
    async deleteTemplate(id: string): Promise<boolean> {
        const template = this.templates.get(id);
        if (!template) {
            return false;
        }
        if (template.metadata.isBuiltIn) {
            vscode.window.showWarningMessage('Cannot delete built-in templates');
            return false;
        }

        this.templates.delete(id);
        await this.saveTemplates();
        vscode.window.showInformationMessage(`Template "${template.name}" deleted`);
        return true;
    }

    /**
     * Update template metadata (tags, rating)
     */
    async updateTemplateMetadata(
        id: string,
        updates: Partial<TaskTemplate['metadata']>
    ): Promise<boolean> {
        const template = this.templates.get(id);
        if (!template) {
            return false;
        }

        template.metadata = { ...template.metadata, ...updates };
        template.updatedAt = Date.now();
        await this.saveTemplates();
        return true;
    }

    /**
     * Register built-in templates
     */
    private registerBuiltInTemplates() {
        // Research Report Template
        this.templates.set('builtin-research', {
            id: 'builtin-research',
            name: 'Research Report',
            description: 'Research a topic and generate a comprehensive report',
            category: 'research',
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            baseDecomposition: {
                mainGoalPattern: 'Research and create report on: {{topic}}',
                subtasks: [
                    {
                        descriptionPattern: 'Search the web for information about {{topic}}',
                        agentId: 'search',
                        priority: 10,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Analyze and summarize findings on {{topic}}',
                        agentId: 'search',
                        priority: 8,
                        dependencies: [0]
                    },
                    {
                        descriptionPattern: 'Create structured research report document',
                        agentId: 'document',
                        priority: 6,
                        dependencies: [1]
                    }
                ]
            },
            parameters: [
                {
                    name: 'topic',
                    description: 'The topic to research',
                    type: 'string',
                    required: true
                }
            ],
            metadata: {
                usageCount: 0,
                isBuiltIn: true,
                tags: ['research', 'report', 'web-search']
            }
        });

        // Multi-Perspective Code Review Template
        this.templates.set('builtin-codereview', {
            id: 'builtin-codereview',
            name: 'Multi-Perspective Code Review',
            description: 'Review code from security, architecture, and quality perspectives',
            category: 'review',
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            baseDecomposition: {
                mainGoalPattern: 'Multi-perspective code review of {{target}}',
                subtasks: [
                    {
                        descriptionPattern: 'Security review of {{target}} - analyze vulnerabilities, authentication, data exposure',
                        agentId: 'security',
                        priority: 10,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Architecture review of {{target}} - analyze structure, patterns, maintainability',
                        agentId: 'codereview',
                        priority: 9,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Code quality review of {{target}} - analyze code smells, best practices',
                        agentId: 'developer',
                        priority: 8,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Consolidate all review findings and create prioritized recommendations',
                        agentId: 'document',
                        priority: 7,
                        dependencies: [0, 1, 2]
                    }
                ]
            },
            parameters: [
                {
                    name: 'target',
                    description: 'File or code to review (file path or description)',
                    type: 'string',
                    required: true
                }
            ],
            metadata: {
                usageCount: 0,
                isBuiltIn: true,
                tags: ['code', 'review', 'security', 'architecture']
            }
        });

        // Git Release Workflow Template
        this.templates.set('builtin-git-release', {
            id: 'builtin-git-release',
            name: 'Git Release Workflow',
            description: 'Prepare and execute a release with Git operations',
            category: 'git',
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            baseDecomposition: {
                mainGoalPattern: 'Prepare release {{version}} for {{project}}',
                subtasks: [
                    {
                        descriptionPattern: 'Check git status and ensure clean working directory',
                        agentId: 'git',
                        priority: 10,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Create release branch release/{{version}}',
                        agentId: 'git',
                        priority: 9,
                        dependencies: [0]
                    },
                    {
                        descriptionPattern: 'Update version to {{version}} in package files',
                        agentId: 'developer',
                        priority: 8,
                        dependencies: [1]
                    },
                    {
                        descriptionPattern: 'Commit version bump and create tag v{{version}}',
                        agentId: 'git',
                        priority: 7,
                        dependencies: [2]
                    },
                    {
                        descriptionPattern: 'Push release branch and tags to remote',
                        agentId: 'git',
                        priority: 6,
                        dependencies: [3]
                    }
                ]
            },
            parameters: [
                {
                    name: 'version',
                    description: 'Release version (e.g., 1.2.0)',
                    type: 'string',
                    required: true
                },
                {
                    name: 'project',
                    description: 'Project name',
                    type: 'string',
                    required: true
                }
            ],
            metadata: {
                usageCount: 0,
                isBuiltIn: true,
                tags: ['git', 'release', 'automation', 'version']
            }
        });

        // Feature Development Template
        this.templates.set('builtin-feature-dev', {
            id: 'builtin-feature-dev',
            name: 'Feature Development Workflow',
            description: 'Complete workflow for developing a new feature',
            category: 'code',
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            baseDecomposition: {
                mainGoalPattern: 'Develop feature: {{feature}}',
                subtasks: [
                    {
                        descriptionPattern: 'Create feature branch for {{feature}}',
                        agentId: 'git',
                        priority: 10,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Research best practices and patterns for implementing {{feature}}',
                        agentId: 'search',
                        priority: 9,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Implement the core functionality for {{feature}}',
                        agentId: 'developer',
                        priority: 8,
                        dependencies: [0, 1]
                    },
                    {
                        descriptionPattern: 'Review the implementation of {{feature}} for code quality',
                        agentId: 'codereview',
                        priority: 7,
                        dependencies: [2]
                    },
                    {
                        descriptionPattern: 'Commit and push the {{feature}} implementation',
                        agentId: 'git',
                        priority: 6,
                        dependencies: [3]
                    }
                ]
            },
            parameters: [
                {
                    name: 'feature',
                    description: 'Feature description',
                    type: 'string',
                    required: true
                }
            ],
            metadata: {
                usageCount: 0,
                isBuiltIn: true,
                tags: ['code', 'feature', 'development', 'git']
            }
        });

        // Security Audit Template
        this.templates.set('builtin-security-audit', {
            id: 'builtin-security-audit',
            name: 'Security Audit',
            description: 'Comprehensive security audit of a codebase or file',
            category: 'review',
            version: '1.0.0',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            baseDecomposition: {
                mainGoalPattern: 'Security audit of {{target}}',
                subtasks: [
                    {
                        descriptionPattern: 'Analyze {{target}} for common vulnerabilities (OWASP Top 10)',
                        agentId: 'security',
                        priority: 10,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Review authentication and authorization in {{target}}',
                        agentId: 'security',
                        priority: 9,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Analyze data flow and potential exposure points in {{target}}',
                        agentId: 'security',
                        priority: 8,
                        dependencies: []
                    },
                    {
                        descriptionPattern: 'Generate security audit report with findings and remediation steps',
                        agentId: 'document',
                        priority: 7,
                        dependencies: [0, 1, 2]
                    }
                ]
            },
            parameters: [
                {
                    name: 'target',
                    description: 'Target file, folder, or codebase to audit',
                    type: 'string',
                    required: true
                }
            ],
            metadata: {
                usageCount: 0,
                isBuiltIn: true,
                tags: ['security', 'audit', 'review', 'OWASP']
            }
        });
    }

    /**
     * Load templates from disk
     */
    private loadTemplates() {
        if (fs.existsSync(this.templatesFile)) {
            try {
                const data = fs.readFileSync(this.templatesFile, 'utf-8');
                const templates: TaskTemplate[] = JSON.parse(data);
                for (const template of templates) {
                    // Don't overwrite built-in templates
                    if (!template.metadata.isBuiltIn) {
                        this.templates.set(template.id, template);
                    }
                }
            } catch (error) {
                console.error('Failed to load templates:', error);
            }
        }
    }

    /**
     * Save templates to disk (only non-built-in)
     */
    private async saveTemplates() {
        const templates = this.getAllTemplates().filter(t => !t.metadata.isBuiltIn);
        fs.writeFileSync(this.templatesFile, JSON.stringify(templates, null, 2));
    }

    /**
     * Get template statistics
     */
    getStats(): object {
        const allTemplates = this.getAllTemplates();
        return {
            totalTemplates: allTemplates.length,
            builtInTemplates: allTemplates.filter(t => t.metadata.isBuiltIn).length,
            customTemplates: allTemplates.filter(t => !t.metadata.isBuiltIn).length,
            totalUsage: allTemplates.reduce((sum, t) => sum + t.metadata.usageCount, 0),
            byCategory: {
                research: allTemplates.filter(t => t.category === 'research').length,
                code: allTemplates.filter(t => t.category === 'code').length,
                automation: allTemplates.filter(t => t.category === 'automation').length,
                review: allTemplates.filter(t => t.category === 'review').length,
                git: allTemplates.filter(t => t.category === 'git').length,
                custom: allTemplates.filter(t => t.category === 'custom').length
            }
        };
    }

    /**
     * Format template list for display
     */
    formatTemplateList(): string {
        const templates = this.getAllTemplates();
        if (templates.length === 0) {
            return 'No templates available.';
        }

        let output = '## Available Templates\n\n';

        // Group by category
        const categories = ['research', 'code', 'review', 'git', 'automation', 'custom'] as const;

        for (const category of categories) {
            const categoryTemplates = templates.filter(t => t.category === category);
            if (categoryTemplates.length === 0) continue;

            output += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

            for (const t of categoryTemplates) {
                const builtInBadge = t.metadata.isBuiltIn ? ' (Built-in)' : '';
                const usageInfo = t.metadata.usageCount > 0 ? ` | Used ${t.metadata.usageCount}x` : '';
                output += `- **${t.name}**${builtInBadge}${usageInfo}\n`;
                output += `  ${t.description}\n`;
                if (t.parameters.length > 0) {
                    output += `  Parameters: ${t.parameters.map(p => `\`{{${p.name}}}\``).join(', ')}\n`;
                }
                output += '\n';
            }
        }

        return output;
    }

    /**
     * Show template picker dialog
     */
    async pickTemplate(): Promise<TaskTemplate | undefined> {
        const templates = this.getAllTemplates();
        const items = templates.map(t => ({
            label: t.name,
            description: t.metadata.isBuiltIn ? 'Built-in' : 'Custom',
            detail: t.description,
            template: t
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a template',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.template;
    }

    /**
     * Prompt for template parameters
     */
    async promptForParameters(template: TaskTemplate): Promise<Record<string, any> | undefined> {
        const values: Record<string, any> = {};

        for (const param of template.parameters) {
            let value: string | undefined;

            if (param.type === 'select' && param.options) {
                value = await vscode.window.showQuickPick(param.options, {
                    placeHolder: `${param.description}${param.required ? ' (required)' : ''}`
                });
            } else {
                value = await vscode.window.showInputBox({
                    prompt: param.description,
                    placeHolder: param.defaultValue ? `Default: ${param.defaultValue}` : undefined,
                    value: param.defaultValue?.toString()
                });
            }

            if (value === undefined && param.required) {
                vscode.window.showWarningMessage(`Parameter "${param.name}" is required`);
                return undefined;
            }

            if (value !== undefined) {
                // Type conversion
                if (param.type === 'number') {
                    values[param.name] = parseFloat(value);
                } else if (param.type === 'boolean') {
                    values[param.name] = value.toLowerCase() === 'true';
                } else {
                    values[param.name] = value;
                }
            } else if (param.defaultValue !== undefined) {
                values[param.name] = param.defaultValue;
            }
        }

        return values;
    }
}
