// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Drives a running Wavelet instance over the Chrome DevTools Protocol, so that changes can be checked in the real app
// without a human at the keyboard. The instance must have been started with WAVELET_CDP_PORT set.
//
//   node ops/cdp.mjs list [--port N]
//   node ops/cdp.mjs eval <target> <expression> [--port N]
//   node ops/cdp.mjs screenshot <target> <file.png> [--port N]
//   node ops/cdp.mjs key <target> <chord>... [--port N]       e.g. Ctrl+Shift+ArrowLeft
//   node ops/cdp.mjs drag <target> <x,y> <x,y>... [--hold]    press at the first point, move through the others
//   node ops/cdp.mjs mouse <target> <move|click|dblclick|up> <x,y>
//
// Points are in CSS pixels of the page, as getBoundingClientRect() gives them. `drag --hold` leaves the button down,
// so that the app can be looked at in the middle of a drag; `mouse up` releases it.
//
// <target> is an index from `list`, or a substring of a target's title or url. "active" picks the app tab that is
// currently showing. Expressions are awaited, and their JSON-serialisable result is printed.

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

// a tab view of the app itself, as opposed to the page inside a web block
async function isAppTab(target) {
    if (target.type !== "page") {
        return false;
    }
    const client = await connect(target);
    try {
        return await evaluate(client, "typeof globalStore !== 'undefined' && typeof TabRpcClient !== 'undefined'");
    } finally {
        client.close();
    }
}

async function pickTarget(spec) {
    const targets = await listTargets();
    if (spec === "active") {
        for (const target of targets) {
            if ((await isAppTab(target)) && (await isVisible(target))) {
                return target;
            }
        }
        throw new Error("no visible app tab");
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

const NamedKeys = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Enter: 13,
    Escape: 27,
    Tab: 9,
    Backspace: 8,
    Delete: 46,
    Space: 32,
};

// "Ctrl+Shift+ArrowLeft", "Alt+t", "Escape" ...
function parseChord(chord) {
    const parts = chord.split("+");
    const keyName = parts.pop();
    let modifiers = 0;
    for (const mod of parts) {
        const bit = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 }[mod.toLowerCase()];
        if (bit == null) {
            throw new Error(`unknown modifier ${JSON.stringify(mod)} in ${JSON.stringify(chord)}`);
        }
        modifiers |= bit;
    }
    if (NamedKeys[keyName] != null) {
        const key = keyName === "Space" ? " " : keyName;
        return { modifiers, key, code: keyName, windowsVirtualKeyCode: NamedKeys[keyName] };
    }
    if (/^[a-z]$/i.test(keyName)) {
        const upper = keyName.toUpperCase();
        const key = modifiers & 8 ? upper : keyName.toLowerCase();
        return { modifiers, key, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0) };
    }
    if (/^[0-9]$/.test(keyName)) {
        return { modifiers, key: keyName, code: `Digit${keyName}`, windowsVirtualKeyCode: keyName.charCodeAt(0) };
    }
    throw new Error(`unknown key ${JSON.stringify(keyName)} in ${JSON.stringify(chord)}`);
}

function parsePoint(text) {
    const match = /^(-?[\d.]+),(-?[\d.]+)$/.exec(text ?? "");
    if (match == null) {
        throw new Error(`expected a point as x,y but got ${JSON.stringify(text)}`);
    }
    return { x: Number(match[1]), y: Number(match[2]) };
}

function mouseEvent(client, type, point, pressed, clickCount = 0) {
    const button = type === "mouseMoved" && !pressed ? "none" : "left";
    return client.send("Input.dispatchMouseEvent", { type, ...point, button, buttons: pressed ? 1 : 0, clickCount });
}

// moves the pointer in small steps, as a hand would, so that the app sees the positions in between
async function glide(client, from, to, pressed) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 15));
    for (let step = 1; step <= steps; step++) {
        const point = { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps };
        await mouseEvent(client, "mouseMoved", point, pressed);
        await new Promise((resolve) => setTimeout(resolve, 8));
    }
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
    if (command === "key") {
        const [spec, ...chords] = rest;
        const client = await connect(await pickTarget(spec));
        try {
            for (const chord of chords) {
                const event = parseChord(chord);
                await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
                await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
            }
        } finally {
            client.close();
        }
        return;
    }
    if (command === "drag") {
        const holdIdx = rest.indexOf("--hold");
        if (holdIdx >= 0) {
            rest.splice(holdIdx, 1);
        }
        const [spec, ...pointArgs] = rest;
        const points = pointArgs.map(parsePoint);
        if (points.length < 2) {
            throw new Error("drag needs at least two points");
        }
        const client = await connect(await pickTarget(spec));
        try {
            await mouseEvent(client, "mouseMoved", points[0], false);
            await mouseEvent(client, "mousePressed", points[0], true, 1);
            for (let idx = 1; idx < points.length; idx++) {
                await glide(client, points[idx - 1], points[idx], true);
            }
            if (holdIdx < 0) {
                await mouseEvent(client, "mouseReleased", points.at(-1), false, 1);
            }
        } finally {
            client.close();
        }
        return;
    }
    if (command === "mouse") {
        const [spec, action, pointArg] = rest;
        const point = parsePoint(pointArg);
        const client = await connect(await pickTarget(spec));
        try {
            if (action === "move") {
                await mouseEvent(client, "mouseMoved", point, false);
            } else if (action === "up") {
                await mouseEvent(client, "mouseReleased", point, false, 1);
            } else if (action === "click" || action === "dblclick") {
                await mouseEvent(client, "mouseMoved", point, false);
                for (let count = 1; count <= (action === "click" ? 1 : 2); count++) {
                    await mouseEvent(client, "mousePressed", point, true, count);
                    await mouseEvent(client, "mouseReleased", point, false, count);
                }
            } else {
                throw new Error(`unknown mouse action ${JSON.stringify(action)}`);
            }
        } finally {
            client.close();
        }
        return;
    }
    console.error(
        "usage: node ops/cdp.mjs list | eval <target> <expression> | screenshot <target> <file.png> | key <target> <chord>... | drag <target> <x,y> <x,y>... [--hold] | mouse <target> <move|click|dblclick|up> <x,y>  [--port N]"
    );
    process.exitCode = 2;
}

main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
