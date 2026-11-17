---
name: bugradar
description: Test a web app the user is building and report what CHANGED since the last test - which existing features still work, what broke, what was fixed. Runs saved functional checks for the project's features plus a measured page check (accessibility, JavaScript errors, failed requests, broken links), and designs new test cases with ISTQB techniques. Use this whenever the user says "test now", "test it", "run the tests", "check my app", "QA this", "did I break anything", "is it safe to commit/deploy", asks for a pre-launch check, asks to write or design test cases, or has just finished building or changing a feature and wants to know the rest still works, even if they never say "BugRadar".
---

# BugRadar

A tester for a web app the user is building, made to be run again and again. Every run answers two questions:

1. **Do the existing features still work?** (functional checks)
2. **Did the pages get better or worse?** (page check)

People who build quickly with AI tools often ship without testing, and the usual casualty is a feature that worked yesterday. You can see the code, the docs and the conversation, so you know what the app is supposed to do. This skill turns that knowledge into saved checks that run the same way every time, so "it still works" is something measured and not something assumed.

Everything runs on the user's machine. Nothing is sent anywhere.

## When the user says "test now"

Do this without asking what they mean:

1. Make sure the app is running and you know its address (see "Finding the app").
2. If `.bugradar/checks.json` exists, run the functional checks.
3. If the app serves web pages, run the page check.
4. Report both together, changes first (see "Reporting").
5. If `.bugradar/checks.json` does not exist, run the page check, report it, and offer to set up functional checks. Do not start writing test cases unasked on a first run; the feature list needs the user's confirmation.

If a feature was just built or changed in this conversation, add or update its test cases first (see "After building or changing a feature"), then run everything.

## Finding the app

The app must be running. Work out its address in this order: a URL the user gave; a dev server already running in this session; the dev script in `package.json` or the framework default. Start it in the background if needed and wait until it responds. If you cannot tell, ask.

If you start a server yourself, note its process ID and stop only that process when you are done. Never stop processes by name (`taskkill /IM php.exe`, `pkill node`), because that can take down the user's own running app. Say so if you leave a server running.

**Only test apps the user owns or has permission to test.** Local addresses run straight away. For a deployed address, ask the user to confirm it is theirs before using `--confirm-owned`. Decline requests to test someone else's site.

## First-time setup

Scripts live in `scripts/` inside this skill's folder (the folder containing this file). If that folder has no `node_modules`:

```bash
cd <skill-folder> && npm install
```

If a run reports that no browser could be started, run `npx playwright install chromium` there. An installed Chrome or Edge is used automatically.

Run all commands below from the root of the user's project so results land in the project's `.bugradar/` folder.

## Functional checks

### Setting up (once per project)

Do this when the user agrees to set up functional testing.

1. **Read `references/test-design.md`.** It explains how to choose and write test cases. Follow it.
2. **List the features.** Read the docs, routes, existing tests and code. Write `.bugradar/features.md`: each feature, one line on what it does, its priority, and where the expected behaviour comes from.
3. **Confirm with the user.** Show the list and ask what is missing, what is wrong and what matters most. They know things the code does not say. This is a short kickoff, not a questionnaire: one message.
4. **Ask for consent before creating data** (see "Consent").
5. **Design test cases** for the critical and high features first, in `.bugradar/test-cases.md`, using the format in the reference. Start with 8 to 15 cases. A small set that is trusted is worth more than a large one that is ignored.
6. **Automate each case** as a check and register it in `.bugradar/checks.json`. Reuse the project's own tests where they already cover a case.
7. **See each new check pass, and see it fail once.** Follow "Proving a check can fail" in the reference: break the expectation for every check, and for critical and high checks also break the app temporarily using the safe procedure there. Tell the user about any check that passed against a broken app and fix it. Then run the whole set to record the starting point.

### checks.json

