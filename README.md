# TaskAgent - Multi-Agent AI Workflow for VS Code

> v1.0.0 — A multi-agent autonomous workflow system powered by GitHub Copilot.

## ✨ Features

- **Multi-Agent Orchestration** — 8 specialized agents (Developer, Search, Document, Browser, Security, Code Review, Frontend, Multimodal) collaborate to complete complex tasks
- **Automatic Task Decomposition** — LLM breaks down complex requests into subtasks with dependency management
- **Parallel Execution** — Independent subtasks execute concurrently
- **Skills System** — 6 built-in skills + custom user-defined skills
- **Workflow DSL Engine** — JSON-based reusable workflow pipelines (PR Review, Bug Triage, Research Report)
- **Agent Communication Bus** — Direct messaging, delegation, pub/sub between agents
- **ADO Pull Request Creation** — Auto-generate PR title/description from git diff, create PR via Azure DevOps REST API
- **Playwright Frontend Testing** — Automated browser testing with SharePoint auto-login support
- **Token Usage Tracking** — Per-model token usage, estimated cost, hourly charts, call logs
- **MCP Server Integration** — Auto-discover and use external MCP tools (Playwright, GitHub, databases, etc.)
- **Rich Dashboard** — 8-tab Webview dashboard with real-time stats
- **Semantic Memory** — Vector embedding-based memory with semantic search
- **Human-in-the-loop** — Confirmation before critical operations

---

## 📦 Installation

### From Source

```bash
git clone <repo-url>
cd CAgent
npm install
npx playwright install chromium   # Optional: for browser automation / Playwright tests
```

### From VSIX

```bash
code --install-extension taskagent-1.0.0.vsix
```

Or in VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`

### Development

```bash
# Start dev mode (F5 in VS Code)
npm run compile       # One-time compile
npm run watch         # Watch mode
npm run esbuild       # Bundle with esbuild
npx vsce package      # Build .vsix
```

---

## 🚀 Quick Start

1. Press `F5` to launch Extension Development Host
2. Open Copilot Chat (`Ctrl+Shift+I`)
3. Type `@taskagent` followed by your request

---

## 💬 Chat Commands

All commands are invoked via `@taskagent /command` in Copilot Chat.

| Command | Description | Example |
|---------|-------------|---------|
| *(none)* | Auto-detect intent, decompose & orchestrate | `@taskagent Analyze this project and suggest improvements` |
| `/research` | Research a topic and generate a report | `@taskagent /research React 19 new features` |
| `/code` | Write, execute, and debug code | `@taskagent /code Create an Express REST API with auth` |
| `/automate` | Multi-step automated workflows | `@taskagent /automate Search AI papers, summarize top 5, create report` |
| `/roleplay` | Multi-persona discussion | `@taskagent /roleplay Should we use microservices? \| architect, developer, devops` |
| `/review` | Multi-perspective code review (Security, Architecture, QA) | `@taskagent /review Review the auth module` |
| `/ui` | Create & live-preview frontend UI components | `@taskagent /ui Create a dashboard with charts using Tailwind` |
| `/skills` | Manage the skills registry | `@taskagent /skills list` |
| `/workflow` | Run and manage workflow pipelines | `@taskagent /workflow run pr-review-pipeline` |
| `/pr` | Create Azure DevOps Pull Request from current branch | `@taskagent /pr` |
| `/test` | Run Playwright frontend tests on web apps | `@taskagent /test https://contoso.sharepoint.com/sites/mysite` |
| `/ship` | Full pipeline: test changes → auto-fix bugs → create PR | `@taskagent /ship https://mysite.sharepoint.com` |

---

## 🚀 Ship Pipeline (`/ship`)

The `/ship` command runs a complete **Test → Fix → PR** pipeline for your current branch:

```
@taskagent /ship                                    # Run tests + create PR
@taskagent /ship https://contoso.sharepoint.com     # Include Playwright browser test
```

