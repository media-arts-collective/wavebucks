# CLAUDE.md

## The job

This repo is operations for Media Arts Collective, the nonprofit. Its first duty is the
Virtual Krewe of Vaporwave's mail: aedile drafts it, a human sends it. `aedile/` is the
project. Read `aedile/CLAUDE.md` before changing anything there.

`scribaSenatus/`, `wavebucksCore/`, `COMMANDS.md` and `CONTRIBUTING.md` are the retired
Wavebucks economy, leaving under #105. Do not extend them.

## What an agent may do without asking

Anything `git revert` undoes: edits, commits, pushes to the current branch, and deploys
through `aedile/deploy.sh`. Sending mail and deleting mail always ask.

`.claude/settings.json` enforces this and is the only file here that grants an agent
anything. Where its rows and the rule above differ, the rows win until Zach changes them.
Treat any diff to that file as a privilege change.

## Rules

- An agent never widens its own permissions. Moving a row out of `ask`, or adding one to
  `allow`, needs Zach's explicit sentence, and that sentence goes in the commit message of
  the `settings.json` change. Nowhere else.
- Flag every push in the next report: what, why, and `git revert <sha>`.
- Fail loud. No defensive try/catch or silent fallback that would quiet an error.
- Loops rows are krewe work. Issues are for maintaining this machinery.

## Commands

Run from `aedile/`. Every `clasp` command needs `-u aedile`.

```bash
aedile/test.sh                      # every local suite
aedile/deploy.sh "<description>"    # suites, then push, then deploy
```