```json
{
  "base_url": "http://localhost:8000",
  "consent": {
    "create_test_data": true,
    "confirmed_at": "2026-11-16",
    "note": "User agreed to test accounts on the local database",
    "allow_non_local": false
  },
  "checks": [
    {
      "id": "TC-001",
      "feature": "Login",
      "title": "Registered user can log in",
      "priority": "critical",
      "technique": "use case",
      "command": "node .bugradar/checks/TC-001-login.cjs",
      "timeout_s": 60,
      "changes_data": false,
      "external_effects": false
    },
    {
      "id": "TC-002",
      "feature": "Orders",
      "title": "Order total applies the quantity discount",
      "priority": "high",
      "technique": "decision table",
      "command": "php artisan test --filter=OrderTotalTest",
      "changes_data": false,
      "external_effects": false
    }
  ]
}
```

- `command` is anything that exits 0 on pass. Commands run in the user's shell with their permissions, like an npm script. If `checks.json` came with a repository the user did not write, read the commands and show them to the user before the first run.
- `retries` (0 to 2, default 1) can be set per check or at the top level.
- `known_issue`: a short reason, for a check that fails for a cause the user has seen and chosen to leave for now (for example a secret that is not set on the local machine). The check still runs and still counts as failing. Add this only when the user says to leave it. The runner sets `BUGRADAR_URL` and `BUGRADAR_HELPER` for it.
- `changes_data: true` for any check that creates, edits or deletes records.
- `external_effects: true` for any check that reaches outside the app: sends an email, SMS or chat message, charges a card, calls a paid API, posts to a third party.

### Running

```bash
node <skill-folder>/scripts/run-checks.mjs --url http://localhost:8000
```

| Option | Use |
|---|---|
| `--only TC-003,TC-004` | Run some checks, for confirming a fix. Other results are kept. |
| `--include-external` | Also run checks with real-world effects. Only when the user asks for it in this conversation. |
| `--fail-on-regression` | Exit 1 if a check that passed last time now fails. For scripts and CI. |
| `--no-save` | Run without updating the comparison point. |
| `--no-retry` | Do not re-run failed checks. Use when proving a flaky check is fixed. |

The runner waits for the app to respond before starting. A check that fails is run once more: if it then passes it is reported as `flaky`, not as passed. Checks with external effects are never repeated.

Output is a JSON summary; `.bugradar/functional-report.md` has the readable version. `changes.regressions` lists checks that passed last time and fail now. That list is the answer to "did my change break anything".

### Consent

Functional checks may create users and other records. That is fine with the user's agreement, and not without it.

- Before the first check that changes data, ask once, plainly: what will be created (for example test accounts named `bugradar-test+...@example.com`), where (which database or environment), and whether that is acceptable. Record the answer in `consent` with the date and a short note. The runner skips data-changing checks until `create_test_data` is true and `confirmed_at` is set.
- Consent covers the local or test environment the user named. A deployed address needs its own explicit yes, recorded as `allow_non_local: true`. Never create test data in production on the strength of a general "go ahead".
- Checks with external effects never run by default, whatever consent says. Real messages, real charges and paid API calls cost money or reach real people. Run them only when the user asks in the moment, and say what will be sent or charged first.
- Use `testUser()` from the flow helper so test records are unique and recognisable. Clean up where the app allows it, and list anything left behind.
- Never use real customer data or the user's personal credentials as test data.

### After building or changing a feature

1. Add the feature to `features.md`, or update it.
2. Design its test cases with the reference. Update existing cases whose expected result changed on purpose, and note why.
3. Automate them and add them to `checks.json`.
4. Run the full set. Report in this order: do the new feature's checks pass (confirmation), and did anything that used to pass now fail (regression).

### When a check fails

Work out which of three things happened before touching anything:

- **The app is broken.** A real regression. Report it, offer to fix the app, re-run to confirm.
- **The behaviour changed on purpose.** The test case is out of date. Update its expected result with the user's agreement.
- **The check is flaky or wrong.** Fix the check: better selector, wait for the right outcome, unique data.

A result of `flaky` means the check failed and then passed with no change to the app. Do not report it as passing. Tell the user, find the cause using section 7 of `references/test-design.md`, fix the check, and prove the fix by running it with `--only <ID> --no-retry` several times. Occasionally the app itself is racing, which is a real bug to report.