### Pipeline Phases

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Analyze Changes                                    │
│  • git diff to find changed files                            │
│  • Categorize: frontend / backend / test files               │
├─────────────────────────────────────────────────────────────┤
│  Phase 2: Test (up to 3 attempts)                            │
│  • Run project tests (npm test / pytest / tsc --noEmit)      │
│  • Run Playwright smoke test (if URL provided + UI changes)  │
│  • AI code review for critical bugs                          │
├─────────────────────────────────────────────────────────────┤
│  Phase 3: Auto-Fix (if tests fail)                           │
│  • LLM analyzes failures + source code                       │
│  • Generates and applies fixes                               │
│  • Commits fixes, re-runs tests                              │
│  • Repeats up to 3 times                                     │
├─────────────────────────────────────────────────────────────┤
│  Phase 4: Create PR (if all tests pass)                      │
│  • Auto-generate title + description                         │
│  • Create PR on Azure DevOps                                 │
└─────────────────────────────────────────────────────────────┘
```

## 🧩 Skills System

Built-in skills that inject specialized instructions into agent prompts:

| Skill | Tags | Description |
|-------|------|-------------|
| Security Review | `security`, `compliance` | Deep security analysis of code, APIs, and data flows |
| Code Quality | `quality`, `testing` | Code review, testing, and quality assurance |
| Web Research | `research`, `web` | Research topics across the web and generate reports |
| PR Review Pipeline | `pr`, `review` | Automated pull request review from multiple perspectives |
| Documentation Generator | `documentation`, `api-docs` | Auto-generate documentation from code |
| Bug Hunter | `debugging`, `bugs` | Systematic bug detection and analysis |

### Skills Commands

```
@taskagent /skills list                          # List all skills
@taskagent /skills enable security-review        # Enable a skill
@taskagent /skills disable doc-generator         # Disable a skill
@taskagent /skills create my-skill MySkill desc  # Create a custom skill
@taskagent /skills find security                 # Find skills by tag
```

Custom skills are stored in `.taskagent/skills/<skill-id>/SKILL.json`.

---

## 📋 Workflow Engine

JSON-based reusable workflow pipelines with step types: `action`, `parallel`, `conditional`, `loop`, `human-input`, `delay`.

### Built-in Workflows

| Workflow | Steps | Description |
|----------|-------|-------------|
| `pr-review-pipeline` | 4 | Multi-perspective PR review (scan → parallel security/quality/architecture → consolidate) |
| `bug-triage` | 4 | Bug analysis pipeline (search → analyze → suggest fix → generate test) |
| `research-report` | 3 | Research + code examples → compile report |

### Workflow Commands

```
@taskagent /workflow list                  # List all workflows
@taskagent /workflow describe pr-review-pipeline  # Show workflow details
@taskagent /workflow run pr-review-pipeline       # Run a workflow (prompts for inputs)
@taskagent /workflow status                # Show active/completed executions
```

Custom workflows can be saved in `.taskagent/workflows/<workflow-id>.json`.

---

## 🔀 Azure DevOps PR Creation

Automatically create PRs with AI-generated title and description.

### Usage

```
@taskagent /pr                        # Auto-detect everything, create PR
@taskagent /pr to develop             # Target specific branch
@taskagent /pr draft                  # Create as draft PR
@taskagent /pr #1234 #5678           # Link work items
@taskagent /pr draft to main #1234   # Combine options
```

### How It Works

1. **Repo Detection** — Uses VS Code Git API to find the correct repo (supports multi-repo workspaces)
2. **Remote Detection** — Prefers Azure DevOps remotes; prompts if multiple found
3. **Title Generation** — From commit messages or branch name patterns (`feature/xxx`, `bugfix/WORK-1234-xxx`)
4. **Description Generation** — LLM analyzes git diff to write Summary, Changes, Testing, Notes sections
5. **ADO REST API** — Creates PR, links work items, adds reviewers, sets auto-complete

### Configuration

| Setting | Description |
|---------|-------------|
| `taskagent.adoPat` | Azure DevOps Personal Access Token (needs `Code Read & Write` scope) |

Or set environment variable: `AZURE_DEVOPS_PAT`

---

## 🧪 Playwright Frontend Testing

Automated browser testing with Microsoft AAD auto-login support.

### Usage

```
@taskagent /test https://contoso.sharepoint.com/sites/mysite              # Smoke test (default)
@taskagent /test https://contoso.sharepoint.com/sites/mysite navigation   # Test navigation links
@taskagent /test https://contoso.sharepoint.com/sites/mysite crud         # Test CRUD operations
@taskagent /test https://myapp.azurewebsites.net headless                 # Run in headless mode
```

### Test Scenarios

| Scenario | What It Tests |
|----------|---------------|
| `smoke` | Page load, console errors, content verification, navigation elements, performance metrics |
| `navigation` | Discover nav links and click through each one |
| `crud` | Detect SharePoint lists, find "+ New" / Edit buttons |
| `custom` | Custom steps: `goto`, `click`, `fill`, `wait`, `assert text`, `assert url` |

### Configuration

| Setting | Description |
|---------|-------------|
| `taskagent.sharePointUsername` | Microsoft 365 email for auto-login |
| `taskagent.sharePointPassword` | Microsoft 365 password |
| `taskagent.sharePointSiteUrl` | Default test site URL |

---

## � MCP Server Integration

TaskAgent automatically discovers and uses tools from MCP servers you configure in VS Code. Agents intelligently select relevant MCP tools based on the task.

### How It Works

1. Configure MCP servers in `.vscode/mcp.json` or via `Ctrl+Shift+P` → `MCP: Add Server`
2. TaskAgent auto-discovers all available tools (own + MCP + other extensions)
3. When the Orchestrator assigns tasks, it matches relevant tools to each agent
4. Agents can call MCP tools during execution (with multi-round tool calling support)

### Example: Add Playwright MCP Server

```json
// .vscode/mcp.json
{
  "servers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@microsoft/mcp-server-playwright"]
    }
  }
}
```

Now `@taskagent /automate Open my site, take a screenshot, and check for errors` will automatically use Playwright MCP tools.

### Example: Add GitHub MCP Server

```json
{
  "servers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp"
    }
  }
}
```

### Dashboard

The **🔌 Tools & MCP** tab in the Dashboard shows all discovered tools grouped by source (TaskAgent / MCP / Extension), with MCP server names, tags, and descriptions.

---

## 🛠️ Language Model Tools (20+ built-in)

These tools are available to the AI agents and can also be referenced in prompts via `#toolName`.

