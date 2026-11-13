// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Measures a cold start of a packaged build: how long until the window is shown, until it has content, and until the
// terminal in the restored tab has a shell prompt. Runs under a throwaway "bench" profile, so it never touches real
// data and can run while the installed app is open.
//
//   node ops/measure-startup.mjs [--app <dir with Wavelet.exe>] [--runs N] [--port N] [--timeline]
//
// --timeline adds the milestones the tab records on its way (the "wave:" performance marks set in frontend/wave.ts
// and in the terminal view), as medians over the runs.
//
// The first launch creates the profile and takes whatever antivirus does to a binary it has not seen; it is not
// counted. Close other heavy work first: builds running at the same time easily double the numbers.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
function takeOpt(name, defaultValue) {
    const idx = args.indexOf(name);
    return idx >= 0 ? args.splice(idx, 2)[1] : defaultValue;
}
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appDir = path.resolve(takeOpt("--app", path.join(repoRoot, "make", "win-unpacked")));
const runs = Number(takeOpt("--runs", "5"));
const timeline = args.includes("--timeline");
const port = takeOpt("--port", "9466");
const exe = path.join(appDir, "Wavelet.exe");
const cdp = path.join(repoRoot, "ops", "cdp.mjs");

const ProfileName = "bench";
const profileDirs = [
    path.join(process.env.LOCALAPPDATA, `wavelet-${ProfileName}`),
    path.join(os.homedir(), ".config", `wavelet-${ProfileName}`),
    path.join(process.env.APPDATA, `wavelet-${ProfileName}`),
];
const logFile = path.join(profileDirs[0], "Data", "waveapp.log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function removeProfile() {
    for (const dir of profileDirs) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
}

function cdpEval(expression) {
    return execFileSync(process.execPath, [cdp, "eval", "active", expression, "--port", port], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function logLinesSince(offset) {
    if (!existsSync(logFile)) {
        return [];
    }
    return readFileSync(logFile, "utf8").slice(offset).split(/\r?\n/);
}

function logTime(line) {
    // "2026-11-12 16:14:08.093 ..." in local time
    const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3})/.exec(line);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime() : null;
}

