# Designing test cases

Read this before writing or changing test cases. It follows the test design techniques and terms taught in the ISTQB Foundation syllabus. It is a working guide, not a certification, so describe the output as "designed with ISTQB test techniques", never as "ISTQB certified" or "ISTQB compliant".

## Contents
1. What to test first (risk)
2. Deriving test conditions from the project
3. Techniques and when to use each
4. Test case format
5. Turning a test case into a saved check
6. Quality rules for checks
7. Avoiding flaky checks
8. Choosing what to re-run after a change
9. Worked example

## 1. What to test first (risk)

There is never time to test everything, so order by product risk: how likely a feature is to break, multiplied by how much it hurts when it does.

| Priority | Meaning | Typical features |
|---|---|---|
| critical | The app is unusable or loses money or data without it | Sign-up, login, checkout, payment, saving the user's main work |
| high | A main feature most users touch | Search, core create/edit/delete, the main dashboard |
| medium | Useful but users can work around a failure | Filters, profile settings, exports |
| low | Cosmetic or rarely used | Footer links, optional preferences |

Raise the priority of anything changed recently, anything with complex rules, and anything that failed before. Defects cluster: an area that produced bugs tends to produce more.

Aim for a small set that covers the critical and high features well. Ten sharp checks that run every time beat sixty that nobody trusts.

## 2. Deriving test conditions from the project

The test basis is whatever says what the app should do. Use, in this order of trust:

1. What the user states in the conversation.
2. Written requirements, specs, README and docs in the project.
3. Existing automated tests (they encode intended behaviour).
4. The code itself: routes, controllers, validation rules, database constraints.

Code shows what the app does, not what it should do. When code is the only source, the test case records current behaviour, so confirm with the user that the behaviour is intended before treating it as the expected result. If two sources disagree, ask rather than pick one.

List features first, then for each feature list test conditions (the things worth verifying), then design test cases for the conditions.

## 3. Techniques and when to use each

**Equivalence partitioning.** Split inputs into groups the app should treat the same way, then test one value from each group, valid and invalid. Use for any input with rules. Example, an age field accepting 18 to 65: one test at 30 (valid), one at 10 (too low), one at 80 (too high), one with letters (wrong type).

**Boundary value analysis.** Bugs gather at the edges of partitions. For each boundary test the value on it and the values just either side. Same field: 17, 18, 65, 66. Use for ranges, lengths, quantities, dates and limits.

**Decision table.** When the outcome depends on a combination of conditions, list the conditions as rows and each meaningful combination as a column with its expected outcome. Use for pricing rules, discounts, permissions, eligibility.

**State transition.** When the same action gives different results depending on what happened before, list states, the events that move between them, and the invalid moves that must be refused. Use for orders (pending, paid, shipped, cancelled), accounts (unverified, active, locked), subscriptions.

**Use case testing.** Walk a real user goal from start to finish: the main path, then the important alternatives and failures. Use for the critical journeys. These become browser flow checks.

**Error guessing.** Add the cases experience says break things: empty submission, very long text, double click on submit, special characters and emoji, leading and trailing spaces, the back button after submit, an expired session.

Every feature needs at least one positive test (it works when used correctly) and, where it accepts input, one negative test (it refuses bad input with a clear message).

## 4. Test case format

Record test cases in `.bugradar/test-cases.md`, one block per case:

```markdown
### TC-007 Login refuses a wrong password
- Feature: Login
- Priority: critical
- Technique: equivalence partitioning (invalid credentials)
- Source: routes/auth.php, LoginRequest validation; confirmed by user
- Preconditions: a registered test user exists
- Test data: registered email, password "wrong-password"
- Steps:
  1. Open /login.
  2. Enter the registered email and the wrong password.
  3. Submit the form.
- Expected result: the page stays on /login and shows "These credentials do not match our records". No session is created.
- Changes data: no
- Automated by: .bugradar/checks/TC-007-login-wrong-password.cjs
```

Rules:
- One test case verifies one thing. If the title needs "and", split it.
- The expected result is specific and observable: an exact message, URL, status code or stored value. "Works correctly" is not an expected result.
- IDs are permanent. Never reuse or renumber an ID, because results are compared across runs by ID.
- `Source` keeps traceability: which requirement, file or statement the case comes from. When that source changes, the case is reviewed.

## 5. Turning a test case into a saved check

Each automated test case gets one entry in `.bugradar/checks.json` whose command exits 0 on pass. Choose the cheapest level that proves the behaviour:

