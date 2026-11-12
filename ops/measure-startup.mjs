// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Measures a cold start of a packaged build: how long until the window is shown, and how long until the terminal in
// the restored tab has a shell prompt. Runs under a throwaway "bench" profile, so it never touches real data and can
// run while the installed app is open.
//
//   node ops/measure-startup.mjs [--app <dir with Wavelet.exe>] [--runs N] [--port N]
//
// The first launch creates the profile and takes whatever antivirus does to a binary it has not seen; it is not
// counted. Close other heavy work first: builds running at the same time easily double the numbers.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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

// Resolves in the renderer once the terminal that the tab restored shows a prompt.
const waitForPrompt = `(async () => {
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline) {
        const tw = window.term;
        if (tw != null) {
            const buf = tw.terminal.buffer.active;
            let text = "";
            for (let i = 0; i < Math.min(buf.length, 60); i++) {
                text += buf.getLine(i).translateToString(true) + "\\n";
            }
            if (/^PS .*>|[$#%>] ?$/m.test(text.trimEnd())) {
                const nav = performance.getEntriesByType("navigation")[0];
                return JSON.stringify({
                    promptAt: Math.round(performance.timeOrigin + performance.now()),
                    scriptsMs: Math.round(nav.domContentLoadedEventEnd - nav.domInteractive),
                });
            }
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    return JSON.stringify({ promptAt: null, scriptsMs: null });
})()`;

const ensureTerminal = `(async () => {
    const tabId = globalStore.get(globalAtoms.staticTabId);
    const tab = WOS.getObjectValue("tab:" + tabId);
    const hasTerm = (tab?.blockids ?? []).some((id) => WOS.getObjectValue("block:" + id)?.meta?.view === "term");
    if (!hasTerm) {
        await RpcApi.CreateBlockCommand(TabRpcClient, { tabid: tabId, blockdef: { meta: { view: "term", controller: "shell" } } });
    }
    return hasTerm ? "terminal present" : "terminal created";
})()`;

async function launchOnce(measure) {
    const logOffset = existsSync(logFile) ? readFileSync(logFile, "utf8").length : 0;
    const launchedAt = Date.now();
    const child = spawn(exe, [], {
        cwd: appDir,
        env: { ...process.env, WAVELET_PROFILE: ProfileName, WAVELET_CDP_PORT: port },
        detached: true,
        stdio: "ignore",
    });
    child.unref();
    const result = { windowMs: null, backendMs: null, tabInitMs: null, scriptsMs: null, promptMs: null };
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
            const prompt = JSON.parse(cdpEval(waitForPrompt));
            result.promptMs = prompt.promptAt == null ? null : prompt.promptAt - launchedAt;
            result.scriptsMs = prompt.scriptsMs;
        } else {
            await sleep(1500);
            console.log(`  warm-up: ${cdpEval(ensureTerminal)}`);
            await sleep(2500);
        }
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
    await launchOnce(false);
    const results = [];
    for (let i = 0; i < runs; i++) {
        const r = await launchOnce(true);
        results.push(r);
        console.log(
            `  run ${i + 1}: window ${r.windowMs} ms, prompt ${r.promptMs} ms  (backend ready ${r.backendMs} ms, tab init ${r.tabInitMs} ms, scripts ${r.scriptsMs} ms)`
        );
    }
    const keys = ["windowMs", "promptMs", "backendMs", "tabInitMs", "scriptsMs"];
    const medians = Object.fromEntries(keys.map((k) => [k, median(results.map((r) => r[k]))]));
    console.log(
        `median of ${runs}: window ${medians.windowMs} ms, prompt ${medians.promptMs} ms  (backend ready ${medians.backendMs} ms, tab init ${medians.tabInitMs} ms, scripts ${medians.scriptsMs} ms)`
    );
    console.log("window = launch until the window is shown; prompt = launch until the restored terminal has a prompt;");
    console.log("scripts = time the renderer spends loading and running its JavaScript before it can start initialising");
} finally {
    removeProfile();
}
