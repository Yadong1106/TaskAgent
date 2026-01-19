# TaskAgent - Multi-Agent Workflow for VS Code

A multi-agent autonomous workflow system powered by GitHub Copilot, inspired by [Eigent](https://github.com/eigent-ai/eigent).

## Features

- **Multi-Agent Collaboration**: Developer, Search, Document, Browser, and other specialized agents
- **Automatic Task Decomposition**: Uses LLM to break down complex tasks into subtasks
- **Parallel Execution**: Independent subtasks execute in parallel
- **Human-in-the-loop**: Requests user confirmation before critical operations
- **Deep VS Code Integration**: Leverages GitHub Copilot API

## Installation

```bash
cd TaskAgent
npm install
npx playwright install chromium  # Optional, for browser automation
```

## Usage

1. Press `F5` to start debugging
2. Open Copilot Chat (`Ctrl+Shift+I`)
3. Use `@workforce` to invoke TaskAgent

### Example Commands

```
@workforce Help me research React 19 new features and generate a report
@workforce /research Vue vs React 2024 comparison
@workforce /code Create an Express API server
@workforce /automate Search for latest AI papers, summarize top 5, generate Markdown report
```

## Tools

| Tool | Description |
|------|-------------|
| `taskagent_executeCode` | Execute code and terminal commands |
| `taskagent_webSearch` | Web search |
| `taskagent_browseWebpage` | Browse webpages and extract content |
| `taskagent_createDocument` | Create and manage documents |
| `taskagent_humanInput` | Request user input |
| `taskagent_writeNote` | Write notes for inter-agent communication |
| `taskagent_readNote` | Read notes from other agents |
| `taskagent_codeSearch` | Search code in the workspace |
| `taskagent_securityReview` | Generate security review documents |
| `taskagent_analyzeScenario` | Deep scenario security analysis |

## License

MIT
