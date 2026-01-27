import * as vscode from 'vscode';

export interface TestGeneratorInput {
    filePath: string;
    testFramework?: 'jest' | 'mocha' | 'vitest' | 'pytest' | 'unittest';
    testType?: 'unit' | 'integration' | 'e2e';
    functionNames?: string[];
}

/**
 * TestGeneratorTool - Generate tests for source code
 * Analyzes code structure and generates appropriate test cases
 */
export class TestGeneratorTool implements vscode.LanguageModelTool<TestGeneratorInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<TestGeneratorInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const { filePath, testFramework = 'jest' } = options.input;
        return {
            invocationMessage: `Generating ${testFramework} tests for: ${filePath}`,
            confirmationMessages: {
                title: 'Generate Tests',
                message: new vscode.MarkdownString(
                    `Generate tests for:\n\n**${filePath}**\n\nFramework: ${testFramework}`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<TestGeneratorInput>,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, testFramework = 'jest', testType = 'unit', functionNames } = options.input;

        try {
            // Read the source file
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const sourceCode = Buffer.from(fileContent).toString('utf-8');

            // Analyze the code structure
            const analysis = this.analyzeCode(sourceCode, filePath);

            // Generate test template
            const testCode = this.generateTestTemplate(
                analysis,
                testFramework,
                testType,
                functionNames
            );

            // Determine test file path
            const testFilePath = this.getTestFilePath(filePath, testFramework);

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `## Test Generation Analysis\n\n` +
                    `**Source File:** ${filePath}\n` +
                    `**Test Framework:** ${testFramework}\n` +
                    `**Test Type:** ${testType}\n` +
                    `**Suggested Test File:** ${testFilePath}\n\n` +
                    `### Detected Functions/Methods:\n` +
                    analysis.functions.map(f => `- \`${f.name}\` (${f.params.length} params)`).join('\n') +
                    `\n\n### Detected Classes:\n` +
                    (analysis.classes.length > 0
                        ? analysis.classes.map(c => `- \`${c.name}\` (${c.methods.length} methods)`).join('\n')
                        : '- None detected') +
                    `\n\n### Generated Test Template:\n\n\`\`\`${this.getTestFileExtension(filePath)}\n${testCode}\n\`\`\`\n\n` +
                    `### Next Steps:\n` +
                    `1. Create test file at: \`${testFilePath}\`\n` +
                    `2. Add specific test assertions based on expected behavior\n` +
                    `3. Add edge case tests\n` +
                    `4. Run tests with: \`npm test\` or \`npx ${testFramework}\``
                )
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`Test generation failed: ${errorMsg}`)
            ]);
        }
    }

    private analyzeCode(sourceCode: string, filePath: string): CodeAnalysis {
        const analysis: CodeAnalysis = {
            functions: [],
            classes: [],
            imports: [],
            exports: []
        };

        const isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
        const isPython = filePath.endsWith('.py');

        if (isPython) {
            // Python function detection
            const funcRegex = /def\s+(\w+)\s*\(([^)]*)\)/g;
            let match;
            while ((match = funcRegex.exec(sourceCode)) !== null) {
                const params = match[2].split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean);
                analysis.functions.push({
                    name: match[1],
                    params,
                    isAsync: sourceCode.includes(`async def ${match[1]}`)
                });
            }

            // Python class detection
            const classRegex = /class\s+(\w+)(?:\([^)]*\))?:/g;
            while ((match = classRegex.exec(sourceCode)) !== null) {
                const className = match[1];
                const classStart = match.index;
                const classBody = this.extractClassBody(sourceCode, classStart);

                const methods: FunctionInfo[] = [];
                const methodRegex = /def\s+(\w+)\s*\(self[^)]*\)/g;
                let methodMatch;
                while ((methodMatch = methodRegex.exec(classBody)) !== null) {
                    methods.push({
                        name: methodMatch[1],
                        params: [],
                        isAsync: classBody.includes(`async def ${methodMatch[1]}`)
                    });
                }

                analysis.classes.push({ name: className, methods });
            }
        } else {
            // JavaScript/TypeScript function detection
            const funcPatterns = [
                /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
                /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
                /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function\s*\([^)]*\)/g
            ];

            for (const regex of funcPatterns) {
                let match: RegExpExecArray | null;
                while ((match = regex.exec(sourceCode)) !== null) {
                    const params = match[2] ? match[2].split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(Boolean) : [];
                    if (!analysis.functions.find(f => f.name === match![1])) {
                        analysis.functions.push({
                            name: match[1],
                            params,
                            isAsync: match[0].includes('async')
                        });
                    }
                }
            }

            // Class detection
            const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{/g;
            let match;
            while ((match = classRegex.exec(sourceCode)) !== null) {
                const className = match[1];
                const classStart = match.index;
                const classBody = this.extractClassBody(sourceCode, classStart);

                const methods: FunctionInfo[] = [];
                const methodRegex = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|]+)?\s*\{/g;
                let methodMatch;
                while ((methodMatch = methodRegex.exec(classBody)) !== null) {
                    if (!['constructor', 'if', 'for', 'while', 'switch'].includes(methodMatch[1])) {
                        methods.push({
                            name: methodMatch[1],
                            params: [],
                            isAsync: methodMatch[0].includes('async')
                        });
                    }
                }

                analysis.classes.push({ name: className, methods });
            }
        }

        return analysis;
    }

    private extractClassBody(sourceCode: string, startIndex: number): string {
        let braceCount = 0;
        let started = false;
        let endIndex = startIndex;

        for (let i = startIndex; i < sourceCode.length; i++) {
            if (sourceCode[i] === '{') {
                braceCount++;
                started = true;
            } else if (sourceCode[i] === '}') {
                braceCount--;
            }

            if (started && braceCount === 0) {
                endIndex = i;
                break;
            }
        }

        return sourceCode.slice(startIndex, endIndex + 1);
    }

    private generateTestTemplate(
        analysis: CodeAnalysis,
        framework: string,
        testType: string,
        specificFunctions?: string[]
    ): string {
        const functionsToTest = specificFunctions
            ? analysis.functions.filter(f => specificFunctions.includes(f.name))
            : analysis.functions;

        switch (framework) {
            case 'jest':
            case 'vitest':
                return this.generateJestTemplate(analysis, functionsToTest, framework);
            case 'mocha':
                return this.generateMochaTemplate(analysis, functionsToTest);
            case 'pytest':
                return this.generatePytestTemplate(analysis, functionsToTest);
            case 'unittest':
                return this.generateUnittestTemplate(analysis, functionsToTest);
            default:
                return this.generateJestTemplate(analysis, functionsToTest, 'jest');
        }
    }

    private generateJestTemplate(analysis: CodeAnalysis, functions: FunctionInfo[], framework: string): string {
        let template = `import { describe, it, expect, beforeEach, afterEach } from '${framework}';\n`;
        template += `// Import the module to test\n`;
        template += `// import { ${functions.map(f => f.name).join(', ')} } from './module';\n\n`;

        // Generate tests for standalone functions
        if (functions.length > 0) {
            template += `describe('Functions', () => {\n`;
            for (const func of functions) {
                template += `  describe('${func.name}', () => {\n`;
                template += `    it('should handle normal input', ${func.isAsync ? 'async ' : ''}() => {\n`;
                template += `      // Arrange\n`;
                template += `      const input = /* TODO: add test input */;\n\n`;
                template += `      // Act\n`;
                template += `      const result = ${func.isAsync ? 'await ' : ''}${func.name}(input);\n\n`;
                template += `      // Assert\n`;
                template += `      expect(result).toBeDefined();\n`;
                template += `      // TODO: Add specific assertions\n`;
                template += `    });\n\n`;
                template += `    it('should handle edge cases', () => {\n`;
                template += `      // TODO: Add edge case tests\n`;
                template += `    });\n\n`;
                template += `    it('should handle errors', () => {\n`;
                template += `      // TODO: Add error handling tests\n`;
                template += `    });\n`;
                template += `  });\n\n`;
            }
            template += `});\n\n`;
        }

        // Generate tests for classes
        for (const cls of analysis.classes) {
            template += `describe('${cls.name}', () => {\n`;
            template += `  let instance: ${cls.name};\n\n`;
            template += `  beforeEach(() => {\n`;
            template += `    instance = new ${cls.name}(/* constructor args */);\n`;
            template += `  });\n\n`;

            for (const method of cls.methods) {
                template += `  describe('${method.name}', () => {\n`;
                template += `    it('should work correctly', ${method.isAsync ? 'async ' : ''}() => {\n`;
                template += `      const result = ${method.isAsync ? 'await ' : ''}instance.${method.name}();\n`;
                template += `      expect(result).toBeDefined();\n`;
                template += `    });\n`;
                template += `  });\n\n`;
            }
            template += `});\n`;
        }

        return template;
    }

    private generateMochaTemplate(analysis: CodeAnalysis, functions: FunctionInfo[]): string {
        let template = `const { expect } = require('chai');\n`;
        template += `// const { ${functions.map(f => f.name).join(', ')} } = require('./module');\n\n`;

        if (functions.length > 0) {
            template += `describe('Functions', function() {\n`;
            for (const func of functions) {
                template += `  describe('${func.name}', function() {\n`;
                template += `    it('should handle normal input', ${func.isAsync ? 'async ' : ''}function() {\n`;
                template += `      const result = ${func.isAsync ? 'await ' : ''}${func.name}();\n`;
                template += `      expect(result).to.exist;\n`;
                template += `    });\n`;
                template += `  });\n\n`;
            }
            template += `});\n`;
        }

        return template;
    }

    private generatePytestTemplate(analysis: CodeAnalysis, functions: FunctionInfo[]): string {
        let template = `import pytest\n`;
        template += `# from module import ${functions.map(f => f.name).join(', ')}\n\n`;

        for (const func of functions) {
            template += `class Test${this.capitalize(func.name)}:\n`;
            template += `    def test_normal_input(self):\n`;
            template += `        # Arrange\n`;
            template += `        input_data = None  # TODO: add test input\n\n`;
            template += `        # Act\n`;
            template += `        result = ${func.name}(input_data)\n\n`;
            template += `        # Assert\n`;
            template += `        assert result is not None\n\n`;
            template += `    def test_edge_cases(self):\n`;
            template += `        # TODO: Add edge case tests\n`;
            template += `        pass\n\n`;
            template += `    def test_error_handling(self):\n`;
            template += `        # TODO: Add error handling tests\n`;
            template += `        with pytest.raises(Exception):\n`;
            template += `            ${func.name}(None)\n\n`;
        }

        return template;
    }

    private generateUnittestTemplate(analysis: CodeAnalysis, functions: FunctionInfo[]): string {
        let template = `import unittest\n`;
        template += `# from module import ${functions.map(f => f.name).join(', ')}\n\n`;

        template += `class TestFunctions(unittest.TestCase):\n`;
        for (const func of functions) {
            template += `    def test_${func.name}_normal_input(self):\n`;
            template += `        result = ${func.name}()\n`;
            template += `        self.assertIsNotNone(result)\n\n`;
        }

        template += `\nif __name__ == '__main__':\n`;
        template += `    unittest.main()\n`;

        return template;
    }

    private getTestFilePath(sourcePath: string, framework: string): string {
        const parts = sourcePath.split('/');
        const filename = parts.pop() || '';
        const dir = parts.join('/');

        if (framework === 'pytest' || framework === 'unittest') {
            return `${dir}/test_${filename}`;
        }

        const ext = filename.split('.').pop();
        const name = filename.replace(`.${ext}`, '');
        return `${dir}/${name}.test.${ext}`;
    }

    private getTestFileExtension(filePath: string): string {
        if (filePath.endsWith('.py')) return 'python';
        if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
        return 'javascript';
    }

    private capitalize(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
}

interface FunctionInfo {
    name: string;
    params: string[];
    isAsync: boolean;
}

interface ClassInfo {
    name: string;
    methods: FunctionInfo[];
}

interface CodeAnalysis {
    functions: FunctionInfo[];
    classes: ClassInfo[];
    imports: string[];
    exports: string[];
}
