#!/usr/bin/env node
// BugRadar functional checks — runs the project's saved checks and reports
// which EXISTING features still work after a change.
//
// A "check" is any command that exits 0 when the feature works: one of the
// project's own tests, an API call, or a browser flow written with the helper
// in flow.cjs. The same saved checks run every time, so results are comparable.
//
// Usage: node run-checks.mjs [--file .bugradar/checks.json] [--url http://localhost:3000]
//                            [--only TC-003] [--include-external] [--fail-on-regression]
//                            [--out .bugradar] [--no-save] [--no-retry] [--no-wait]

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.2.0';
const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

function parseArgs(argv) {
    const args = { file: null, out: '.bugradar', only: [], includeExternal: false, failOnRegression: false, save: true, retry: true, wait: true };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--file') args.file = argv[++i];
        else if (a === '--url') args.url = argv[++i];
        else if (a === '--out') args.out = argv[++i];
        else if (a === '--only') args.only.push(...String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean));
        else if (a === '--include-external') args.includeExternal = true;
        else if (a === '--fail-on-regression') args.failOnRegression = true;
        else if (a === '--no-save') args.save = false;
        else if (a === '--no-retry') args.retry = false;
        else if (a === '--no-wait') args.wait = false;
    }
    args.file ||= path.join(args.out, 'checks.json');
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
    return hostname === '0.0.0.0' || hostname.endsWith('.local') || hostname.endsWith('.test');
}

function tail(text, lines = 25) {
    return String(text).replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

function runCommand(check, env, cwd) {
    return new Promise((resolve) => {
        const started = Date.now();
        const timeoutMs = Math.max(5, Math.min(900, check.timeout_s || 120)) * 1000;
        let output = '';
        let timedOut = false;

        const child = spawn(check.command, { shell: true, cwd, env, windowsHide: true });
        const timer = setTimeout(() => {
            timedOut = true;
            if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            else child.kill('SIGKILL');
        }, timeoutMs);

        const collect = (d) => { output += d; if (output.length > 200000) output = output.slice(-100000); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', (e) => { output += `\n${e.message}`; });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                status: timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed',
                exit_code: code,
                duration_ms: Date.now() - started,
                output: tail(output),
            });
        });
    });
}

/** Checks started before the dev server is ready fail for the wrong reason, so wait for it. */
async function waitForServer(url, seconds = 30) {
    const deadline = Date.now() + seconds * 1000;
    let lastError = '';
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
            if (res.status) return true; // any HTTP answer means the server is up
        } catch (e) { lastError = String(e?.cause?.code || e?.message || e); }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return lastError || 'no response';
}

function compare(previous, results) {
    const before = new Map((previous?.results || []).map((r) => [r.id, r]));
    const out = { regressions: [], fixed: [], new_checks: [], still_failing: [], removed: [], flaky: [] };
    const isBad = (s) => s === 'failed' || s === 'timeout';
    for (const r of results) {
        const old = before.get(r.id);
        if (r.status === 'skipped') continue;
        if (r.status === 'flaky') out.flaky.push(r);
        if (!old || old.status === 'skipped') { out.new_checks.push(r); continue; }
        if (old.status === 'passed' && isBad(r.status)) out.regressions.push(r);
        else if (isBad(old.status) && r.status === 'passed') out.fixed.push(r);
        else if (isBad(old.status) && isBad(r.status)) out.still_failing.push(r);
    }
    const now = new Set(results.map((r) => r.id));
    for (const [id, r] of before) if (!now.has(id)) out.removed.push({ id, title: r.title, feature: r.feature });
    return out;
}

