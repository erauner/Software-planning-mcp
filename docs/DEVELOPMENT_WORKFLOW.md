# Development Workflow Guide

## Quick Start

```bash
# First time setup
task setup

# Daily development
task build    # Build with all quality checks
task test     # Run comprehensive tests
task start    # Start MCP server
```

## Available Tools

This project uses **Task** (Taskfile) and **pre-commit hooks** for streamlined development:

### 🔧 Task Commands

| Command | Description |
|---------|-------------|
| `task setup` | 🚀 Complete project setup (first time) |
| `task build` | 🏗️ Build with quality checks |
| `task test` | 🧪 Run all tests |
| `task check` | 🔍 Run quality checks only |
| `task start` | ▶️ Start MCP server |
| `task ci` | 🤖 Simulate CI pipeline |

See all commands: `task --list`

### 🪝 Pre-commit Hooks

Automatic checks run on every commit:
- ✅ **Stdout pollution prevention** (critical for MCP)
- ✅ **TypeScript compilation**
- ✅ **Code formatting**
- ✅ **Security scanning**
- ✅ **Conventional commit messages**

### 🛡️ Quality Gates

Multiple layers ensure code quality:

1. **Static Analysis**: Catches `console.log()` before commit
2. **Build Validation**: TypeScript compilation must succeed
3. **Protocol Testing**: MCP JSON-RPC compliance verified
4. **Security Scanning**: No secrets in code

## Installation

### Prerequisites

```bash
# Install Task (choose one method)
brew install go-task/tap/go-task          # macOS
curl -sL https://taskfile.dev/install.sh | sh  # Linux/macOS
# See https://taskfile.dev/#/installation for more options

# Install pre-commit
pip install pre-commit
# or
brew install pre-commit
```

### Setup

```bash
# Clone and setup
git clone <repo-url>
cd Software-planning-mcp
task setup
```

This will:
- Install dependencies (`pnpm install`)
- Setup git hooks (`pre-commit install`)
- Verify everything works (`task build`)

## Development Workflow

### 🚀 Standard Workflow

```bash
# Start development
task build:watch     # Auto-rebuild on changes

# Make changes to src/...

# Check your work
task check          # Quality checks
task test:quick     # Fast tests

# Commit (triggers pre-commit hooks automatically)
git add .
git commit -m "feat: add new feature"

# Pre-push validation
task pre-push       # Comprehensive checks
git push
```

### 🔍 Quality Checks

Before every commit, these run automatically:

```bash
task check:stdout    # ← Critical for MCP servers!
task check:typescript
task lint
```

**Why stdout checking is critical:** A single `console.log()` breaks the entire MCP JSON-RPC protocol.

### 🧪 Testing Strategy

```bash
task test:quick      # Unit tests + pollution check (fast)
task test           # Full test suite (slower)
task test:pollution  # MCP protocol compliance only
```

### 🐛 Debugging

```bash
# Build without quality checks (debugging only)
task build:unsafe

# Start with debug output
task debug

# Skip pre-commit for emergency commits (not recommended)
git commit --no-verify -m "emergency fix"
```

## Maintenance Commands

```bash
# Clean up
task clean          # Remove build artifacts
task clean:all      # Deep clean (includes node_modules)

# Update dependencies
task upgrade        # Update and test

# Reset to fresh state
task reset          # Clean + reinstall + build
```

## CI/CD Integration

Test what CI would do:

```bash
task ci       # Quick CI simulation
task pipeline # Full pipeline (clean slate)
```

### GitHub Actions Integration

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - name: Install Task
        uses: arduino/setup-task@v1
      - name: Run CI Pipeline
        run: task ci
```

## Troubleshooting

### Common Issues

**"Task not found"**
```bash
# Install Task first
brew install go-task/tap/go-task
```

**"pre-commit not found"**
```bash
# Install pre-commit
pip install pre-commit
task setup-git-hooks
```

**"Build fails with pollution errors"**
```bash
# Check what's wrong
task check:stdout

# Common fix: replace console.log with console.error
# console.log("debug") → console.error("debug")
```

**"MCP server not responding"**
```bash
# Test protocol compliance
task test:pollution

# Start in debug mode
task debug
```

### Emergency Procedures

**Skip all checks (emergency only):**
```bash
task build:unsafe
git commit --no-verify
```

**Reset everything:**
```bash
task clean:all
task setup
```

## Project Structure

```
├── Taskfile.yml              # Task automation
├── .pre-commit-config.yaml   # Pre-commit hooks
├── .eslintrc.json            # Code linting
├── scripts/                  # Automation scripts
│   └── check-stdout-pollution.mjs
├── src/                      # TypeScript source
├── test/                     # Test files
│   └── stdout-pollution.test.js  # Protocol compliance
├── docs/                     # Documentation
│   └── MCP_PROTOCOL_COMPLIANCE.md
└── build/                    # Compiled output
```

---

💡 **Pro tip**: Run `task` with no arguments to see all available commands and quick start instructions.

🚨 **Remember**: This is an MCP server. Never use `console.log()` - it breaks the JSON-RPC protocol! Always use `console.error()`.
