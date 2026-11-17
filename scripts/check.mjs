#!/usr/bin/env node
// BugRadar check — measured, read-only quality check for a web app you own.
//
// What it does: opens the app in a real browser, visits a handful of pages,
// records only things it can measure (accessibility rule failures, JavaScript
// errors, failed requests, broken internal links, a few page basics), then
// compares the result with the previous run so you see what CHANGED.
//
// What it never does: click buttons, submit forms, log in, or send any data
// anywhere. Everything it writes stays in the output folder (default .bugradar/).
//
// Usage: node check.mjs --url http://localhost:3000 [--max-pages 8] [--out .bugradar]
//                       [--confirm-owned] [--fail-on-new] [--no-save]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// ── Set these two links before publishing ────────────────────────────────────
const FEEDBACK_URL  = 'https://docs.google.com/forms/d/e/1FAIpQLScMnga_Koq_9MsNpAI4hwMWLg7YjJWodpqwdHPa3D4MXzzZ6Q/viewform';
const COMMUNITY_URL = 'REPLACE_WITH_COMMUNITY_URL';
// ─────────────────────────────────────────────────────────────────────────────

const VERSION = '0.2.0';
const PENALTY = { critical: 12, high: 7, medium: 3, low: 1 };
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const SKIP_EXT = /\.(pdf|zip|png|jpe?g|gif|svg|webp|ico|mp4|mp3|woff2?|ttf|css|js|json|xml|txt|csv|docx?|xlsx?)$/i;

function parseArgs(argv) {
    const args = { maxPages: 8, out: '.bugradar', confirmOwned: false, failOnNew: false, save: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--url') args.url = argv[++i];
        else if (a === '--max-pages') args.maxPages = Math.max(1, Math.min(25, parseInt(argv[++i], 10) || 8));
        else if (a === '--out') args.out = argv[++i];
        else if (a === '--confirm-owned') args.confirmOwned = true;
        else if (a === '--fail-on-new') args.failOnNew = true;
        else if (a === '--no-save') args.save = false;
        else if (a === '--help' || a === '-h') args.help = true;
    }
    return args;
}

function fail(code, message, hint) {
    console.log(JSON.stringify({ ok: false, error: message, hint }, null, 2));
    process.exit(code);
}

function isLocalHost(hostname) {
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]') return true;
    if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (hostname === '0.0.0.0' || hostname.endsWith('.local') || hostname.endsWith('.test')) return true;
    return false;
}

/** Same page regardless of #hash, query string or trailing slash. */
function pageKey(u) {
    const url = new URL(u);
    let p = url.pathname.replace(/\/+$/, '');
    return p === '' ? '/' : p;
}

