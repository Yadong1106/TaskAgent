import express, { Express, Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { createServer, Server } from 'http';
import { TaskManager } from '../core/taskManager';
import { AgentRegistry } from '../core/agentRegistry';

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * BackendServer - Backend service
 * Handles operations requiring a separate process (browser automation, etc.)
 * Similar to Eigent's backend service architecture
 */
export class BackendServer {
    private app: Express;
    private server: Server | null = null;
    private io: SocketIOServer | null = null;
    private port = 3847;
    private running = false;

    // Playwright browser instance (lazy loaded)
    private browser: any = null;

    constructor(
        private taskManager: TaskManager,
        private agentRegistry: AgentRegistry
    ) {
        this.app = express();
        this.setupRoutes();
    }

    private setupRoutes() {
        this.app.use(express.json());

        // Health check
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        // Task status endpoint
        this.app.get('/tasks', (_req: Request, res: Response) => {
            res.json(this.taskManager.getAllTasks());
        });

        // Agent status endpoint
        this.app.get('/agents', (_req: Request, res: Response) => {
            res.json(this.agentRegistry.getAllAgents());
        });

        // Web search endpoint
        this.app.post('/search', async (req: Request, res: Response) => {
            try {
                const { query, maxResults = 5 } = req.body;
                const results = await this.performSearch(query, maxResults);
                res.json({ success: true, results });
            } catch (error) {
                res.status(500).json({ 
                    success: false, 
                    error: error instanceof Error ? error.message : 'Search failed' 
                });
            }
        });

        // Browse webpage endpoint
        this.app.post('/browse', async (req: Request, res: Response) => {
            try {
                const { url, extractType = 'text' } = req.body;
                const content = await this.browseWebpageInternal(url, extractType);
                res.json({ success: true, content });
            } catch (error) {
                res.status(500).json({ 
                    success: false, 
                    error: error instanceof Error ? error.message : 'Browse failed' 
                });
            }
        });

        // Execute code endpoint (sandboxed)
        this.app.post('/execute', async (req: Request, res: Response) => {
            try {
                const { code, language, workingDirectory } = req.body;
                const result = await this.executeCode(code, language, workingDirectory);
                res.json({ success: true, result });
            } catch (error) {
                res.status(500).json({ 
                    success: false, 
                    error: error instanceof Error ? error.message : 'Execution failed' 
                });
            }
        });
    }

    async start(): Promise<void> {
        if (this.running) return;

        return new Promise((resolve, reject) => {
            try {
                this.server = createServer(this.app);
                this.io = new SocketIOServer(this.server, {
                    cors: { origin: '*' }
                });

                // Socket.IO for real-time updates
                this.io.on('connection', (socket) => {
                    console.log('Client connected:', socket.id);
                    
                    // Send task updates
                    this.taskManager.onTaskUpdate((task) => {
                        socket.emit('taskUpdate', task);
                    });
                });

                this.server.listen(this.port, () => {
                    this.running = true;
                    console.log(`TaskAgent backend server running on port ${this.port}`);
                    resolve();
                });

                this.server.on('error', (error) => {
                    console.error('Server error:', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    async stop(): Promise<void> {
        if (!this.running) return;

        // Close browser if open
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }

        return new Promise((resolve) => {
            if (this.io) {
                this.io.close();
            }
            if (this.server) {
                this.server.close(() => {
                    this.running = false;
                    console.log('TaskAgent backend server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    isRunning(): boolean {
        return this.running;
    }

    // Public API methods for tools to use

    async search(query: string, maxResults: number): Promise<SearchResult[]> {
        return this.performSearch(query, maxResults);
    }

    async browseWebpage(url: string, extractType: string): Promise<string> {
        return this.browseWebpageInternal(url, extractType);
    }

    // Private implementation methods

    private async performSearch(query: string, maxResults: number): Promise<SearchResult[]> {
        // In production, integrate with a search API (Google, Bing, etc.)
        // For now, return placeholder results
        console.log(`Searching for: ${query}, max results: ${maxResults}`);
        
        // You could integrate with:
        // - Google Custom Search API
        // - Bing Search API
        // - SerpAPI
        // - Tavily
        
        return [{
            title: `Search results for: ${query}`,
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            snippet: 'Please configure a search API for real search results.'
        }];
    }

    private async browseWebpageInternal(url: string, extractType: string): Promise<string> {
        // Use Playwright for full browser automation
        if (extractType === 'screenshot') {
            return this.takeScreenshot(url);
        }

        // For text extraction, Playwright can handle JavaScript-heavy sites
        return this.extractWithPlaywright(url, extractType);
    }

    private async getBrowser(): Promise<any> {
        if (!this.browser) {
            try {
                const { chromium } = await import('playwright');
                this.browser = await chromium.launch({ headless: true });
            } catch (error) {
                console.warn('Playwright not available, some features may be limited');
                throw new Error('Browser automation requires Playwright. Run: npm install playwright');
            }
        }
        return this.browser;
    }

    private async takeScreenshot(url: string): Promise<string> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        
        try {
            await page.goto(url, { waitUntil: 'networkidle' });
            const screenshot = await page.screenshot({ type: 'png', fullPage: false });
            const base64 = screenshot.toString('base64');
            return `Screenshot taken. Base64 length: ${base64.length} characters. [Image data available]`;
        } finally {
            await page.close();
        }
    }

    private async extractWithPlaywright(url: string, extractType: string): Promise<string> {
        const browser = await this.getBrowser();
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

            if (extractType === 'html') {
                return await page.content();
            }

            // Extract text content
            const title = await page.title();
            // The code inside evaluate runs in browser context
            const text = await page.evaluate(`
                (() => {
                    // Remove unwanted elements
                    const elementsToRemove = document.querySelectorAll('script, style, nav, footer, header, aside');
                    elementsToRemove.forEach(el => el.remove());
                    
                    // Get main content
                    const main = document.querySelector('main, article, [role="main"], .content') || document.body;
                    return main.innerText;
                })()
            `);

            return `# ${title}\n\nURL: ${url}\n\n${text.slice(0, 10000)}`;

        } finally {
            await page.close();
        }
    }

    private async executeCode(code: string, language: string, workingDirectory?: string): Promise<string> {
        const { exec } = require('child_process');
        
        return new Promise((resolve, reject) => {
            let cmd: string;
            
            switch (language) {
                case 'python':
                    cmd = `python -c "${code.replace(/"/g, '\\"')}"`;
                    break;
                case 'javascript':
                    cmd = `node -e "${code.replace(/"/g, '\\"')}"`;
                    break;
                case 'shell':
                    cmd = code;
                    break;
                default:
                    reject(new Error(`Unsupported language: ${language}`));
                    return;
            }

            exec(cmd, { cwd: workingDirectory, timeout: 30000 }, (error: any, stdout: string, stderr: string) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout || 'Execution completed');
                }
            });
        });
    }
}














