# Contributing to Wavebucks

A developer's guide to setting up your environment, coding with AI assistants, and deploying to Google Apps Script.

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Development Workflow](#development-workflow)
4. [Working with AI Assistants](#working-with-ai-assistants)
5. [Testing](#testing)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software
- **Node.js** (v14 or higher) - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)
- **Visual Studio Code** - [Download](https://code.visualstudio.com/)
- **Google Account** with access to Google Apps Script

### Recommended VS Code Extensions
- **Claude Code** - AI pair programming assistant (recommended)
- **ESLint** - JavaScript linting
- **Prettier** - Code formatting
- **Google Apps Script** - Syntax highlighting for .gs files

---

## Initial Setup

### 1. Install clasp (Google Apps Script CLI)

clasp lets you develop Apps Script projects locally and sync them with Google's servers.

```bash
# Install clasp globally
npm install -g @google/clasp

# Verify installation
clasp --version
```

### 2. Enable Google Apps Script API

1. Visit https://script.google.com/home/usersettings
2. Toggle **"Google Apps Script API"** to **ON**

### 3. Login to clasp

```bash
# Authenticate with your Google account
clasp login

# This will open a browser window for OAuth authentication
# Grant the requested permissions
```

### 4. Clone the Repository

```bash
# Clone the Wavebucks repository
git clone <repository-url>
cd wavebucks

# Install local dependencies (for testing)
cd scribaSenatus
npm install  # If package.json exists
```

### 5. Pull from Apps Script

The projects are already connected to Google Apps Script. Pull the latest code:

```bash
# Pull ScribaSenatus (main service)
cd scribaSenatus
clasp pull

# Pull WavebucksCore (ledger library)
cd ../wavebucksCore
clasp pull
```

**Note**: Each directory has its own `.clasp.json` file that links it to a specific Apps Script project.

---

## Development Workflow

### Project Structure

```
wavebucks/
├── scribaSenatus/          # Main service (inbox processor)
│   ├── .clasp.json         # Apps Script project link
│   ├── appsscript.json     # Manifest & dependencies
│   ├── InboxProcessor.js   # Email automation
│   ├── DispatchService.js  # Command routing
│   ├── Causae.js           # Voting/wagering service
│   ├── Commissiones.js     # Bounty task service
│   ├── Config.js           # Command lexicon
│   ├── Tests.js            # Apps Script tests
│   └── TestsLocal.js       # Local Node.js tests
│
├── wavebucksCore/          # Ledger library
│   ├── .clasp.json         # Apps Script project link
│   ├── WavebucksCore.js    # Balance management
│   └── sheetConfig.js      # Sheet configuration
│
└── CONTRIBUTING.md         # This file
```

### Daily Workflow

1. **Pull latest from Apps Script** (in case of remote changes)
   ```bash
   cd scribaSenatus
   clasp pull
   ```

2. **Make your code changes** in VS Code

3. **Test locally** (if applicable)
   ```bash
   node TestsLocal.js
   ```

4. **Push to Apps Script**
   ```bash
   clasp push
   ```

5. **Commit to git**
   ```bash
   git add .
   git commit -m "Your descriptive commit message"
   git push origin main
   ```

### Important clasp Commands

```bash
# Pull code from Apps Script to local
clasp pull

# Push local code to Apps Script
clasp push

# Open the project in Apps Script web editor
clasp open

# View deployment info
clasp deployments

# Watch for changes and auto-push
clasp push --watch
```

### Files to Ignore

The `.claspignore` file excludes certain files from being pushed to Apps Script:

```
# Local test files
TestsLocal.js

# Git files
.git/**
.gitignore

# Clasp config
.clasp.json
```

---

## Working with AI Assistants

### Claude Code (Recommended)

**Claude Code** is Anthropic's official CLI for pair programming with Claude AI.

#### Setup
1. Install Claude Code: https://docs.claude.com/claude-code
2. Authenticate with your Anthropic account
3. Open your project in VS Code
4. Press `Cmd+Shift+P` → "Claude Code: Start Session"

#### Best Practices

**For Code Generation:**
```
You: "Add a new command LIST_CAUSAE that shows all open causae with their IDs"

Claude will:
- Read relevant files (Config.js, Causae.js, DispatchService.js)
- Implement the feature
- Update tests
- Push to Apps Script
- Commit to git
```

**For Debugging:**
```
You: "I'm getting 'Cannot read property getBalance' error when sending BALANCE command"

Claude will:
- Analyze the error
- Search for the issue (e.g., Wavebucks.Wavebucks vs Wavebucks)
- Fix the code
- Push and commit
```

**For Refactoring:**
```
You: "Can we make the command descriptions more detailed with parameter explanations?"

Claude will:
- Review the lexicon structure
- Update all descriptions systematically
- Ensure tests still pass
- Deploy changes
```

#### Tips for Effective Collaboration

✅ **Do:**
- Provide context about what you're trying to achieve
- Reference specific files or line numbers when relevant
- Ask Claude to explain code you don't understand
- Request tests for new features
- Have Claude review code before deploying

❌ **Don't:**
- Give vague instructions like "make it better"
- Ask Claude to implement malicious code
- Skip reviewing changes before deployment
- Forget to pull before starting a new session

### GitHub Copilot (Alternative)

If you prefer GitHub Copilot:

1. Install the Copilot extension in VS Code
2. Authenticate with your GitHub account
3. Use inline suggestions as you code
4. Use `Cmd+I` for inline chat
5. Manually run `clasp push` when ready

---

## Testing

### Local Tests (Fast, No Google Dependencies)

```bash
cd scribaSenatus
node TestsLocal.js
```

**Output:**
```
Starting Scriba Senatus Local Test Suite

Running Config tests...
✅ PASS: Config.getLexicon() returns array
✅ PASS: Lexicon entries have required fields
...

==================================================
TEST SUMMARY: 21 passed, 0 failed
==================================================
```

### Apps Script Tests (Requires Google Services)

1. Push your code: `clasp push`
2. Open Apps Script: `clasp open`
3. In the web editor, run: `runAllTests()`
4. Check the logs for results

**What gets tested:**
- Config & lexicon structure
- Command parsing
- Service integrations (Causae, Commissiones)
- Dispatch table handlers
- Message building
- Integration flows

### Adding New Tests

When adding a feature, update both test files:

**TestsLocal.js** - For logic without Google dependencies:
```javascript
TestRunner.test('parseNewCommand - valid format', () => {
  const body = 'NEWCOMMAND arg1 arg2';
  const parsed = CommandParsers.parseNewCommand(body);
  TestRunner.assertEqual(parsed.arg1, 'expected', 'Arg1 should match');
});
```

**Tests.js** - For full integration tests:
```javascript
TestRunner.test('NEWCOMMAND handler exists', () => {
  TestRunner.assert(
    typeof DispatchTable.NEWCOMMAND === 'function',
    'Should have NEWCOMMAND handler'
  );
});
```

---

## Deployment

### Deploy to Apps Script

```bash
# Standard push (development mode)
clasp push

# Push and open in web editor
clasp push && clasp open
```

### Set Up Triggers (One-time Setup)

1. Open Apps Script: `clasp open`
2. Click **Triggers** (clock icon)
3. Add trigger:
   - Function: `processInbox`
   - Event source: **Time-driven**
   - Type: **Minutes timer**
   - Interval: **Every 5 minutes**

This makes Scriba Senatus check for new emails every 5 minutes.

### Publishing the Wavebucks Library

If you make changes to `wavebucksCore`:

1. Push changes: `cd wavebucksCore && clasp push`
2. Open Apps Script: `clasp open`
3. Click **Deploy** → **New deployment**
4. Type: **Library**
5. Description: "v0.X - Your changes"
6. Click **Deploy**
7. Note the new version number
8. Update `scribaSenatus/appsscript.json` with new version (if needed)

**Note:** For development, we use `"developmentMode": true` which always uses the latest code without versioning.

---

## Troubleshooting

### "Project not found" Error

```bash
# Check that .clasp.json exists
cat .clasp.json

# If missing, you need to clone or create the project
clasp clone <scriptId>
```

### "Apps Script API not enabled"

1. Visit https://script.google.com/home/usersettings
2. Enable the **Google Apps Script API**
3. Try `clasp push` again

### "Permission denied" on clasp push

```bash
# Re-authenticate
clasp logout
clasp login
```

### Wavebucks Library Not Found

**Symptom:** `Cannot read properties of undefined (reading 'getBalance')`

**Fix:** Check `appsscript.json` library configuration:
```json
{
  "dependencies": {
    "libraries": [{
      "userSymbol": "Wavebucks",
      "libraryId": "1cZmJlFXXyez-79HQLeqJmTCjy5eNxnXTEkoVusLnVUeHlZdM6QECTAlf",
      "version": "0",
      "developmentMode": true
    }]
  }
}
```

Ensure you're calling `Wavebucks.getBalance()` not `Wavebucks.Wavebucks.getBalance()`.

### Tests Passing Locally but Failing in Apps Script

This usually means:
- Missing Google service dependencies (sheets, Gmail)
- Environment differences (Date handling, etc.)

Check the Apps Script logs: `clasp logs`

### Merge Conflicts Between Local and Remote

```bash
# If clasp pull shows conflicts, you can:

# Option 1: Force pull (overwrites local changes)
clasp pull --force

# Option 2: Manually merge in the web editor
clasp open
# Copy your local changes, refresh from web, merge manually
```

**Best practice:** Always pull before making changes.

---

## Git Workflow

### Branch Strategy

```bash
# Create a feature branch
git checkout -b feature/new-command

# Make changes, test, commit
git add .
git commit -m "Add LIST_CAUSAE command"

# Push to remote
git push origin feature/new-command

# Create pull request on GitHub
# After review, merge to main
```

### Commit Message Format

Follow this format for consistency:

```
<type>: <short summary>

<detailed description>

<optional metadata>
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `refactor:` Code restructuring
- `test:` Test additions/changes
- `docs:` Documentation updates
- `chore:` Build/config changes

**Example:**
```
feat: Add LIST_CAUSAE command for viewing open votes

Implements new command that returns all open causae with IDs, titles,
and closing dates. Includes parameter formatting and HTML entity emojis.

- Added LIST_CAUSAE to Config lexicon
- Implemented handler in DispatchService
- Added tests in Tests.js and TestsLocal.js
- Updated HELP documentation

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Resources

### Documentation
- [Google Apps Script Docs](https://developers.google.com/apps-script)
- [clasp Documentation](https://github.com/google/clasp)
- [Claude Code Docs](https://docs.claude.com/claude-code)

### Project-Specific
- [Wavebucks README](./README.md) - System philosophy and architecture
- [Config.js](./scribaSenatus/Config.js) - Command lexicon
- [Tests.js](./scribaSenatus/Tests.js) - Test suite

### Support
- **Issues:** File bugs/features in GitHub Issues
- **Questions:** Ask in the krewe Slack/Discord
- **Wavebucks:** Send an email to scribasenatus@gmail.com with "HELP"

---

## Quick Reference

```bash
# Setup (one-time)
npm install -g @google/clasp
clasp login
cd scribaSenatus && clasp pull

# Daily workflow
clasp pull                    # Get latest from Apps Script
# ... make changes in VS Code ...
node TestsLocal.js            # Test locally
clasp push                    # Deploy to Apps Script
git add . && git commit -m "..." && git push

# Debugging
clasp logs                    # View execution logs
clasp open                    # Open in web editor

# AI-assisted coding
# Open VS Code → Cmd+Shift+P → "Claude Code: Start Session"
```

---

## Philosophy: Code as Theater

Remember, this isn't just a project—it's performance art. The code generates behaviors, the spreadsheet is the constitution, and every transaction is a ritual. When you commit code, you're writing the script for our carnival's bureaucracy.

The joke is: what if the future looks like this?

**Vale!** 🎭

---

*Last updated: 2025-12-08*