1. **An existing project test.** If the project already tests this, point the check at it (`php artisan test --filter=LoginTest`, `npx vitest run auth`, `pytest tests/test_auth.py`). Do not duplicate it.
2. **A new test in the project's own framework**, following the project's conventions, when a framework is set up. This is the best home for logic and API behaviour.
3. **A browser flow** using the helper, for user journeys through the interface. Save it as `.bugradar/checks/<ID>-<slug>.cjs`.

A flow check:

```js
const { flow } = require(process.env.BUGRADAR_HELPER);

flow('Login refuses a wrong password', async ({ page, expectVisible, expectUrl }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('existing-user@example.com');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expectVisible(page.getByText('These credentials do not match our records'));
    await expectUrl(/\/login$/);
});
```

What the helper passes to a flow:

| Name | Use |
|---|---|
| `page`, `context`, `baseURL` | The Playwright page and context. Relative paths in `page.goto('/login')` resolve against the app's address. |
| `expectText(locator, expected)` | Waits until the element's text equals a string or matches a RegExp. |
| `expectUrl(expected)` | Waits until the address matches a RegExp or ends with a string. |
| `expectVisible(locator)`, `expectHidden(locator)` | Wait until an element appears or goes away. |
| `until(fn, { timeout, message })` | Keeps calling `fn` until it returns a truthy value. For anything the others do not cover. |
| `testUser(label)` | A unique, obviously fake name, email and password for flows that register an account. |
| `pageErrors` | Uncaught JavaScript errors seen so far. Assert it is empty when the flow should be error-free. |
| `assert` | Node's strict assert, for values you already hold. |

Use the `expect...` helpers for anything on the page, because they wait. Reading the page once (`await locator.innerText()` followed by `assert.equal`) checks a single instant and fails whenever the app is a moment slower than usual.

## 6. Quality rules for checks

- **Independent.** Each check sets up what it needs and passes when run alone or in any order. A check that needs another to run first will fail for the wrong reason.
- **Repeatable.** Running twice gives the same result. Use unique test data per run (`testUser`) so the second run does not hit "email already taken".
- **Stable selectors.** Prefer role, label and visible text (`getByRole`, `getByLabel`, `getByText`) over CSS classes or position, which change with styling.
- **Wait for outcomes, not time.** Wait for the element or URL that proves the step finished. Never use fixed sleeps. Section 7 lists the common causes of flaky checks.
- **Assert the expected result.** A flow that only clicks through without an assertion passes when the feature is broken.
- **Clean up.** Remove what the check created when the app offers a way. Otherwise list the leftover in the report so the user can clear it.
- **See it fail once.** A check that has never failed has not been shown to test anything. See "Proving a check can fail" below.

### Proving a check can fail

There are two ways, and they prove different things.

**Break the expectation** (the minimum, always safe). Change the expected value in the check, run it, see it fail, change it back. This proves the assertion runs. It does not prove the check is looking at the right thing.

**Break the app** (stronger, for critical and high checks). Make a small temporary change to the app code that removes the behaviour, such as returning early, flipping a condition or renaming a keyword, then run the check. If it still passes, the check is not testing what its title says. This is how you find a test that set up a successful fake and then "tested" a failure, or one that passes whether the work is queued or done inline.

Breaking the app touches the user's code, so do it carefully:

1. Tell the user first, in one line, that you will temporarily break and then restore app files.
2. Only on a local copy. Never on a deployed app, and never while the user is relying on the running app, because the dev server serves the broken code while you test.
3. Copy each file you will change to a scratch location outside the project before the first change. Do not rely on `git checkout` to restore, because the file may hold uncommitted work that git would discard.
4. Make each change with a small script that fails loudly when the text to replace is not found. Do not use shell one-liners with regular expressions; quoting errors make them apply partly or not at all, and the result looks like a passing check.
5. Confirm the change was applied before trusting the result (for example with `git diff --stat`).
6. Restore from the copies, then prove the restore: compare each file with its copy and report that they match. Do this even when a step failed.

A check that passes against a broken app is a finding. Fix the check, then repeat the break to confirm it now fails.

## 7. Avoiding flaky checks

A flaky check fails sometimes with no change to the app. It is worse than no check: people learn to ignore failures, and then a real one gets ignored too. The runner re-runs a failed check once and reports it as **flaky** if the second attempt passes. Treat a flaky result as a defect in the check and fix it the same day.

