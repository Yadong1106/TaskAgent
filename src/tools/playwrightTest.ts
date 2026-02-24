import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ===== Interfaces =====

export interface PlaywrightTestInput {
    /** SharePoint site URL to test */
    siteUrl: string;
    /** Test scenario: 'smoke' | 'navigation' | 'crud' | 'custom' */
    scenario?: string;
    /** Custom test steps (for 'custom' scenario) */
    customSteps?: string[];
    /** Username for login (or from config) */
    username?: string;
    /** Password for login (or from config) */
    password?: string;
    /** Take screenshots at each step */
    screenshots?: boolean;
    /** Headless mode */
    headless?: boolean;
    /** Timeout per step in ms */
    timeout?: number;
}

interface TestStepResult {
    step: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    screenshot?: string;
    error?: string;
}

interface PlaywrightTestResult {
    siteUrl: string;
    scenario: string;
    totalSteps: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
    steps: TestStepResult[];
    screenshotDir?: string;
}

// ===== Playwright Frontend Test Tool =====

/**
 * PlaywrightTestTool - Automated frontend testing with Playwright
 *
 * Features:
 * - Launch a real browser (Chromium/Edge)
 * - Navigate to SharePoint or any web app
 * - Auto-login with configured credentials (supports AAD login)
 * - Built-in test scenarios: smoke, navigation, CRUD
 * - Custom step-by-step testing
 * - Screenshot capture at each step
 * - Detailed test report
 */
