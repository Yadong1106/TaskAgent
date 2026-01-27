# TaskAgent - Multi-Agent Workflow for VS Code

A multi-agent autonomous workflow system powered by GitHub Copilot, inspired by [Eigent](https://github.com/eigent-ai/eigent) and [CAMEL-AI](https://github.com/camel-ai/camel).

## Features

### Core Capabilities
- **Multi-Agent Collaboration**: Developer, Search, Document, Browser, Security, Git, Financial, and other specialized agents
- **Automatic Task Decomposition**: Uses LLM to break down complex tasks into subtasks
- **Parallel Execution**: Independent subtasks execute in parallel
- **Human-in-the-loop**: Requests user confirmation before critical operations
- **Deep VS Code Integration**: Leverages GitHub Copilot API

### Advanced Features (CAMEL-inspired)
- **Agent Consensus Voting**: Multiple agents analyze topics and reach consensus
- **Self-Reflection Loop**: Iterative critique and improvement of responses
- **Conversation Compression**: Automatic compression of long conversation history
- **Task Priority Queue**: Priority-based task scheduling with deadlines
- **Agent Performance Analytics**: Track and analyze agent performance metrics
- **Role-Playing Sessions**: Multi-persona discussions on topics
- **Task Templates**: Reusable workflow templates

## Installation

```bash
cd TaskAgent
npm install
npx playwright install chromium  # Optional, for browser automation
```

## Usage

1. Press `F5` to start debugging
2. Open Copilot Chat (`Ctrl+Shift+I`)
3. Use `@taskagent` to invoke TaskAgent

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/research` | Research a topic and generate a report | `/research Vue vs React 2024` |
| `/code` | Write, execute and debug code | `/code Create an Express API` |
| `/automate` | Automate complex multi-step tasks | `/automate Search AI papers and summarize` |
| `/roleplay` | Multi-persona discussion | `/roleplay security design \| architect, developer, security_expert` |
| `/review` | Multi-perspective code review | `/review` (with code selected) |
| `/ui` | Create and preview frontend UI | `/ui Create a login form` |
| `/template` | Manage workflow templates | `/template list` |
| `/consensus` | Multi-agent voting/consensus | `/consensus Should we use React or Vue?` |
| `/reflect` | Self-reflection task execution | `/reflect Write a sorting algorithm \| iterations=3` |
| `/analytics` | Agent performance dashboard | `/analytics recent` |

## Tools

### Code & Execution
| Tool | Description |
|------|-------------|
| `taskagent_executeCode` | Execute code and terminal commands |
| `taskagent_codeSearch` | Search code in the workspace |
| `taskagent_findFiles` | Find files by name/pattern |
| `taskagent_readFile` | Read file contents |
| `taskagent_getSymbols` | Get symbols from a file |
| `taskagent_generateTests` | Generate unit tests |
| `taskagent_codeReview` | Automated code review |

### Web & Search
| Tool | Description |
|------|-------------|
| `taskagent_webSearch` | Web search |
| `taskagent_browseWebpage` | Browse webpages and extract content |
| `taskagent_githubSearch` | Search GitHub for code/repos/issues |
| `taskagent_stackOverflow` | Search Stack Overflow |

### Documents & Notes
| Tool | Description |
|------|-------------|
| `taskagent_createDocument` | Create and manage documents |
| `taskagent_writeNote` | Write notes for inter-agent communication |
| `taskagent_readNote` | Read notes from other agents |
| `taskagent_humanInput` | Request user input |

### Security
| Tool | Description |
|------|-------------|
| `taskagent_securityReview` | Generate security review documents |
| `taskagent_analyzeScenario` | Deep scenario security analysis |

### Git Operations
| Tool | Description |
|------|-------------|
| `taskagent_gitOperations` | Git version control (commit, branch, merge, etc.) |

### Financial Analysis
| Tool | Description |
|------|-------------|
| `taskagent_financialAnalysis` | Stock market and economic analysis |

### UI Development
| Tool | Description |
|------|-------------|
| `taskagent_previewUI` | Live preview of HTML/CSS/JS |

## Agents

| Agent | Description |
|-------|-------------|
| Developer | Writes, executes, and debugs code |
| Search | Web research and information gathering |
| Document | Creates and manages documents |
| Browser | Browser automation and scraping |
| Multi-Modal | Processes images and visual content |
| Code Review | Code quality, security, and performance review |
| Security | Deep security analysis |
| Git | Version control operations |
| Frontend | UI development with live preview |
| Financial | Stock market and economic analysis |

## Advanced Usage

### Consensus Voting
Get multiple agents to analyze a topic and reach consensus:
```
@taskagent /consensus Is this code secure? | security, codereview, developer
```

### Self-Reflection
Execute tasks with iterative improvement:
```
@taskagent /reflect Optimize this algorithm | iterations=3, minScore=8
```

### Analytics Dashboard
View agent performance statistics:
```
@taskagent /analytics          # Show dashboard
@taskagent /analytics recent   # Recent activity
@taskagent /analytics detail   # Detailed report
```

### Task Templates
Use predefined workflow templates:
```
@taskagent /template list
@taskagent /template load "Research Report"
@taskagent /template info "Code Review"
```

### Role-Playing Sessions
Multi-persona discussions:
```
@taskagent /roleplay API design | architect, developer, qa_engineer
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                         │
├─────────────────────────────────────────────────────────────┤
│  WorkforceParticipant (Chat Handler)                        │
│    ├── Orchestrator (Task Decomposition)                    │
│    ├── ConsensusEngine (Multi-Agent Voting)                 │
│    ├── SelfReflectionEngine (Iterative Improvement)         │
│    ├── RolePlayEngine (Multi-Persona Sessions)              │
│    ├── TemplateManager (Workflow Templates)                 │
│    ├── AgentAnalytics (Performance Tracking)                │
│    └── ConversationCompressor (Context Management)          │
├─────────────────────────────────────────────────────────────┤
│  AgentRegistry                                              │
│    ├── Developer Agent                                      │
│    ├── Search Agent                                         │
│    ├── Security Agent                                       │
│    ├── Git Agent                                            │
│    ├── Financial Agent                                      │
│    └── ... (other agents)                                   │
├─────────────────────────────────────────────────────────────┤
│  TaskManager (Priority Queue)                               │
│    ├── Task Priority (critical/high/normal/low)             │
│    ├── Deadlines & Scheduling                               │
│    └── Progress Tracking                                    │
├─────────────────────────────────────────────────────────────┤
│  Tools (Language Model Tools)                               │
│    ├── Code Tools (execute, search, review)                 │
│    ├── Web Tools (search, browse)                           │
│    ├── Git Tools (operations)                               │
│    ├── Security Tools (review, analyze)                     │
│    └── Financial Tools (analysis)                           │
├─────────────────────────────────────────────────────────────┤
│  Backend Server (Port 3847)                                 │
│    └── Playwright Browser Automation                        │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

### Settings
| Setting | Description |
|---------|-------------|
| `taskagent.tavilyApiKey` | Tavily API key for web search |
| `taskagent.githubToken` | GitHub token for higher API rate limits |

## Version History

### v0.0.19
- Added Financial Analysis Agent
- Added Agent Consensus Voting (`/consensus`)
- Added Self-Reflection Engine (`/reflect`)
- Added Agent Performance Analytics (`/analytics`)
- Added Task Priority Queue with deadlines
- Added Conversation History Compression
- Improved task visualization

### v0.0.18
- Added Git Agent and operations
- Added Task Template System
- Added Task Execution Visualization

### v0.0.17
- Added Frontend UI Agent with live preview
- Added Role-Playing sessions
- Added Multi-perspective code review

## License

MIT