/** Strip the parts of a message that change between runs (numbers, ids, hosts). */
function normaliseMessage(text) {
    return String(text)
        .replace(/https?:\/\/[^\s'")]+/g, (m) => { try { return new URL(m).pathname; } catch { return m; } })
        .replace(/\b[0-9a-f]{8,}\b/gi, '#')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

async function loadDeps() {
    const require = createRequire(import.meta.url);
    try {
        const { chromium } = require('playwright');
        const axeMod = require('@axe-core/playwright');
        const AxeBuilder = axeMod.AxeBuilder ?? axeMod.default?.AxeBuilder ?? axeMod.default ?? axeMod;
        return { chromium, AxeBuilder };
    } catch (e) {
        fail(2, 'Dependencies are not installed.',
            `Run "npm install" inside ${path.dirname(path.dirname(new URL(import.meta.url).pathname))} and try again.`);
    }
}

async function launchBrowser(chromium) {
    const args = (process.getuid?.() === 0 || process.env.CI) ? ['--no-sandbox'] : [];
    const attempts = [{}, { channel: 'chrome' }, { channel: 'msedge' }];
    let lastError;
    for (const opts of attempts) {
        try { return await chromium.launch({ headless: true, args, ...opts }); }
        catch (e) { lastError = e; }
    }
    fail(2, 'No browser could be started.',
        'Run "npx playwright install chromium" inside the skill folder, or install Google Chrome. ' +
        `Last error: ${String(lastError?.message || lastError).split('\n')[0]}`);
}

// ── Issue collection ─────────────────────────────────────────────────────────
// One issue per ROOT CAUSE. The same broken header on eight pages is one issue
// that lists eight pages, not eight issues.

class IssueBook {
    constructor() { this.map = new Map(); }

    add({ id, category, severity, title, help, instance, page, url }) {
        let issue = this.map.get(id);
        if (!issue) {
            issue = { id, category, severity, title, help: help || null, url: url || null,
                      instances: new Set(), pages: new Set() };
            this.map.set(id, issue);
        }
        if (instance) issue.instances.add(instance);
        if (page) issue.pages.add(page);
        if (SEVERITY_ORDER.indexOf(severity) < SEVERITY_ORDER.indexOf(issue.severity)) issue.severity = severity;
    }

    list() {
        return [...this.map.values()]
            .map((i) => ({
                id: i.id, category: i.category, severity: i.severity, title: i.title,
                help: i.help, url: i.url,
                count: Math.max(i.instances.size, 1),
                examples: [...i.instances].slice(0, 5),
                pages: [...i.pages].sort().slice(0, 10),
            }))
            .sort((a, b) =>
                SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.id.localeCompare(b.id));
    }
}

const AXE_SEVERITY = { critical: 'critical', serious: 'high', moderate: 'medium', minor: 'low' };

async function checkPage(context, AxeBuilder, url, origin, book) {
    const page = await context.newPage();
    const key = pageKey(url);
    const result = { key, status: null, links: [], lcp_ms: null, load_ms: null };

    page.on('pageerror', (err) => {
        const msg = normaliseMessage(err.message);
        book.add({ id: `js-error|${msg}`, category: 'javascript', severity: 'high',
                   title: `Uncaught JavaScript error: ${msg}`, page: key, instance: msg });
    });
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const msg = normaliseMessage(m.text());
        // The browser logs its own line for every failed request; those are
        // reported once, properly, by the request checks below.
        if (/^Failed to load resource/i.test(msg)) return;
        book.add({ id: `console|${msg}`, category: 'javascript', severity: 'medium',
                   title: `Console error: ${msg}`, page: key, instance: msg });
    });
    page.on('requestfailed', (req) => {
        const failure = req.failure()?.errorText || 'failed';
        if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) return; // navigation cancelled it — not a fault
        let target; try { const u = new URL(req.url()); target = (u.origin === origin ? '' : u.host) + u.pathname; } catch { target = req.url(); }
        book.add({ id: `request|${req.method()} ${target}|failed`, category: 'network', severity: 'medium',
                   title: `Request never completed: ${req.method()} ${target}`, help: failure, page: key, instance: target });
    });
    page.on('response', (res) => {
        const status = res.status();
        if (status < 400) return;
        const req = res.request();
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) return; // handled as a page/link issue
        let target; try { const u = new URL(res.url()); target = (u.origin === origin ? '' : u.host) + u.pathname; } catch { target = res.url(); }
        book.add({ id: `request|${req.method()} ${target}|${status}`, category: 'network',
                   severity: status >= 500 ? 'high' : 'medium',
                   title: `${req.method()} ${target} returned ${status}`, page: key, instance: target });
    });

    try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        result.status = response?.status() ?? null;
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    } catch (e) {
        result.error = String(e.message || e).split('\n')[0];
        await page.close().catch(() => {});
        return result;
    }

    if (result.status && result.status >= 400) {
        await page.close().catch(() => {});
        return result;
    }

    const facts = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
        const nav = performance.getEntriesByType('navigation')[0];
        return {
            links,
            hasViewport: !!document.querySelector('meta[name="viewport"]'),
            hasDescription: !!document.querySelector('meta[name="description"][content]:not([content=""])'),
            load_ms: nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd || 0) : null,
        };
    }).catch(() => null);

    if (facts) {
        result.links = facts.links;
        result.load_ms = facts.load_ms;
        if (!facts.hasViewport) {
            book.add({ id: 'basics|viewport', category: 'basics', severity: 'medium',
                       title: 'Page has no viewport meta tag, so it will not scale properly on phones',
                       page: key, instance: key });
        }
        if (!facts.hasDescription) {
            book.add({ id: 'basics|meta-description', category: 'basics', severity: 'low',
                       title: 'Page has no meta description for search results and link previews',
                       page: key, instance: key });
        }
    }

    result.lcp_ms = await page.evaluate(() => new Promise((resolve) => {
        let value = null;
        try {
            const po = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) value = Math.round(e.startTime);
            });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => { po.disconnect(); resolve(value); }, 300);
        } catch { resolve(null); }
    })).catch(() => null);

    try {
        const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
        for (const v of axe.violations) {
            for (const node of v.nodes) {
                const selector = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
                book.add({ id: `a11y|${v.id}`, category: 'accessibility',
                           severity: AXE_SEVERITY[v.impact] || 'medium',
                           title: v.help, help: v.description, url: v.helpUrl,
                           page: key, instance: selector });
            }
        }
    } catch (e) {
        result.axe_error = String(e.message || e).split('\n')[0];
    }

    await page.close().catch(() => {});
    return result;
}