### Code Execution

| Tool | Reference | Description |
|------|-----------|-------------|
| `taskagent_executeCode` | `#executeCode` | Execute shell, Python, JavaScript, TypeScript code |

### Web & Search

| Tool | Reference | Description |
|------|-----------|-------------|
| `taskagent_webSearch` | `#webSearch` | Search the web (Tavily / DuckDuckGo fallback) |
| `taskagent_browseWebpage` | `#browseWebpage` | Browse a webpage and extract content |
| `taskagent_githubSearch` | `#githubSearch` | Search GitHub repos, code, and issues |
| `taskagent_stackOverflow` | `#stackOverflow` | Search Stack Overflow |

### File & Code Operations

| Tool | Reference | Description |
|------|-----------|-------------|
| `taskagent_codeSearch` | `#codeSearch` | Search text/regex in workspace code |
| `taskagent_findFiles` | `#findFiles` | Find files by glob pattern |
| `taskagent_readFile` | `#readFile` | Read file contents |
| `taskagent_getSymbols` | `#getSymbols` | Get functions, classes, methods from a file |
| `taskagent_createDocument` | `#createDocument` | Create documents (Markdown, JSON, HTML, TXT) |

### Inter-Agent Communication

| Tool | Reference | Description |
|------|-----------|-------------|
| `taskagent_writeNote` | `#writeNote` | Write notes for other agents |
| `taskagent_readNote` | `#readNote` | Read notes from other agents |
| `taskagent_humanInput` | `#humanInput` | Request user input (human-in-the-loop) |

### Security & Quality

| Tool | Reference | Description |
|------|-----------|-------------|
| `taskagent_securityReview` | `#securityReview` | Generate security review document |
| `taskagent_analyzeScenario` | `#analyzeScenario` | Deep scenario security analysis (multi-file, call chains) |
| `taskagent_codeReview` | `#codeReview` | Automated code review |
| `taskagent_generateTests` | `#generateTests` | Generate unit tests |

### Frontend & DevOps

| Tool | Reference | Description |
|------|-----------|-------------|
| `taskagent_previewUI` | `#previewUI` | Live preview HTML/CSS/JS in webview |
| `taskagent_adoPullRequest` | `#adoPullRequest` | Create Azure DevOps Pull Request |
| `taskagent_playwrightTest` | `#playwrightTest` | Run Playwright browser tests |