// Each launch gets its own working directory for the terminal, so that its prompt is unlike any other.
// Without that, a prompt on screen proves nothing: while a restored terminal loads, it shows the screen of the
// previous session, prompt included, until the new shell's output replaces it.
function cwdForRun(n) {
    const dir = path.join(profileDirs[0], "cwd", `run-${n}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

// Resolves in the renderer once the restored terminal shows the prompt of this launch's shell.
function waitForPrompt(n) {
    return `(async () => {
        const marker = new RegExp("run-${n}> ?$");
        const deadline = performance.now() + 30000;
        while (performance.now() < deadline) {
            const tw = window.term;
            if (tw != null && tw.loaded) {
                const buf = tw.terminal.buffer.active;
                const cursorLine = buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? "";
                if (marker.test(cursorLine)) {
                    const promptAt = Math.round(performance.timeOrigin + performance.now());
                    // the prompt can be in the terminal's buffer before the window has drawn anything at all
                    let paint = null;
                    while (paint == null && performance.now() < deadline) {
                        paint = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
                        if (paint == null) {
                            await new Promise((r) => setTimeout(r, 10));
                        }
                    }
                    const nav = performance.getEntriesByType("navigation")[0];
                    const marks = { navigation: Math.round(performance.timeOrigin) };
                    for (const m of performance.getEntriesByType("mark")) {
                        if (m.name.startsWith("wave:") && marks[m.name.slice(5)] == null) {
                            marks[m.name.slice(5)] = Math.round(performance.timeOrigin + m.startTime);
                        }
                    }
                    return JSON.stringify({
                        promptAt,
                        contentAt: paint == null ? null : Math.round(performance.timeOrigin + paint.startTime),
                        scriptsMs: Math.round(nav.domContentLoadedEventEnd - nav.domInteractive),
                        marks,
                    });
                }
            }
            await new Promise((r) => setTimeout(r, 10));
        }
        return JSON.stringify({ promptAt: null, contentAt: null, scriptsMs: null, marks: {} });
    })()`;
}

// Tells the terminal which directory its shell starts in next time.
function setCwdForNextLaunch(n) {
    return `(async () => {
        const tabId = globalStore.get(globalAtoms.staticTabId);
        const tab = WOS.getObjectValue("tab:" + tabId);
        const blockId = (tab?.blockids ?? []).find((id) => WOS.getObjectValue("block:" + id)?.meta?.view === "term");
        await RpcApi.SetMetaCommand(TabRpcClient, { oref: "block:" + blockId, meta: { "cmd:cwd": ${JSON.stringify(cwdForRun(n))} } });
        return "next start in run-${n}";
    })()`;
}
const ensureTerminal = `(async () => {
    const tabId = globalStore.get(globalAtoms.staticTabId);
    const tab = WOS.getObjectValue("tab:" + tabId);
    const hasTerm = (tab?.blockids ?? []).some((id) => WOS.getObjectValue("block:" + id)?.meta?.view === "term");
    if (!hasTerm) {
        await RpcApi.CreateBlockCommand(TabRpcClient, { tabid: tabId, blockdef: { meta: { view: "term", controller: "shell" } } });
    }
    return hasTerm ? "terminal present" : "terminal created";
})()`;

// run 0 is the warm-up launch
async function launchOnce(run) {
    const measure = run > 0;
    const logOffset = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;
    const launchedAt = Date.now();
    const child = spawn(exe, [], {
        cwd: appDir,
        env: { ...process.env, WAVELET_PROFILE: ProfileName, WAVELET_CDP_PORT: port },
        detached: true,
        stdio: "ignore",
    });
    child.unref();
    const result = {
        windowMs: null,
        contentMs: null,
        backendMs: null,
        tabInitMs: null,
        scriptsMs: null,
        promptMs: null,
        marks: {},
    };
    try {
        const deadline = Date.now() + 90000;
        let shown = null;
        while (shown == null) {
            if (Date.now() > deadline) {
                throw new Error("no window after 90s");
            }
            await sleep(25);
            for (const line of logLinesSince(logOffset)) {
                if (line.includes("show window")) {
                    shown = logTime(line);
                }
                const backend = /wavesrv ready signal received true (\d+) ms/.exec(line);
                if (backend) {
                    result.backendMs = Number(backend[1]);
                }
                const tabInit = /tabview init (\d+)ms/.exec(line);
                if (tabInit && result.tabInitMs == null) {
                    result.tabInitMs = Number(tabInit[1]);
                }
            }
        }
        result.windowMs = shown - launchedAt;
        if (measure) {
            const prompt = JSON.parse(cdpEval(waitForPrompt(run)));
            // the window is shown before its tab has loaded, so the tab reports in after the loop above has ended
            for (const line of logLinesSince(logOffset)) {
                const tabInit = /tabview init (\d+)ms/.exec(line);
                if (tabInit && result.tabInitMs == null) {
                    result.tabInitMs = Number(tabInit[1]);
                }
            }
            result.promptMs = prompt.promptAt == null ? null : prompt.promptAt - launchedAt;
            result.contentMs = prompt.contentAt == null ? null : prompt.contentAt - launchedAt;
            result.scriptsMs = prompt.scriptsMs;
            for (const [name, at] of Object.entries(prompt.marks)) {
                result.marks[name] = at - launchedAt;
            }
        } else {
            await sleep(1500);
            console.log(`  warm-up: ${cdpEval(ensureTerminal)}`);
            await sleep(2500);
        }
        cdpEval(setCwdForNextLaunch(run + 1));
        await sleep(300);
    } finally {
        try {
            execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
            // already gone
        }
        await sleep(1500);
    }
    return result;
}

function median(values) {
    const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
    return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
}

if (!existsSync(exe)) {
    console.error(`${exe} not found; run ops\\package.ps1 first or pass --app`);
    process.exit(1);
}
console.log(`measuring ${exe}`);
removeProfile();
try {
    await launchOnce(0);
    const results = [];
    for (let i = 0; i < runs; i++) {
        const r = await launchOnce(i + 1);
        results.push(r);
        console.log(
            `  run ${i + 1}: window ${r.windowMs} ms, content ${r.contentMs} ms, prompt ${r.promptMs} ms  (backend ready ${r.backendMs} ms, tab init ${r.tabInitMs} ms, scripts ${r.scriptsMs} ms)`
        );
    }
    const keys = ["windowMs", "contentMs", "promptMs", "backendMs", "tabInitMs", "scriptsMs"];
    const medians = Object.fromEntries(keys.map((k) => [k, median(results.map((r) => r[k]))]));
    console.log(
        `median of ${runs}: window ${medians.windowMs} ms, content ${medians.contentMs} ms, prompt ${medians.promptMs} ms  (backend ready ${medians.backendMs} ms, tab init ${medians.tabInitMs} ms, scripts ${medians.scriptsMs} ms)`
    );
    console.log("window = launch until the window is shown; content = until it has drawn its first text;");
    console.log("prompt = until the restored terminal holds a prompt (on screen once both have happened);");
    console.log("scripts = time the renderer spends loading and running its JavaScript before it can start initialising");
    if (timeline) {
        const names = [...new Set(results.flatMap((r) => Object.keys(r.marks)))];
        const rows = names.map((name) => [name, median(results.map((r) => r.marks[name]))]).sort((a, b) => a[1] - b[1]);
        console.log("timeline of the tab, ms after launch (medians):");
        for (const [name, at] of rows) {
            console.log(`  ${String(at).padStart(5)}  ${name}`);
        }
    }
} finally {
    removeProfile();
}