function computeScore(issues) {
    const lost = issues.reduce((sum, i) => sum + (PENALTY[i.severity] || 0), 0);
    return Math.max(0, 100 - lost);
}

function diff(previous, issues) {
    const before = new Map((previous?.issues || []).map((i) => [i.id, i]));
    const after = new Map(issues.map((i) => [i.id, i]));
    const out = { new: [], fixed: [], worsened: [], improved: [], unchanged: 0 };
    for (const [id, issue] of after) {
        const old = before.get(id);
        if (!old) out.new.push(issue);
        else if (issue.count > old.count) out.worsened.push({ ...issue, previous_count: old.count });
        else if (issue.count < old.count) out.improved.push({ ...issue, previous_count: old.count });
        else out.unchanged++;
    }
    for (const [id, issue] of before) if (!after.has(id)) out.fixed.push(issue);
    return out;
}

function countBySeverity(issues) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of issues) counts[i.severity]++;
    return counts;
}

function line(issue, extra = '') {
    const where = issue.pages.length ? ` — ${issue.category === 'links' ? 'linked from' : 'on'} ${issue.pages.slice(0, 3).join(', ')}${issue.pages.length > 3 ? ` +${issue.pages.length - 3} more` : ''}` : '';
    const n = issue.count > 1 ? ` (${issue.count} places${extra})` : '';
    return `- **[${issue.severity}]** ${issue.title}${n}${where}`;
}