export class PlaywrightTestTool implements vscode.LanguageModelTool<PlaywrightTestInput> {

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<PlaywrightTestInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.PreparedToolInvocation> {
        const input = options.input;
        return {
            invocationMessage: `Running Playwright test on ${input.siteUrl}...`,
            confirmationMessages: {
                title: 'Run Playwright Frontend Test',
                message: new vscode.MarkdownString(
                    `**Site:** ${input.siteUrl}\n\n` +
                    `**Scenario:** ${input.scenario || 'smoke'}\n\n` +
                    `**Headless:** ${input.headless !== false ? 'Yes' : 'No (visible browser)'}\n\n` +
                    `**Screenshots:** ${input.screenshots !== false ? 'Yes' : 'No'}\n\n` +
                    `⚠️ This will launch a browser and navigate to the specified site.\n\n` +
                    `Do you want to proceed?`
                )
            }
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<PlaywrightTestInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const input = options.input;
        const scenario = input.scenario || 'smoke';
        const headless = input.headless !== undefined ? input.headless : false;
        const screenshots = input.screenshots !== false;
        const timeout = input.timeout || 30000;

        // Resolve credentials
        const config = vscode.workspace.getConfiguration('taskagent');
        const username = input.username || config.get<string>('sharePointUsername') || '';
        const password = input.password || config.get<string>('sharePointPassword') || '';

        // Prepare screenshot directory
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const screenshotDir = workspaceRoot
            ? path.join(workspaceRoot, '.taskagent', 'screenshots', `test_${Date.now()}`)
            : undefined;
        if (screenshotDir && !fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }

        try {
            // Dynamic import Playwright (it's already in dependencies)
            let chromium: any;
            try {
                const pw = require('playwright');
                chromium = pw.chromium;
            } catch {
                throw new Error(
                    'Playwright not available. Run `npx playwright install chromium` to install browsers.'
                );
            }

            const result = await this.runTests(
                chromium, input.siteUrl, scenario, username, password,
                headless, screenshots, timeout, screenshotDir, input.customSteps
            );

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(this.formatReport(result))
            ]);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`❌ Playwright test failed: ${errorMsg}`)
            ]);
        }
    }

    // ===== Test Execution =====

    private async runTests(
        chromium: any,
        siteUrl: string,
        scenario: string,
        username: string,
        password: string,
        headless: boolean,
        screenshots: boolean,
        timeout: number,
        screenshotDir?: string,
        customSteps?: string[]
    ): Promise<PlaywrightTestResult> {
        const startTime = Date.now();
        const steps: TestStepResult[] = [];

        // Launch browser
        const browser = await chromium.launch({
            headless,
            channel: 'msedge', // Prefer Edge for SharePoint compatibility
            args: ['--start-maximized']
        });

        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            ignoreHTTPSErrors: true
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);

        try {
            // Step 1: Navigate to site
            await this.runStep(steps, 'Navigate to site', async () => {
                await page.goto(siteUrl, { waitUntil: 'networkidle' });
                return page.title();
            }, page, screenshots, screenshotDir);

            // Step 2: Login if credentials provided
            if (username && password) {
                await this.runStep(steps, 'Login - Enter username', async () => {
                    // Microsoft / AAD login flow
                    await this.handleMicrosoftLogin(page, username, password, timeout);
                    return 'Login completed';
                }, page, screenshots, screenshotDir);

                // Step 3: Wait for site to load after login
                await this.runStep(steps, 'Wait for site load after login', async () => {
                    await page.waitForLoadState('networkidle');
                    // Wait a bit more for SharePoint to fully render
                    await page.waitForTimeout(3000);
                    return await page.title();
                }, page, screenshots, screenshotDir);
            }

            // Run scenario-specific steps
            switch (scenario) {
                case 'smoke':
                    await this.runSmokeTest(page, steps, screenshots, screenshotDir, siteUrl);
                    break;
                case 'navigation':
                    await this.runNavigationTest(page, steps, screenshots, screenshotDir);
                    break;
                case 'crud':
                    await this.runCrudTest(page, steps, screenshots, screenshotDir);
                    break;
                case 'custom':
                    if (customSteps?.length) {
                        await this.runCustomSteps(page, steps, customSteps, screenshots, screenshotDir);
                    }
                    break;
            }

        } finally {
            // Final screenshot
            if (screenshots && screenshotDir) {
                try {
                    await page.screenshot({ path: path.join(screenshotDir, 'final.png'), fullPage: true });
                } catch { /* ignore */ }
            }
            await browser.close();
        }

        const passed = steps.filter(s => s.status === 'passed').length;
        const failed = steps.filter(s => s.status === 'failed').length;
        const skipped = steps.filter(s => s.status === 'skipped').length;

        return {
            siteUrl,
            scenario,
            totalSteps: steps.length,
            passed,
            failed,
            skipped,
            duration: Date.now() - startTime,
            steps,
            screenshotDir
        };
    }

    // ===== Microsoft AAD Login Handler =====

    private async handleMicrosoftLogin(page: any, username: string, password: string, timeout: number) {
        // Wait for login page - could be various forms
        try {
            // AAD login: wait for email input
            const emailInput = await page.waitForSelector(
                'input[type="email"], input[name="loginfmt"], #i0116',
                { timeout: 10000 }
            );
            
            if (emailInput) {
                await emailInput.fill(username);
                await page.click('input[type="submit"], #idSIButton9');
                await page.waitForTimeout(2000);
            }

            // Password page
            const passwordInput = await page.waitForSelector(
                'input[type="password"], input[name="passwd"], #i0118, #passwordInput',
                { timeout: 10000 }
            );
            
            if (passwordInput) {
                await passwordInput.fill(password);
                await page.click('input[type="submit"], #idSIButton9, span[id="submitButton"]');
                await page.waitForTimeout(2000);
            }

            // "Stay signed in?" prompt
            try {
                const staySignedIn = await page.waitForSelector(
                    '#idSIButton9, input[value="Yes"]',
                    { timeout: 5000 }
                );
                if (staySignedIn) {
                    await staySignedIn.click();
                }
            } catch {
                // No "stay signed in" prompt - that's fine
            }

            // Wait for redirect back to the site
            await page.waitForLoadState('networkidle');

        } catch (error) {
            // If we're already on the site (no login needed), that's fine
            const currentUrl = page.url();
            if (!currentUrl.includes('login') && !currentUrl.includes('microsoftonline')) {
                return; // Already logged in
            }
            throw error;
        }
    }

    // ===== Test Scenarios =====

    private async runSmokeTest(
        page: any, steps: TestStepResult[],
        screenshots: boolean, screenshotDir?: string, siteUrl?: string
    ) {
        // Check page loaded
        await this.runStep(steps, 'Verify page title exists', async () => {
            const title = await page.title();
            if (!title) throw new Error('Page has no title');
            return `Title: ${title}`;
        }, page, screenshots, screenshotDir);

        // Check for errors in console
        await this.runStep(steps, 'Check for console errors', async () => {
            const errors: string[] = [];
            page.on('console', (msg: any) => {
                if (msg.type() === 'error') errors.push(msg.text());
            });
            await page.waitForTimeout(2000);
            if (errors.length > 0) {
                return `⚠️ Found ${errors.length} console errors: ${errors.slice(0, 3).join('; ')}`;
            }
            return 'No console errors detected';
        }, page, screenshots, screenshotDir);

        // Check main content area
        await this.runStep(steps, 'Verify main content loads', async () => {
            const body = await page.textContent('body');
            if (!body || body.length < 50) throw new Error('Page body is empty or too short');
            return `Page content length: ${body.length} chars`;
        }, page, screenshots, screenshotDir);

        // Check critical elements
        await this.runStep(steps, 'Check for navigation elements', async () => {
            const navSelectors = ['nav', '[role="navigation"]', '.ms-Nav', '#SuiteNavPlaceHolder'];
            for (const sel of navSelectors) {
                const el = await page.$(sel);
                if (el) return `Found navigation element: ${sel}`;
            }
            return 'No standard navigation elements found (may be SPA)';
        }, page, screenshots, screenshotDir);

        // Performance check
        await this.runStep(steps, 'Performance - page load metrics', async () => {
            const metrics = await page.evaluate(() => {
                const perf = (globalThis as any).performance;
                const timing = perf.getEntriesByType('navigation')[0] as any;
                return {
                    domContentLoaded: Math.round(timing.domContentLoadedEventEnd - timing.startTime),
                    loadComplete: Math.round(timing.loadEventEnd - timing.startTime),
                    domInteractive: Math.round(timing.domInteractive - timing.startTime)
                };
            });
            return `DOM Interactive: ${metrics.domInteractive}ms, DOMContentLoaded: ${metrics.domContentLoaded}ms, Load: ${metrics.loadComplete}ms`;
        }, page, screenshots, screenshotDir);
    }

    private async runNavigationTest(
        page: any, steps: TestStepResult[],
        screenshots: boolean, screenshotDir?: string
    ) {
        // Find all navigation links
        await this.runStep(steps, 'Discover navigation links', async () => {
            const links = await page.$$eval('nav a, [role="navigation"] a', (els: any[]) =>
                els.slice(0, 10).map((a: any) => ({ text: a.textContent?.trim(), href: a.href }))
            );
            return `Found ${links.length} nav links: ${links.map((l: any) => l.text).join(', ')}`;
        }, page, screenshots, screenshotDir);

        // Click through first few nav items
        const navLinks = await page.$$('nav a, [role="navigation"] a');
        const maxLinks = Math.min(navLinks.length, 5);

        for (let i = 0; i < maxLinks; i++) {
            await this.runStep(steps, `Navigate to link ${i + 1}`, async () => {
                const link = navLinks[i];
                const text = await link.textContent();
                await link.click();
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(1000);
                const title = await page.title();
                return `Clicked "${text?.trim()}" → Page: ${title}`;
            }, page, screenshots, screenshotDir);
        }

        // Go back to original page
        await this.runStep(steps, 'Navigate back to home', async () => {
            await page.goBack();
            await page.waitForLoadState('networkidle');
            return `Returned to: ${await page.title()}`;
        }, page, screenshots, screenshotDir);
    }

    private async runCrudTest(
        page: any, steps: TestStepResult[],
        screenshots: boolean, screenshotDir?: string
    ) {
        // Look for SharePoint list/library patterns
        await this.runStep(steps, 'Detect SharePoint lists/libraries', async () => {
            const lists = await page.$$('[data-automationid="ListCell"], .ms-List-cell, [role="row"]');
            return `Found ${lists.length} list items/rows on page`;
        }, page, screenshots, screenshotDir);

        // Try to find "+ New" button
        await this.runStep(steps, 'Look for create (+ New) button', async () => {
            const newBtnSelectors = [
                'button:has-text("New")',
                '[data-automationid="newCommand"]',
                'button[name="New"]',
                '.ms-CommandBar button:first-child'
            ];
            for (const sel of newBtnSelectors) {
                const btn = await page.$(sel);
                if (btn) {
                    const text = await btn.textContent();
                    return `Found create button: "${text?.trim()}"`;
                }
            }
            return 'No "+ New" button found on this page';
        }, page, screenshots, screenshotDir);

        // Check for edit capabilities
        await this.runStep(steps, 'Check edit capabilities', async () => {
            const editSelectors = [
                'button:has-text("Edit")',
                '[data-automationid="editCommand"]',
                '.ms-ContextualMenu-link'
            ];
            for (const sel of editSelectors) {
                const btn = await page.$(sel);
                if (btn) return `Found edit capability: ${sel}`;
            }
            return 'No edit buttons found';
        }, page, screenshots, screenshotDir);
    }

    private async runCustomSteps(
        page: any, steps: TestStepResult[],
        customSteps: string[],
        screenshots: boolean, screenshotDir?: string
    ) {
        for (const stepDesc of customSteps) {
            await this.runStep(steps, stepDesc, async () => {
                // Parse simple commands from step description
                const lower = stepDesc.toLowerCase();

                if (lower.startsWith('goto ') || lower.startsWith('navigate ')) {
                    const url = stepDesc.split(/\s+/).slice(1).join(' ');
                    await page.goto(url, { waitUntil: 'networkidle' });
                    return `Navigated to: ${url}`;
                }

                if (lower.startsWith('click ')) {
                    const selector = stepDesc.split(/\s+/).slice(1).join(' ');
                    await page.click(selector);
                    await page.waitForTimeout(1000);
                    return `Clicked: ${selector}`;
                }

                if (lower.startsWith('fill ')) {
                    const parts = stepDesc.split(/\s+/).slice(1);
                    const selector = parts[0];
                    const value = parts.slice(1).join(' ');
                    await page.fill(selector, value);
                    return `Filled ${selector} with value`;
                }

                if (lower.startsWith('wait ')) {
                    const ms = parseInt(stepDesc.split(/\s+/)[1]) || 2000;
                    await page.waitForTimeout(ms);
                    return `Waited ${ms}ms`;
                }

                if (lower.startsWith('assert text ')) {
                    const text = stepDesc.replace(/^assert text\s+/i, '');
                    const body = await page.textContent('body');
                    if (body?.includes(text)) {
                        return `✅ Found text: "${text}"`;
                    }
                    throw new Error(`Text not found: "${text}"`);
                }

                if (lower.startsWith('assert url ')) {
                    const expected = stepDesc.replace(/^assert url\s+/i, '');
                    const current = page.url();
                    if (current.includes(expected)) {
                        return `✅ URL matches: ${current}`;
                    }
                    throw new Error(`URL mismatch. Expected: ${expected}, Got: ${current}`);
                }

                return `Step executed (no action parsed): ${stepDesc}`;
            }, page, screenshots, screenshotDir);
        }
    }

    // ===== Step Runner Helper =====

    private async runStep(
        steps: TestStepResult[],
        name: string,
        action: () => Promise<string>,
        page: any,
        screenshots: boolean,
        screenshotDir?: string
    ) {
        const start = Date.now();
        try {
            const output = await action();
            const result: TestStepResult = {
                step: name,
                status: 'passed',
                duration: Date.now() - start
            };

            // Take screenshot
            if (screenshots && screenshotDir && page) {
                try {
                    const filename = `step_${steps.length + 1}_${name.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.png`;
                    const screenshotPath = path.join(screenshotDir, filename);
                    await page.screenshot({ path: screenshotPath });
                    result.screenshot = screenshotPath;
                } catch { /* screenshot failed, non-critical */ }
            }

            steps.push(result);
            return output;
        } catch (error) {
            const result: TestStepResult = {
                step: name,
                status: 'failed',
                duration: Date.now() - start,
                error: error instanceof Error ? error.message : String(error)
            };

            // Take error screenshot
            if (screenshots && screenshotDir && page) {
                try {
                    const filename = `step_${steps.length + 1}_ERROR_${name.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}.png`;
                    const screenshotPath = path.join(screenshotDir, filename);
                    await page.screenshot({ path: screenshotPath });
                    result.screenshot = screenshotPath;
                } catch { /* ignore */ }
            }

            steps.push(result);
            return '';
        }
    }

    // ===== Report Formatting =====

    private formatReport(result: PlaywrightTestResult): string {
        const statusIcon = result.failed === 0 ? '✅' : '❌';
        const durationSec = (result.duration / 1000).toFixed(1);

        const lines = [
            `${statusIcon} **Playwright Test Report**`,
            ``,
            `| Field | Value |`,
            `|-------|-------|`,
            `| **Site** | ${result.siteUrl} |`,
            `| **Scenario** | ${result.scenario} |`,
            `| **Duration** | ${durationSec}s |`,
            `| **Passed** | ${result.passed}/${result.totalSteps} |`,
            `| **Failed** | ${result.failed} |`,
            `| **Skipped** | ${result.skipped} |`,
            ``
        ];

        if (result.screenshotDir) {
            lines.push(`📸 Screenshots saved to: \`${result.screenshotDir}\`\n`);
        }

        lines.push(`### Step Results\n`);

        for (const step of result.steps) {
            const icon = step.status === 'passed' ? '✅' : step.status === 'failed' ? '❌' : '⏭️';
            const dur = (step.duration / 1000).toFixed(1);
            lines.push(`${icon} **${step.step}** (${dur}s)`);
            if (step.error) {
                lines.push(`   ⚠️ ${step.error}`);
            }
        }

        return lines.join('\n');
    }
}
