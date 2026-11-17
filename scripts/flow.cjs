// BugRadar flow helper — for browser checks that act like a user.
//
// A flow check is a small .cjs file saved in the project (for example
// .bugradar/checks/TC-004-login.cjs) and listed in .bugradar/checks.json.
// The runner sets BUGRADAR_HELPER to this file, so a check starts with:
//
//   const { flow } = require(process.env.BUGRADAR_HELPER);
//
//   flow('Visitor can open the pricing page', async ({ page, expectText, expectUrl }) => {
//       await page.goto('/');
//       await page.getByRole('link', { name: 'Pricing' }).click();
//       await expectUrl(/\/pricing$/);
//       await expectText(page.getByRole('heading', { level: 1 }), 'Pricing');
//   });
//
// The process exits 0 when the flow passes and 1 when it fails. On failure a
// screenshot is saved to .bugradar/failures/ so a person can see what happened.
//
// The settings below exist to keep checks from failing for reasons that are not
// bugs: a fixed window size, animations reduced, and assertions that wait for
// the expected state instead of reading the page once.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ACTION_TIMEOUT_MS = 15000;
const NAVIGATION_TIMEOUT_MS = 30000;

async function launch() {
    const { chromium } = require('playwright');
    const args = (process.getuid?.() === 0 || process.env.CI) ? ['--no-sandbox'] : [];
    let lastError;
    for (const opts of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
        try { return await chromium.launch({ headless: true, args, ...opts }); }
        catch (e) { lastError = e; }
    }
    throw new Error('No browser could be started. Run "npx playwright install chromium" in the skill folder. ' +
        String(lastError?.message || lastError).split('\n')[0]);
}

/** Unique, obviously fake test identity so created records are easy to find and remove. */
function testUser(label = 'user') {
    const run = process.env.BUGRADAR_RUN_ID || String(Date.now());
    return {
        name: `BugRadar Test ${label}`,
        email: `bugradar-test+${label}-${run}@example.com`,
        password: `Br-${run}-Test!9`,
    };
}

/**
 * Keep trying until the condition holds or time runs out. Use this for anything
 * that becomes true a moment after an action, instead of a fixed sleep.
 * `fn` should return a truthy value on success, or throw / return falsy to retry.
 */
async function until(fn, { timeout = ACTION_TIMEOUT_MS, interval = 150, message = 'Condition was not met in time' } = {}) {
    const deadline = Date.now() + timeout;
    let lastError;
    for (;;) {
        try {
            const value = await fn();
            if (value) return value;
            lastError = undefined;
        } catch (e) { lastError = e; }
        if (Date.now() >= deadline) {
            const text = typeof message === 'function' ? message() : message;
            throw new Error(lastError ? `${text}: ${String(lastError.message || lastError).split('\n')[0]}` : text);
        }
        await new Promise((r) => setTimeout(r, interval));
    }
}

function makeExpectations(page) {
    const clean = (t) => String(t).replace(/\s+/g, ' ').trim();

    /** Waits until the element's visible text equals (string) or matches (RegExp) the expectation. */
    async function expectText(locator, expected, opts = {}) {
        let seen = '';
        await until(async () => {
            seen = clean(await locator.first().innerText({ timeout: 2000 }));
            return expected instanceof RegExp ? expected.test(seen) : seen === clean(expected);
        }, { ...opts, message: () => `Expected text ${expected instanceof RegExp ? expected : JSON.stringify(expected)}, last saw ${JSON.stringify(seen)}` });
    }

    /** Waits until the address matches. Pass a RegExp, or a string the URL must end with. */
    async function expectUrl(expected, opts = {}) {
        let seen = '';
        await until(() => {
            seen = page.url();
            return expected instanceof RegExp ? expected.test(seen) : seen.replace(/\/+$/, '').endsWith(String(expected).replace(/\/+$/, ''));
        }, { ...opts, message: () => `Expected URL ${expected}, last saw ${seen}` });
    }

    /** Waits until the element is visible. */
    async function expectVisible(locator, opts = {}) {
        await locator.first().waitFor({ state: 'visible', timeout: opts.timeout ?? ACTION_TIMEOUT_MS });
    }

    /** Waits until the element is gone or hidden. */
    async function expectHidden(locator, opts = {}) {
        await locator.first().waitFor({ state: 'hidden', timeout: opts.timeout ?? ACTION_TIMEOUT_MS });
    }

    return { expectText, expectUrl, expectVisible, expectHidden };
}

async function flow(title, fn) {
    const baseURL = (process.env.BUGRADAR_URL || '').replace(/\/+$/, '');
    if (!baseURL) {
        console.error('BUGRADAR_URL is not set. Run this check through run-checks.mjs with --url, or set base_url in checks.json.');
        process.exit(1);
    }

    let browser;
    let page;
    try {
        browser = await launch();
        const context = await browser.newContext({
            baseURL,
            viewport: { width: 1280, height: 800 },
            reducedMotion: 'reduce',
            locale: 'en-US',
            userAgent: 'BugRadarCheck/0.2 (functional check)',
        });
        context.setDefaultTimeout(ACTION_TIMEOUT_MS);
        context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
        page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));

        await fn({ page, context, baseURL, assert, testUser, pageErrors, until, ...makeExpectations(page) });

        console.log(`PASS ${title}`);
        await browser.close();
        process.exit(0);
    } catch (e) {
        console.error(`FAIL ${title}`);
        console.error(String(e?.message || e));
        try {
            if (page) {
                const dir = path.join(process.env.BUGRADAR_OUT || '.bugradar', 'failures');
                fs.mkdirSync(dir, { recursive: true });
                const file = path.join(dir, `${path.basename(process.argv[1], '.cjs')}.png`);
                await page.screenshot({ path: file, fullPage: true });
                console.error(`Screenshot: ${file}`);
                console.error(`Stopped at: ${page.url()}`);
            }
        } catch { /* a screenshot is a bonus, never the cause of failure */ }
        try { await browser?.close(); } catch { /* ignore */ }
        process.exit(1);
    }
}

module.exports = { flow, testUser, until, assert };