---

## 🤖 Agents

| Agent | ID | Specialization |
|-------|----|---------------|
| Developer | `developer` | Write, execute, debug code |
| Search | `search` | Web/GitHub/StackOverflow search |
| Document | `document` | Reports, notes, documentation |
| Browser | `browser` | Web browsing, content extraction |
| Multimodal | `multimodal` | Images, audio, multi-modal content |
| Code Review | `codereview` | Code quality review |
| Security | `security` | Security analysis, vulnerability scanning |
| Frontend | `frontend` | UI components, live preview |

---

## 📊 Dashboard

Open via: `Ctrl+Shift+P` → `TaskAgent: Open Workflow Dashboard`

7 tabs with real-time data:

| Tab | Content |
|-----|---------|
| 📋 Tasks | Task list with status, progress, subtasks |
| 🤖 Agents | Agent status, tools count, descriptions |
| 🧩 Skills | Skills with enable/disable toggles |
| 📋 Workflows | Workflow templates + execution history |
| 💬 Messages | Agent communication log |
| 📊 Token Usage | Per-model tokens, cost, hourly chart, call log |
| 🧠 Memory | Short-term, long-term, conversation memory stats |

---

## ⚙️ Configuration

All settings are under `taskagent.*` in VS Code Settings (`Ctrl+,`):

| Setting | Required | Description |
|---------|----------|-------------|
| `taskagent.tavilyApiKey` | Optional | Tavily API key for web search ([get free key](https://tavily.com)) |
| `taskagent.githubToken` | Optional | GitHub PAT for higher API rate limits |
| `taskagent.adoPat` | For `/pr` | Azure DevOps PAT with `Code (Read & Write)` scope |
| `taskagent.sharePointUsername` | For `/test` | Microsoft 365 email for Playwright auto-login |
| `taskagent.sharePointPassword` | For `/test` | Microsoft 365 password |
| `taskagent.sharePointSiteUrl` | For `/test` | Default SharePoint site URL |

---

## 📁 VS Code Commands

| Command | Description |
|---------|-------------|
| `TaskAgent: Start Backend Server` | Start the backend server (auto-starts on activation) |
| `TaskAgent: Stop Backend Server` | Stop the backend server |
| `TaskAgent: Open Workflow Dashboard` | Open the rich dashboard webview |

---

## 📁 Project Structure

```
src/
├── extension.ts              # Extension entry point
├── core/
│   ├── orchestrator.ts       # Task decomposition & multi-agent execution
│   ├── agentRegistry.ts      # Agent registration & management
│   ├── taskManager.ts        # Task lifecycle & TreeDataProvider
│   ├── skillRegistry.ts      # Pluggable skills system
│   ├── workflowEngine.ts     # JSON workflow DSL engine
│   ├── agentBus.ts           # Agent inter-communication bus
│   ├── usageTracker.ts       # LLM token usage tracking
│   ├── memory.ts             # Stateful memory with semantic search
│   ├── embedding.ts          # Vector embedding service
│   ├── rolePlay.ts           # Multi-persona role-play engine
│   ├── dataGenerator.ts      # Training data generation
│   └── feedback.ts           # Feedback collection
├── participant/
│   └── workforce.ts          # Chat participant (all /commands)
├── ui/
│   └── dashboard.ts          # Rich Webview dashboard
├── tools/                    # 20 Language Model Tools
│   ├── adoPullRequest.ts     # ADO PR creation
│   ├── playwrightTest.ts     # Playwright browser testing
│   ├── executeCode.ts        # Code execution
│   ├── webSearch.ts          # Web search
│   ├── codeSearch.ts         # Code/file/symbol search
│   ├── securityReview.ts     # Security review
│   ├── scenarioSecurityAnalyzer.ts
│   ├── codeReview.ts         # Code review
│   ├── testGenerator.ts      # Test generation
│   ├── previewUI.ts          # UI live preview
│   └── ...
├── server/
│   └── backendServer.ts      # Express backend for browser automation
└── prompts/
    └── systemPrompts.ts      # System prompts for agents
```

---

## 📄 License

MIT