function renderReport(run, changes, firstRun) {
    const md = [];
    md.push(`# BugRadar check — ${run.url}`);
    md.push('');
    md.push(`Score: **${run.score}/100**${run.score_change != null ? ` (${run.score_change >= 0 ? '+' : ''}${run.score_change} since last run)` : ''}  `);
    md.push(`Pages checked: ${run.pages.length} · ${run.checked_at}`);
    md.push('');
    if (firstRun) {
        md.push('This is the first run, so everything below is the starting point. Later runs show only what changed.');
        md.push('');
    } else {
        md.push('## What changed since the last run');
        md.push('');
        if (!changes.new.length && !changes.worsened.length && !changes.fixed.length && !changes.improved.length) {
            md.push('Nothing changed.');
        }
        if (changes.new.length) { md.push('### New problems'); changes.new.forEach((i) => md.push(line(i))); md.push(''); }
        if (changes.worsened.length) { md.push('### Got worse'); changes.worsened.forEach((i) => md.push(line(i, `, was ${i.previous_count}`))); md.push(''); }
        if (changes.fixed.length) { md.push('### Fixed'); changes.fixed.forEach((i) => md.push(`- ${i.title}`)); md.push(''); }
        if (changes.improved.length) { md.push('### Improved'); changes.improved.forEach((i) => md.push(line(i, `, was ${i.previous_count}`))); md.push(''); }
        md.push('');
    }
    md.push('## All open problems');
    md.push('');
    if (!run.issues.length) md.push('None found by these checks.');
    for (const sev of SEVERITY_ORDER) {
        const group = run.issues.filter((i) => i.severity === sev);
        if (!group.length) continue;
        md.push(`### ${sev[0].toUpperCase()}${sev.slice(1)} (${group.length})`);
        for (const i of group) {
            md.push(line(i));
            if (i.examples.length && i.category === 'accessibility') md.push(`  - elements: \`${i.examples.slice(0, 3).join('`, `')}\``);
            if (i.url) md.push(`  - how to fix: ${i.url}`);
        }
        md.push('');
    }
    md.push('## How the score works');
    md.push('');
    md.push('Start at 100. Each open problem costs points by severity: critical 12, high 7, medium 3, low 1. ');
    md.push('The same problem on many pages counts once. The score is calculated by the script, not estimated by an AI.');
    md.push('');
    md.push('## What this check does not cover');
    md.push('');
    md.push('It does not log in, click buttons, submit forms or test security. Automated accessibility rules catch only part of real accessibility problems. A clean report means these checks found nothing, not that the app has no bugs.');
    if (!FEEDBACK_URL.startsWith('REPLACE')) {
        md.push('');
        md.push(`---\nFeedback or a missing check? ${FEEDBACK_URL}${COMMUNITY_URL.startsWith('REPLACE') ? '' : ` · Community: ${COMMUNITY_URL}`}`);
    }
    return md.join('\n') + '\n';
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.url) {
        console.log('Usage: node check.mjs --url http://localhost:3000 [--max-pages 8] [--out .bugradar] [--confirm-owned] [--fail-on-new] [--no-save]');
        process.exit(args.help ? 0 : 2);
    }

    let start;
    try { start = new URL(args.url); } catch { fail(2, `"${args.url}" is not a valid URL.`, 'Include the scheme, for example http://localhost:3000'); }
    if (!/^https?:$/.test(start.protocol)) fail(2, 'Only http and https URLs can be checked.');
    if (!isLocalHost(start.hostname) && !args.confirmOwned) {
        fail(3, `${start.hostname} is not a local address.`,
            'This tool is for apps you own or have permission to test. If that is the case, run again with --confirm-owned.');
    }

    const { chromium, AxeBuilder } = await loadDeps();
    const browser = await launchBrowser(chromium);
    const context = await browser.newContext({ userAgent: `BugRadarCheck/${VERSION} (+read-only quality check)` });
    const book = new IssueBook();
    const origin = start.origin;

    const queue = [start.href];
    const seen = new Set([pageKey(start.href)]);
    const linkedFrom = new Map(); // pageKey -> first page that links to it
    const pages = [];
    const uncrawled = new Map(); // pageKey -> full url

    while (queue.length && pages.length < args.maxPages) {
        const url = queue.shift();
        const result = await checkPage(context, AxeBuilder, url, origin, book);

        if (pages.length === 0 && (result.error || !result.status)) {
            await browser.close();
            fail(2, `Could not open ${url}.`,
                `Is the app running? ${result.error || ''}`.trim());
        }

        if (result.error || (result.status && result.status >= 400)) {
            const from = linkedFrom.get(result.key);
            book.add({ id: `link|${result.key}`, category: 'links', severity: 'high',
                       title: `Broken page: ${result.key} ${result.status ? `returns ${result.status}` : 'does not load'}`,
                       help: result.error || null, page: from || result.key, instance: result.key });
        } else {
            pages.push({ path: result.key, status: result.status, load_ms: result.load_ms, lcp_ms: result.lcp_ms });
        }

        for (const href of result.links) {
            let u; try { u = new URL(href); } catch { continue; }
            if (u.origin !== origin || !/^https?:$/.test(u.protocol) || SKIP_EXT.test(u.pathname)) continue;
            const key = pageKey(u.href);
            if (seen.has(key)) continue;
            seen.add(key);
            linkedFrom.set(key, result.key);
            u.hash = '';
            queue.push(u.href);
        }
    }

    // Pages we did not open in the browser still get a cheap "does it exist" check.
    for (const url of queue.slice(0, 60)) uncrawled.set(pageKey(url), url);
    for (const [key, url] of uncrawled) {
        try {
            const res = await context.request.get(url, { timeout: 15000, maxRedirects: 5 });
            if (res.status() >= 400) {
                book.add({ id: `link|${key}`, category: 'links', severity: 'high',
                           title: `Broken page: ${key} returns ${res.status()}`,
                           page: linkedFrom.get(key) || key, instance: key });
            }
        } catch (e) {
            book.add({ id: `link|${key}`, category: 'links', severity: 'high',
                       title: `Broken page: ${key} does not load`,
                       help: String(e.message || e).split('\n')[0], page: linkedFrom.get(key) || key, instance: key });
        }
    }

    await browser.close();

    const issues = book.list();
    const outDir = path.resolve(args.out);
    const lastPath = path.join(outDir, 'last-run.json');
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(lastPath, 'utf8')); } catch { /* first run */ }

    // Comparing two different sites would report nonsense, so a different site
    // starts a fresh comparison point. Local addresses are treated as the same
    // app because dev servers change port between sessions.
    let baselineReset = null;
    if (previous?.url) {
        try {
            const before = new URL(previous.url);
            const sameApp = (isLocalHost(before.hostname) && isLocalHost(start.hostname)) || before.hostname === start.hostname;
            if (!sameApp) { baselineReset = `previous run checked ${before.hostname}`; previous = null; }
        } catch { previous = null; }
    }

    const firstRun = !previous;
    const changes = diff(previous, issues);
    const score = computeScore(issues);
    const run = {
        version: VERSION,
        url: start.href,
        checked_at: new Date().toISOString(),
        score,
        score_change: firstRun ? null : score - (previous.score ?? score),
        pages,
        issues,
    };

    let runNumber = 1;
    if (args.save) {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(lastPath, JSON.stringify(run, null, 2));
        fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(run, changes, firstRun));
        const historyPath = path.join(outDir, 'history.jsonl');
        fs.appendFileSync(historyPath, JSON.stringify({
            checked_at: run.checked_at, score, open: issues.length, ...countBySeverity(issues),
            new: firstRun ? null : changes.new.length, fixed: firstRun ? null : changes.fixed.length,
        }) + '\n');
        runNumber = fs.readFileSync(historyPath, 'utf8').trim().split('\n').filter((l) => !l.includes('"kind":"functional"')).length;
    }

    const brief = (i) => ({ severity: i.severity, category: i.category, title: i.title, count: i.count,
                            previous_count: i.previous_count, pages: i.pages.slice(0, 5),
                            examples: i.examples.slice(0, 3), fix_guide: i.url || undefined });

    const summary = {
        ok: true,
        first_run: firstRun,
        baseline_reset: baselineReset || undefined,
        score,
        score_change: run.score_change,
        pages_checked: pages.length,
        pages_not_opened: Math.max(0, queue.length),
        open_problems: { total: issues.length, ...countBySeverity(issues) },
        changes: firstRun ? null : {
            new: changes.new.map(brief),
            worsened: changes.worsened.map(brief),
            fixed: changes.fixed.map((i) => ({ severity: i.severity, title: i.title })),
            improved: changes.improved.map(brief),
            unchanged: changes.unchanged,
        },
        top_open: issues.slice(0, firstRun ? 12 : 5).map(brief),
        report_file: args.save ? path.join(args.out, 'report.md') : null,
        data_file: args.save ? path.join(args.out, 'last-run.json') : null,
    };

    const showFeedback = !FEEDBACK_URL.startsWith('REPLACE') && (runNumber === 1 || runNumber === 5 || runNumber % 20 === 0);
    if (showFeedback) {
        summary.feedback = { form: FEEDBACK_URL, community: COMMUNITY_URL.startsWith('REPLACE') ? undefined : COMMUNITY_URL };
    }

    console.log(JSON.stringify(summary, null, 2));

    const blocking = [...changes.new, ...changes.worsened].some((i) => i.severity === 'critical' || i.severity === 'high');
    process.exit(args.failOnNew && !firstRun && blocking ? 1 : 0);
}

main().catch((e) => fail(2, 'The check crashed.', String(e?.stack || e).split('\n').slice(0, 3).join(' ')));
