# BugRadar skill

A quick quality check for the web app you are building with Claude Code. Say "test now" after you change something and it tells you **which existing features still work, what broke and what got fixed**.

Built by a QA lead for people who ship fast and don't have a tester.

```
Score: 48/100 (+7 since last check) · 4 pages

New
- [critical] A button on /about has no label, so screen-reader users cannot tell what it does.

Got worse
- [critical] Form fields without labels on /pricing: 2, was 1.

Fixed
- Logo image now has alternative text.
- Low-contrast text on the home page.
```

## What it does

**Functional checks: do existing features still work?**
Claude reads your project, lists its features, and designs test cases for them using standard test design techniques (equivalence partitioning, boundary values, decision tables, state transitions, use cases, as taught in the ISTQB Foundation syllabus). Each test case is saved in your project as a check. The same checks run every time, and the report tells you what broke since last time.

**Page check: did the pages get better or worse?**
Measured in a real browser, read-only:

- Accessibility rule failures (axe-core, WCAG 2.1 A and AA)
- Uncaught JavaScript errors and console errors
- Requests that fail or return 4xx/5xx
- Internal links that lead to broken pages
- Missing viewport tag and meta description

## Your consent comes first

- Functional checks may create test accounts and records. Claude asks before the first one, and your answer is recorded in `.bugradar/checks.json`. Until then those checks are skipped.
- Test accounts are named `bugradar-test+...@example.com` so they are easy to find and remove.
- Checks that send real messages, charge cards or call paid services never run unless you ask for them at that moment.
- Nothing runs against a deployed site unless you confirm it is yours.

## What it does not do

- It does not test security.
- The page check only sees pages a visitor can reach without logging in.
- Automated accessibility rules catch only part of real accessibility problems.
- Test cases are written by an AI from your code and docs, then saved as files you can read. Review them. A wrong test can pass on a broken feature.
- Passing checks mean those saved tests passed. They do not mean your app has no bugs.

## Install

Requires Node.js 18 or newer.

For all your projects:

```bash
git clone https://github.com/muhiremoise/bugradar-skill ~/.claude/skills/bugradar
cd ~/.claude/skills/bugradar && npm install
```

For one project only, clone into `.claude/skills/bugradar` inside that project instead.

**Check the folder.** `SKILL.md` must sit directly inside the `bugradar` folder:

```
.claude/skills/bugradar/SKILL.md      correct
.claude/skills/bugradar/bugradar/SKILL.md   wrong, Claude Code will not find it
```

If you installed from a zip and ended up with a `bugradar` folder inside another `bugradar` folder, move the inner one up a level. To confirm the skill loaded, start a new Claude Code session and type `/bugradar`. It should appear in the suggestions.

If you have Google Chrome or Edge installed, that is all. Otherwise also run `npx playwright install chromium` in the skill folder.

## Use

Start your app, then in Claude Code say something like:

- "Test now"
- "Did that last change break anything?"
- "Set up functional checks for this project"
- "Write test cases for the checkout feature"

or type `/bugradar`.

You can also run the scripts directly:

```bash
node ~/.claude/skills/bugradar/scripts/run-checks.mjs --url http://localhost:3000   # functional checks
node ~/.claude/skills/bugradar/scripts/check.mjs --url http://localhost:3000        # page check
```

Results are saved in a `.bugradar/` folder in your project.

## Your own apps only

Local addresses run straight away. For a deployed site you must confirm it is yours (`--confirm-owned`). Please do not point this at sites you don't own.

## Privacy

The script talks only to the app you are checking. It sends nothing to us and collects no usage data.

## How the score works

Start at 100. Each open problem costs points by severity: critical 12, high 7, medium 3, low 1. The same problem on many pages counts once. The score is calculated by the script, so the same app always gets the same number.

## Feedback

This is an early version and your feedback decides what gets built next.

- [Feedback form](https://docs.google.com/forms/d/e/1FAIpQLScMnga_Koq_9MsNpAI4hwMWLg7YjJWodpqwdHPa3D4MXzzZ6Q/viewform) (2 minutes, with an optional sign-up for updates and the community)
- Open an issue on this repo to report a bug or a wrong result

## Licence

MIT. See `LICENSE`.

## What may come next

Depending on what users ask for: a GitHub Action that runs the checks on every push, saved history with alerts, and security checks.