Most flakiness comes from a short list of causes.

| Cause | What it looks like | Fix |
|---|---|---|
| Fixed sleeps | `waitForTimeout(2000)` passes on a fast machine, fails on a slow one | Wait for the outcome: `expectVisible`, `expectText`, `expectUrl` |
| One-shot reads | `assert.equal(await el.innerText(), 'Saved')` runs before the text updates | `await expectText(el, 'Saved')` |
| Acting before the page is ready | In React, Vue or similar apps a click lands before the button's handler is attached, and nothing happens | After `goto`, wait for something that only exists once the app has started (data loaded, a control enabled), then act |
| Not waiting for the result of a click | The next step runs while the form is still submitting | After submit, wait for the new URL, the success message, or the response: `await Promise.all([page.waitForResponse(r => r.url().includes('/api/orders') && r.ok()), button.click()])` |
| Brittle selectors | `.btn-primary:nth-child(3)` breaks when styling or order changes | `getByRole`, `getByLabel`, `getByText`; ask for a `data-testid` when nothing stable exists |
| Ambiguous selectors | `getByText('Save')` matches two buttons and picks a different one after a layout change | Narrow it: `getByRole('button', { name: 'Save', exact: true })`, or scope to a region first |
| Reused test data | Second run fails with "email already taken" | `testUser()` gives unique values on every attempt |
| Order dependence | TC-005 passes only after TC-004 created a record | Each check creates what it needs. Run it alone with `--only` to prove it |
| Shared state left behind | A logged-in session, a full cart or a changed setting from an earlier check | Every flow starts in a fresh browser context; for server-side state, set up and clean up inside the check |
| Time and dates | Passes all day, fails near midnight or on the 31st; fails in another time zone | Do not assert on "today" computed in the test. Assert on a pattern, or use fixed dates in test data |
| Third-party services | Fails when a payment sandbox, map or analytics script is slow | Do not assert on things the app does not control. Check the app's own behaviour up to the hand-off |
| Animations and toasts | An element is "not stable" mid-animation; a toast disappears before it is read | Animations are reduced by the helper. Assert on a toast as soon as it appears, or assert the lasting result instead |
| Lists in no fixed order | Asserting the first row is "Alice" when the order is not guaranteed | Find the row by its content, not its position |
| Server not ready | The first check of a run fails, the rest pass | The runner waits for the app to answer before starting. Do not turn this off |

When a check is reported flaky:

1. Read the saved output from the failed attempt and look at the screenshot in `.bugradar/failures/`.
2. Match it to a cause above and fix the check.
3. Prove the fix by running it several times: `--only TC-005` five times in a row should give five passes.

Do not fix flakiness by raising timeouts across the board or adding retries. Both make the suite slower and hide the cause. A longer timeout is right only for a step that is slow by nature, such as a file upload, and belongs on that step alone.

Sometimes the flakiness is in the app: a race between two requests, a button that works only after a delay. That is a real bug that real users hit. Report it as one.

## 8. Choosing what to re-run after a change

Two different activities follow a change:

- **Confirmation testing:** re-run the checks for the thing that was changed or fixed, to confirm it now works.
- **Regression testing:** re-run the checks for everything else, to confirm the change did not break it.

The default is to run the whole saved set, because the set is kept small. If it grows slow, run critical and high checks every time and the rest before a release, and say so in the report.

When behaviour changes on purpose, the old test case is now wrong. Update its expected result and note the reason. Do not delete a failing check to make the report clean.

## 9. Worked example

Feature: "Promo code field at checkout. Codes are 6 to 10 characters. SAVE10 gives 10% off orders of 50 or more. A code can be used once per account."

| ID | Title | Technique | Priority |
|---|---|---|---|
| TC-021 | Valid code on an order of 50 gives 10% off | boundary value (minimum order) | critical |
| TC-022 | Valid code on an order of 49.99 is refused with the minimum-order message | boundary value | high |
| TC-023 | Code of 5 characters is refused as invalid | boundary value (length) | medium |
| TC-024 | Code of 11 characters is refused as invalid | boundary value (length) | medium |
| TC-025 | Unknown code of valid length is refused | equivalence partitioning | high |
| TC-026 | A code already used by this account is refused | state transition (unused to used) | high |
| TC-027 | Lower-case "save10" is handled as the spec says | error guessing; ask the user if the spec is silent | medium |

Seven cases cover the rule. TC-027 shows the right move when the test basis has a gap: ask, record the answer as the expected result.