function renderReport(run, changes, firstRun) {
    const md = [];
    const c = run.counts;
    md.push('# BugRadar functional checks');
    md.push('');
    md.push(`${c.passed} passed · ${c.failed} failed · ${c.flaky} flaky · ${c.skipped} skipped — ${run.checked_at}`);
    md.push('');
    if (!firstRun) {
        md.push('## What changed since the last run');
        md.push('');
        if (!changes.regressions.length && !changes.fixed.length && !changes.new_checks.length) { md.push('Nothing changed.'); md.push(''); }
        if (changes.regressions.length) {
            md.push('### Broke since last run');
            changes.regressions.forEach((r) => md.push(`- **${r.id}** ${r.feature}: ${r.title}`));
            md.push('');
        }
        if (changes.fixed.length) {
            md.push('### Fixed');
            changes.fixed.forEach((r) => md.push(`- **${r.id}** ${r.feature}: ${r.title}`));
            md.push('');
        }
        if (changes.new_checks.length) {
            md.push('### New checks');
            changes.new_checks.forEach((r) => md.push(`- **${r.id}** ${r.feature}: ${r.title} — ${r.status}`));
            md.push('');
        }
    }
    const flaky = run.results.filter((r) => r.status === 'flaky');
    if (flaky.length) {
        md.push('## Flaky checks');
        md.push('');
        md.push('These failed, then passed when run again with no change to the app. The result cannot be trusted until the check is fixed.');
        flaky.forEach((r) => md.push(`- **${r.id}** ${r.feature}: ${r.title}`));
        md.push('');
    }
    md.push('## All checks');
    md.push('');
    md.push('| ID | Feature | Check | Priority | Result |');
    md.push('|---|---|---|---|---|');
    for (const r of run.results) {
        md.push(`| ${r.id} | ${r.feature} | ${r.title} | ${r.priority} | ${r.status}${r.skip_reason ? ` (${r.skip_reason})` : ''}${r.known_issue && r.status !== 'passed' ? ` (known: ${r.known_issue})` : ''} |`);
    }
    const bad = run.results.filter((r) => r.status === 'failed' || r.status === 'timeout' || r.status === 'flaky');
    if (bad.length) {
        md.push('');
        md.push('## Failure details');
        for (const r of bad) {
            md.push('');
            md.push(`### ${r.id} ${r.title}`);
            md.push('```');
            md.push(r.output || '(no output)');
            md.push('```');
        }
    }
    md.push('');
    md.push('A passing check means that one saved test passed. It does not prove the feature has no bugs.');
    return md.join('\n') + '\n';
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cwd = process.cwd();

    let plan;
    try { plan = JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8')); }
    catch (e) {
        fail(2, `No readable checks file at ${args.file}.`,
            e.code === 'ENOENT' ? 'Set up the feature list and checks first (see SKILL.md, "Functional checks").' : `Invalid JSON: ${e.message}`);
    }

    const checks = Array.isArray(plan.checks) ? plan.checks : [];
    if (!checks.length) fail(2, 'The checks file has no checks.', 'Add at least one check.');

    const ids = new Set();
    for (const c of checks) {
        if (!c.id || !c.command || !c.title) fail(2, 'Every check needs an id, a title and a command.', JSON.stringify(c));
        if (ids.has(c.id)) fail(2, `Duplicate check id ${c.id}.`, 'Check ids must be unique.');
        ids.add(c.id);
    }

    const baseUrl = args.url || plan.base_url || null;
    let nonLocal = false;
    if (baseUrl) {
        try { nonLocal = !isLocalHost(new URL(baseUrl).hostname); }
        catch { fail(2, `"${baseUrl}" is not a valid URL.`); }
    }

    const consent = plan.consent || {};
    const dataConsent = consent.create_test_data === true && !!consent.confirmed_at;
    const nonLocalConsent = consent.allow_non_local === true;

    const env = {
        ...process.env,
        BUGRADAR_URL: baseUrl || '',
        BUGRADAR_HELPER: path.join(SKILL_DIR, 'scripts', 'flow.cjs'),
        BUGRADAR_OUT: path.resolve(args.out),
        NODE_PATH: [path.join(SKILL_DIR, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    };

    const selected = checks
        .filter((c) => !args.only.length || args.only.includes(c.id))
        .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority || 'medium') - PRIORITY_ORDER.indexOf(b.priority || 'medium'));

    if (baseUrl && args.wait) {
        const up = await waitForServer(baseUrl);
        if (up !== true) fail(2, `The app at ${baseUrl} is not responding.`, `Start the app and try again. (${up})`);
    }

    const results = [];
    for (const check of selected) {
        const base = { id: check.id, feature: check.feature || 'General', title: check.title, known_issue: check.known_issue || undefined,
                       priority: check.priority || 'medium', technique: check.technique || null };

        // Gates. A skipped check is reported, never silently dropped.
        let skip = null;
        if (check.external_effects && !args.includeExternal) {
            skip = 'has real-world effects (messages, payments, emails); run only when the user asks, with --include-external';
        } else if (check.changes_data && !dataConsent) {
            skip = 'creates or changes data and consent is not recorded in checks.json';
        } else if (check.changes_data && nonLocal && !nonLocalConsent) {
            skip = 'changes data on a non-local address without allow_non_local consent';
        }
        if (skip) { results.push({ ...base, status: 'skipped', skip_reason: skip }); continue; }

        // Each attempt gets its own run id so generated test data never collides with the previous attempt.
        const attempt = () => runCommand(check, { ...env, BUGRADAR_RUN_ID: `${Date.now()}${Math.floor(Math.random() * 1000)}` }, cwd);
        let outcome = await attempt();
        let attempts = 1;

        // A check that fails and then passes with no change to the app is flaky.
        // It is reported as flaky, never as a clean pass, so it gets fixed.
        // Checks with real-world effects are never repeated automatically.
        const maxRetries = args.retry && !check.external_effects ? Math.max(0, Math.min(2, check.retries ?? plan.retries ?? 1)) : 0;
        if (outcome.status !== 'passed' && maxRetries > 0) {
            const first = outcome;
            for (let i = 0; i < maxRetries && outcome.status !== 'passed'; i++) { outcome = await attempt(); attempts++; }
            if (outcome.status === 'passed') outcome = { ...outcome, status: 'flaky', output: first.output };
        }
        results.push({ ...base, ...outcome, attempts, output: outcome.status === 'passed' ? undefined : outcome.output });
    }

    const outDir = path.resolve(args.out);
    const lastPath = path.join(outDir, 'functional-last.json');
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(lastPath, 'utf8')); } catch { /* first run */ }
    const firstRun = !previous;
    const partial = args.only.length > 0;

    const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    for (const r of results) counts[r.status === 'timeout' ? 'failed' : r.status]++;

    // A partial run (--only) must not erase the results of checks it did not run.
    let merged = results;
    if (partial && previous) {
        const fresh = new Map(results.map((r) => [r.id, r]));
        merged = [...previous.results.filter((r) => !fresh.has(r.id) && ids.has(r.id)), ...results];
    }

    const changes = compare(previous, partial ? results : merged);
    if (partial) changes.removed = [];
    const run = { version: VERSION, checked_at: new Date().toISOString(), base_url: baseUrl, counts, results: merged };

    if (args.save) {
        fs.mkdirSync(outDir, { recursive: true });
        const ignorePath = path.join(outDir, '.gitignore');
        if (!fs.existsSync(ignorePath)) fs.writeFileSync(ignorePath, 'failures/\n');
        fs.writeFileSync(lastPath, JSON.stringify(run, null, 2));
        fs.writeFileSync(path.join(outDir, 'functional-report.md'), renderReport({ ...run, results }, changes, firstRun));
        fs.appendFileSync(path.join(outDir, 'history.jsonl'), JSON.stringify({
            checked_at: run.checked_at, kind: 'functional', ...counts,
            regressions: firstRun ? null : changes.regressions.length, fixed: firstRun ? null : changes.fixed.length,
        }) + '\n');
    }

    const brief = (r) => ({ id: r.id, feature: r.feature, title: r.title, priority: r.priority, status: r.status, known_issue: r.known_issue,
                            output: r.output || undefined });

    console.log(JSON.stringify({
        ok: true,
        first_run: firstRun,
        partial_run: partial,
        counts,
        changes: firstRun ? null : {
            regressions: changes.regressions.map(brief),
            fixed: changes.fixed.map(({ id, feature, title }) => ({ id, feature, title })),
            new_checks: changes.new_checks.map(({ id, feature, title, status }) => ({ id, feature, title, status })),
            still_failing: changes.still_failing.map(({ id, feature, title, known_issue }) => ({ id, feature, title, known_issue })),
            removed: changes.removed,
        },
        flaky: results.filter((r) => r.status === 'flaky').map(brief),
        failing: results.filter((r) => r.status === 'failed' || r.status === 'timeout').map(brief),
        skipped: results.filter((r) => r.status === 'skipped').map(({ id, title, skip_reason }) => ({ id, title, skip_reason })),
        report_file: args.save ? path.join(args.out, 'functional-report.md') : null,
    }, null, 2));

    process.exit(args.failOnRegression && changes.regressions.length ? 1 : 0);
}

main().catch((e) => fail(2, 'The check runner crashed.', String(e?.stack || e).split('\n').slice(0, 3).join(' ')));
