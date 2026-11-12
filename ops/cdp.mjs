// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Drives a running Wavelet instance over the Chrome DevTools Protocol, so that changes can be checked in the real app
// without a human at the keyboard. The instance must have been started with WAVELET_CDP_PORT set.
//
//   node ops/cdp.mjs list [--port N]
//   node ops/cdp.mjs eval <target> <expression> [--port N]
//   node ops/cdp.mjs screenshot <target> <file.png> [--port N]
//
// <target> is an index from `list`, or a substring of a target's title or url. "active" picks the tab view that is
// currently visible. Expressions are awaited, and their JSON-serialisable result is printed.

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args.splice(portIdx, 2)[1]) : Number(process.env.WAVELET_CDP_PORT ?? 9333);
const [command, ...rest] = args;

async function listTargets() {
    const resp = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await resp.json();
    return targets.filter((t) => t.type === "page" || t.type === "webview");
}

function connect(target) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        let nextId = 1;
        const pending = new Map();
        ws.addEventListener("open", () => {
            resolve({
                send(method, params = {}) {
                    const id = nextId++;
                    ws.send(JSON.stringify({ id, method, params }));
                    return new Promise((res, rej) => pending.set(id, { res, rej }));
                },
                close: () => ws.close(),
            });
        });
        ws.addEventListener("message", (evt) => {
            const msg = JSON.parse(evt.data);
            const waiter = pending.get(msg.id);
            if (waiter == null) {
                return;
            }
            pending.delete(msg.id);
            if (msg.error) {
                waiter.rej(new Error(msg.error.message));
                return;
            }
            waiter.res(msg.result);
        });
        ws.addEventListener("error", () => reject(new Error(`cannot connect to ${target.webSocketDebuggerUrl}`)));
    });
}

async function evaluate(client, expression) {
    const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        throw new Error(details.exception?.description ?? details.text);
    }
    return result.result.value;
}

async function isVisible(target) {
    const client = await connect(target);
    try {
        return (await evaluate(client, "document.visibilityState")) === "visible";
    } finally {
        client.close();
    }
}

async function pickTarget(spec) {
    const targets = await listTargets();
    if (spec === "active") {
        for (const target of targets) {
            if (await isVisible(target)) {
                return target;
            }
        }
        throw new Error("no visible target");
    }
    if (/^\d+$/.test(spec)) {
        const target = targets[Number(spec)];
        if (target == null) {
            throw new Error(`no target at index ${spec}`);
        }
        return target;
    }
    const target = targets.find((t) => t.title.includes(spec) || t.url.includes(spec));
    if (target == null) {
        throw new Error(`no target matching ${JSON.stringify(spec)}`);
    }
    return target;
}

async function main() {
    if (command === "list") {
        const targets = await listTargets();
        for (const [idx, target] of targets.entries()) {
            const visible = (await isVisible(target)) ? "visible" : "hidden ";
            console.log(`${idx}  ${visible}  ${target.type}  ${JSON.stringify(target.title)}  ${target.url}`);
        }
        return;
    }
    if (command === "eval") {
        const [spec, expression] = rest;
        const client = await connect(await pickTarget(spec));
        try {
            const value = await evaluate(client, expression);
            console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
        } finally {
            client.close();
        }
        return;
    }
    if (command === "screenshot") {
        const [spec, file] = rest;
        const client = await connect(await pickTarget(spec));
        try {
            const shot = await client.send("Page.captureScreenshot", { format: "png" });
            const { writeFile } = await import("node:fs/promises");
            await writeFile(file, Buffer.from(shot.data, "base64"));
            console.log(`wrote ${file}`);
        } finally {
            client.close();
        }
        return;
    }
    console.error("usage: node ops/cdp.mjs list | eval <target> <expression> | screenshot <target> <file.png>  [--port N]");
    process.exitCode = 2;
}

main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
