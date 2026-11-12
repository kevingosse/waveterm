// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Measures how long a new terminal block takes to reach its first shell prompt, inside a running instance that was
// started with WAVELET_CDP_PORT. Each run creates a block, times it, and deletes it again.
//
//   node ops/measure-prompt.mjs [--port N] [--runs N] [--target <cdp.mjs target, default: active>]

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
function takeOpt(name, defaultValue) {
    const idx = args.indexOf(name);
    return idx >= 0 ? args.splice(idx, 2)[1] : defaultValue;
}
const port = takeOpt("--port", process.env.WAVELET_CDP_PORT ?? "9333");
const runs = Number(takeOpt("--runs", "3"));
const target = takeOpt("--target", "active");

// Runs in the renderer. Polls the xterm buffer because that is what the user actually sees.
const probe = `(async () => {
    const tabId = globalStore.get(globalAtoms.staticTabId);
    const t0 = performance.now();
    const oref = await RpcApi.CreateBlockCommand(TabRpcClient, {
        tabid: tabId,
        blockdef: { meta: { view: "term", controller: "shell" } },
    });
    const blockId = String(oref.oid ?? oref).replace(/^block:/, "");
    const result = { blockId, rpcMs: Math.round(performance.now() - t0), xtermMs: null, bannerMs: null, promptMs: null };
    while (performance.now() - t0 < 30000) {
        const tw = window.term;
        if (tw != null && tw.blockId === blockId) {
            const elapsed = Math.round(performance.now() - t0);
            result.xtermMs ??= elapsed;
            const buf = tw.terminal.buffer.active;
            let text = "";
            for (let i = 0; i < Math.min(buf.length, 60); i++) {
                text += buf.getLine(i).translateToString(true) + "\\n";
            }
            if (text.trim() !== "") {
                result.bannerMs ??= elapsed;
            }
            if (/^PS .*>|[$#%>] ?$/m.test(text.trimEnd())) {
                result.promptMs = elapsed;
                result.screen = text.trimEnd();
                break;
            }
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    await RpcApi.DeleteBlockCommand(TabRpcClient, { blockid: blockId });
    return result;
})()`;

const cdp = path.join(path.dirname(fileURLToPath(import.meta.url)), "cdp.mjs");
for (let i = 0; i < runs; i++) {
    let out;
    try {
        out = execFileSync(process.execPath, [cdp, "eval", target, probe, "--port", port], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (e) {
        console.error(`run ${i + 1} failed: ${String(e.stderr || e.message).trim().split("\n")[0]}`);
        process.exit(1);
    }
    const r = JSON.parse(out);
    console.log(
        `run ${i + 1}: block created ${r.rpcMs} ms, xterm ready ${r.xtermMs} ms, first output ${r.bannerMs} ms, PROMPT ${r.promptMs} ms`
    );
    if (i === 0 && r.screen) {
        console.log(r.screen.split("\n").map((l) => "    | " + l).join("\n"));
    }
}
