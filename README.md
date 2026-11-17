# BugRadar

**A QA tester for the app you're building with Claude Code. Say "test now" and find out what you just broke.**

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Runs locally](https://img.shields.io/badge/runs-100%25%20locally-blue) ![Node 18+](https://img.shields.io/badge/node-18%2B-brightgreen)

You ship a new feature. It works. What you don't see is the older feature that quietly stopped working because of it.

BugRadar is a Claude Code skill that keeps a saved set of tests for your project and re-runs all of them every time you ask. It tells you three things: what still works, what broke, and what got fixed.

```
You: test now

Functional: 11 of 12 checks pass

Broke since last run
- TC-006 Checkout: order total no longer applies the quantity discount.
  Likely cause: the change to OrderService::total() in this session.

New and passing
- TC-013 Promo code: valid code gives 10% off.

Pages: 48/100 (+7) · 4 pages
New
- [critical] A button on /about has no label, so screen-reader users
  cannot tell what it does.
Fixed
- Logo image now has alternative text.
```

## Why not just ask Claude to write tests?

You can, and it will. The tests will pass. That is the problem.

On the first real project BugRadar ran on, Claude Code had just written 25 passing tests. BugRadar's "prove it can fail" step broke the app on purpose and re-ran them. **Two of the 25 still passed.** One claimed to test what happens when a message fails to send, but never simulated a failure. The other would have passed whether the slow work ran in the background or blocked the request.

A test that cannot fail tells you nothing. BugRadar checks that each one can.

## Quick start

Requires Node.js 18 or newer.

```bash
git clone https://github.com/muhiremoise/bugradar-skill ~/.claude/skills/bugradar
cd ~/.claude/skills/bugradar && npm install
```

Start your app, open a new Claude Code session in your project, and say:

> set up functional checks for this project

After that, any time you change something:

> test now

If you have Chrome or Edge installed, that is all the setup. Otherwise also run `npx playwright install chromium` in the skill folder.

<details>
<summary>Installing for one project only, or from a zip</summary>

Clone into `.claude/skills/bugradar` inside that project instead.

`SKILL.md` must sit directly inside the `bugradar` folder:

```
.claude/skills/bugradar/SKILL.md            correct
.claude/skills/bugradar/bugradar/SKILL.md   wrong, Claude Code will not find it
```

To confirm the skill loaded, start a new session and type `/bugradar`. It should appear in the suggestions.
</details>

## How it works

**1. It learns your project.** Claude reads your code and docs, lists the features, and asks you to confirm the list. You know things the code doesn't say.

**2. It designs test cases the way a tester would.** Highest-risk features first, using standard test design techniques: equivalence partitioning, boundary values, decision tables, state transitions and use cases, as taught in the ISTQB Foundation syllabus. Every test case is written down with its steps and expected result, in a file you can read.

**3. It saves them as checks and proves each one can fail.** The same checks run every time, so results are comparable from one run to the next.

**4. You say "test now".** It runs everything and leads with what changed.

## What you get

| | |
|---|---|
| **Regression report** | Which checks passed last time and fail now. This answers "did I break anything?" |
| **Test cases you can read** | `.bugradar/test-cases.md`, with the technique and source for each |
| **Flaky test detection** | A check that fails and then passes is reported as flaky, never as a pass |
| **Page check** | Accessibility rule failures (axe-core, WCAG 2.1 A and AA), JavaScript errors, failed requests, broken links |
| **A score that doesn't move by itself** | Calculated by a script, so the same app always gets the same number |
| **Fixes on request** | Claude offers to fix what it found, then re-runs to confirm |

## You stay in control

- **It asks before creating test data.** Checks that create accounts or records are skipped until you say yes. Test accounts are named `bugradar-test+...@example.com` so they are easy to find and remove.
- **Real messages and charges never run by default.** A check that sends an email, an SMS or a payment only runs when you ask for it at that moment.
- **Your own apps only.** Local addresses run straight away. A deployed site needs you to confirm it is yours.
- **Nothing leaves your machine.** The scripts talk only to the app being tested. No account, no usage tracking.

## What it does not do

Worth knowing before you rely on it.

- It does not test security.
- The page check only sees pages a visitor can reach without logging in.
- Automated accessibility rules catch only part of real accessibility problems.
- Test cases are written by an AI from your code and docs. Read them. A wrong test can pass on a broken feature, which is why the "prove it can fail" step exists, and why it still isn't a guarantee.
- Passing checks mean those saved tests passed. They do not mean your app has no bugs.

## How the page score works

Start at 100. Each open problem costs points by severity: critical 12, high 7, medium 3, low 1. The same problem on many pages counts once.

## Running the scripts directly

```bash
node ~/.claude/skills/bugradar/scripts/run-checks.mjs --url http://localhost:3000   # functional checks
node ~/.claude/skills/bugradar/scripts/check.mjs --url http://localhost:3000        # page check
```

Add `--fail-on-regression` or `--fail-on-new` to get a non-zero exit code for scripts and CI.

## Tell me what it got wrong

This is an early version, and what gets built next depends on what you report.

- **[Two-minute feedback form](https://docs.google.com/forms/d/e/1FAIpQLScMnga_Koq_9MsNpAI4hwMWLg7YjJWodpqwdHPa3D4MXzzZ6Q/viewform)**, with an optional sign-up for updates and the community
- **[Open an issue](https://github.com/muhiremoise/bugradar-skill/issues)** for a bug or a wrong result

If BugRadar caught something real in your project, a star helps other builders find it.

## About

Built by [Moise Muhire](https://github.com/muhiremoise), a QA lead with 5+ years in software testing and automation, ISTQB Foundation certified. BugRadar is designed with ISTQB test techniques. It is not certified or endorsed by ISTQB.

## Licence

MIT. See `LICENSE`.
