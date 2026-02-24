import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Skill Definition - A pluggable skill package
 */
export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    /** Prompt instructions for the agent when using this skill */
    instructions: string;
    /** Tools this skill provides or requires */
    tools?: string[];
    /** Tags for discovery */
    tags?: string[];
    /** Whether this skill is currently active */
    enabled: boolean;
    /** Path to the skill directory (if loaded from disk) */
    sourcePath?: string;
    /** Skill-specific configuration */
    config?: Record<string, any>;
}

/**
 * Skill Manifest file (SKILL.json)
 */
export interface SkillManifest {
    id: string;
    name: string;
    description: string;
    version: string;
    author?: string;
    instructions: string;
    tools?: string[];
    tags?: string[];
    config?: Record<string, any>;
}

/**
 * SkillRegistry - Manages pluggable skill packages
 * 
 * Skills can be:
 * - Built-in (bundled with the extension)
 * - User-defined (loaded from workspace .taskagent/skills/)
 * - Installed from templates
 * 
 * Each skill provides prompt instructions and optional tool requirements
 * that extend agent capabilities.
 */
export class SkillRegistry {
    private skills: Map<string, SkillDefinition> = new Map();
    private skillsDir: string = '';
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this.registerBuiltinSkills();
    }

    /**
     * Initialize skills directory for user-defined skills
     */
    initializeSkillsDir(workspaceRoot?: string) {
        if (workspaceRoot) {
            this.skillsDir = path.join(workspaceRoot, '.taskagent', 'skills');
            this.ensureDir(this.skillsDir);
            this.loadUserSkills();
        }
    }

    private ensureDir(dir: string) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // ===== Built-in Skills =====

    private registerBuiltinSkills() {
        this.registerSkill({
            id: 'security-review',
            name: 'Security Review',
            description: 'Deep security analysis of code, APIs, and data flows',
            version: '1.0.0',
            instructions: `When performing security reviews:
1. Trace all call chains from entry point to external APIs
2. Identify required permissions and scopes (e.g., Microsoft Graph permissions)
3. Scan for credentials: AppID, ClientSecret, API Keys
4. Classify data: PII, user content, system metadata
5. Check authentication and authorization at every boundary
6. Generate a Mermaid sequence diagram of the data flow
7. Output a structured report with severity ratings`,
            tools: ['taskagent_analyzeScenario', 'taskagent_securityReview', 'taskagent_codeSearch'],
            tags: ['security', 'compliance', 'review'],
            enabled: true
        });

        this.registerSkill({
            id: 'code-quality',
            name: 'Code Quality',
            description: 'Code review, testing, and quality assurance',
            version: '1.0.0',
            instructions: `When reviewing code quality:
1. Check for code smells, anti-patterns, and technical debt
2. Verify proper error handling and logging
3. Assess test coverage and testability
4. Review naming conventions and code readability
5. Evaluate SOLID principles compliance
6. Generate unit tests for critical functions
7. Provide a quality score with improvement suggestions`,
            tools: ['taskagent_codeReview', 'taskagent_generateTests', 'taskagent_codeSearch'],
            tags: ['quality', 'testing', 'review'],
            enabled: true
        });

        this.registerSkill({
            id: 'web-research',
            name: 'Web Research',
            description: 'Research topics across the web and generate reports',
            version: '1.0.0',
            instructions: `When researching:
1. Search multiple sources for comprehensive coverage
2. Cross-reference information for accuracy
3. Cite all sources clearly
4. Organize findings into structured sections
5. Highlight key insights and actionable takeaways
6. Generate a well-formatted markdown report`,
            tools: ['taskagent_webSearch', 'taskagent_browseWebpage', 'taskagent_githubSearch'],
            tags: ['research', 'web', 'report'],
            enabled: true
        });

        this.registerSkill({
            id: 'pr-review',
            name: 'PR Review Pipeline',
            description: 'Automated pull request review from multiple perspectives',
            version: '1.0.0',
            instructions: `When reviewing a PR:
1. Security perspective: Check for vulnerabilities, credential leaks, input validation
2. Architecture perspective: Evaluate design patterns, scalability, separation of concerns
3. Quality perspective: Code readability, naming, error handling, documentation
4. Testing perspective: Test coverage, edge cases, regression risks
5. Performance perspective: Bottlenecks, memory usage, async patterns
6. Generate consolidated recommendations with priority`,
            tools: ['taskagent_codeReview', 'taskagent_codeSearch', 'taskagent_readFile'],
            tags: ['pr', 'review', 'pipeline'],
            enabled: true
        });

        this.registerSkill({
            id: 'doc-generator',
            name: 'Documentation Generator',
            description: 'Auto-generate documentation from code',
            version: '1.0.0',
            instructions: `When generating documentation:
1. Analyze code structure: classes, functions, interfaces
2. Extract JSDoc/docstring comments
3. Identify public APIs and their parameters
4. Generate usage examples
5. Create README sections for each module
6. Include architecture diagrams using Mermaid`,
            tools: ['taskagent_getSymbols', 'taskagent_readFile', 'taskagent_createDocument'],
            tags: ['documentation', 'readme', 'api-docs'],
            enabled: true
        });

        this.registerSkill({
            id: 'bug-hunter',
            name: 'Bug Hunter',
            description: 'Systematic bug detection and analysis',
            version: '1.0.0',
            instructions: `When hunting bugs:
1. Analyze error patterns in the codebase
2. Trace execution paths that could fail
3. Check null/undefined handling
4. Verify boundary conditions and edge cases
5. Look for race conditions in async code
6. Check resource cleanup (file handles, connections, subscriptions)
7. Report each bug with: severity, location, reproduction steps, suggested fix`,
            tools: ['taskagent_codeSearch', 'taskagent_readFile', 'taskagent_executeCode'],
            tags: ['debugging', 'bugs', 'analysis'],
            enabled: true
        });
    }

    // ===== User Skills Management =====

    /**
     * Load skills from workspace .taskagent/skills/ directory
     */
    loadUserSkills() {
        if (!this.skillsDir || !fs.existsSync(this.skillsDir)) return;

        const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const manifestPath = path.join(this.skillsDir, entry.name, 'SKILL.json');
                if (fs.existsSync(manifestPath)) {
                    try {
                        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SkillManifest;
                        this.registerSkill({
                            ...manifest,
                            enabled: true,
                            sourcePath: path.join(this.skillsDir, entry.name)
                        });
                    } catch (error) {
                        console.error(`Failed to load skill from ${entry.name}:`, error);
                    }
                }
            }
        }
    }

    /**
     * Create a new user skill from template
     */
    async createSkill(id: string, name: string, description: string): Promise<SkillDefinition> {
        if (!this.skillsDir) {
            throw new Error('Skills directory not initialized. Open a workspace first.');
        }

        const skillDir = path.join(this.skillsDir, id);
        this.ensureDir(skillDir);

        const manifest: SkillManifest = {
            id,
            name,
            description,
            version: '1.0.0',
            instructions: `# ${name}\n\nAdd your skill instructions here.\n\nThese instructions will be injected into the agent's prompt when this skill is active.`,
            tags: [],
            config: {}
        };

        // Write manifest
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.json'),
            JSON.stringify(manifest, null, 2)
        );

        // Create instruction file for easier editing
        fs.writeFileSync(
            path.join(skillDir, 'INSTRUCTIONS.md'),
            manifest.instructions
        );

        const skill: SkillDefinition = {
            ...manifest,
            enabled: true,
            sourcePath: skillDir
        };

        this.registerSkill(skill);
        return skill;
    }

    // ===== Core Operations =====

    registerSkill(skill: SkillDefinition) {
        this.skills.set(skill.id, skill);
        this._onDidChange.fire();
    }

    getSkill(id: string): SkillDefinition | undefined {
        return this.skills.get(id);
    }

    getAllSkills(): SkillDefinition[] {
        return Array.from(this.skills.values());
    }

    getEnabledSkills(): SkillDefinition[] {
        return this.getAllSkills().filter(s => s.enabled);
    }

    setSkillEnabled(id: string, enabled: boolean) {
        const skill = this.skills.get(id);
        if (skill) {
            skill.enabled = enabled;
            this._onDidChange.fire();
        }
    }

    removeSkill(id: string) {
        this.skills.delete(id);
        this._onDidChange.fire();
    }

    /**
     * Find skills by tag
     */
    findSkillsByTag(tag: string): SkillDefinition[] {
        return this.getEnabledSkills().filter(
            s => s.tags?.includes(tag.toLowerCase())
        );
    }

    /**
     * Find skills relevant to a query
     */
    findRelevantSkills(query: string): SkillDefinition[] {
        const queryLower = query.toLowerCase();
        return this.getEnabledSkills().filter(s => {
            return s.name.toLowerCase().includes(queryLower) ||
                   s.description.toLowerCase().includes(queryLower) ||
                   s.tags?.some(t => queryLower.includes(t)) ||
                   s.id.toLowerCase().includes(queryLower);
        });
    }

    /**
     * Build prompt instructions from active skills
     */
    buildSkillPrompt(skillIds?: string[]): string {
        const skills = skillIds 
            ? skillIds.map(id => this.skills.get(id)).filter(Boolean) as SkillDefinition[]
            : this.getEnabledSkills();

        if (skills.length === 0) return '';

        const sections = skills.map(skill => 
            `### Skill: ${skill.name}\n${skill.instructions}`
        );

        return `\n<active_skills>\n${sections.join('\n\n')}\n</active_skills>\n`;
    }

    /**
     * Get all tools required by active skills
     */
    getRequiredTools(): string[] {
        const tools = new Set<string>();
        for (const skill of this.getEnabledSkills()) {
            skill.tools?.forEach(t => tools.add(t));
        }
        return Array.from(tools);
    }

    /**
     * Export skills list for display
     */
    getSkillsSummary(): string {
        const skills = this.getAllSkills();
        if (skills.length === 0) return 'No skills registered.';

        return skills.map(s => {
            const status = s.enabled ? '✅' : '⬜';
            const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : '';
            return `${status} **${s.name}** (${s.id}) v${s.version}${tags}\n   ${s.description}`;
        }).join('\n');
    }
}