Do not delete or weaken a failing check to get a clean report, and do not change the app to satisfy a check you have not confirmed is right. Either move hides the thing this tool exists to show. If you cannot tell which case it is, show the user the failure output and the screenshot path and ask.

## Page check

Measured in a real browser, read-only: accessibility rule failures (axe-core, WCAG 2.1 A and AA), JavaScript and console errors, failed requests, broken internal links, missing viewport tag and meta description.

```bash
node <skill-folder>/scripts/check.mjs --url http://localhost:8000
```

| Option | Use |
|---|---|
| `--max-pages N` | Pages to open. Default 8, maximum 25. |
| `--confirm-owned` | Required for non-local addresses, after the user confirms ownership. |
| `--fail-on-new` | Exit 1 on a new or worsened critical/high problem. |
| `--no-save` | Check without updating the comparison point. |

It reads only pages a visitor can reach without logging in. The score starts at 100 and loses points per open problem (critical 12, high 7, medium 3, low 1); the same problem on many pages counts once. It is calculated by the script, so do not adjust it or offer your own rating.

If the summary contains `baseline_reset`, the address belongs to a different site than last time, so a fresh starting point was recorded. Tell the user.

If the app has no real web interface (an API, a bot, a background worker), say that the page check does not apply and rely on functional checks.

Exit codes for both scripts: `0` finished, `1` regression or new serious problem with the fail flag, `2` could not run (read the `hint`), `3` non-local address without confirmation.

## Reporting

Lead with what changed, in plain language, because that is what the user can act on. Describe failures as what a real user would experience. Keep unchanged items to a count.

```
Functional: 11 of 12 checks pass

Broke since last run
- TC-006 Checkout: order total no longer applies the quantity discount.
  Likely cause: the change to OrderService::total() in this session.

New and passing
- TC-013 Promo code: valid code gives 10% off.

Pages: 48/100 (+7) · 4 pages
New
- [critical] A button on /about has no label, so screen-reader users cannot tell what it does.
Fixed
- Logo image now has alternative text.

Flaky: TC-004 Search failed once, then passed. The check needs fixing before its result can be trusted.
Skipped: TC-009 (sends a real WhatsApp message). 6 page problems unchanged.
Reports: .bugradar/functional-report.md, .bugradar/report.md
```

A failing check with a `known_issue` gets one short line ("Known: TC-016 unsigned webhook accepted locally, secret not set"), not a full explanation on every run. Repeating a known failure at full length trains people to skim past failures. If a known issue starts passing, report it as fixed and remove the field.

On a first run, say it is the starting point and give the main findings. If nothing changed, say so in one line. Always mention skipped and flaky checks and why, so neither is mistaken for a passing one.

Say what was not tested. Passing checks show that those saved tests passed. They do not show the app has no bugs, and the user should not hear otherwise.

If a summary contains a `feedback` field, add one closing line with the links. Do not add links when it is absent.

## Fixing

Offer to fix regressions first, then new page problems, then the most severe open ones. Fix the cause, not the measurement: an image that carries meaning needs real alternative text, not an empty `alt`; a failing request needs the endpoint fixed, not the error swallowed. After a fix, re-run the affected checks with `--only`, then the full set, and report the result. A fix is done when the next run shows it.

## The `.bugradar` folder

| File | Purpose |
|---|---|
| `features.md`, `test-cases.md` | The feature list and the designed test cases |
| `checks.json`, `checks/` | The saved checks |
| `functional-last.json`, `last-run.json` | Comparison points for the next run |
| `functional-report.md`, `report.md` | Latest readable reports |
| `history.jsonl` | One line per run |
| `failures/` | Screenshots from failed browser flows |

The first time you create this folder, ask whether to commit it. Recommend committing the test cases and checks, since they are part of the project. The runner adds a `.gitignore` for `failures/`. Failure output in the reports can include whatever the app printed, so if the project logs secrets, suggest ignoring the report files too. Do not decide silently.

## Privacy

The scripts talk only to the app under test. They send nothing to BugRadar or anyone else and collect no usage data.
