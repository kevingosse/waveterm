// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Draws the Wavelet mark and writes every image the app uses for it:
//
//   build/icon.ico, build/icons/*.png      the app icon
//   public/logos/wavelet.png               the window icon on Linux
//   frontend/app/asset/logo.svg            the mark at its natural proportions, for the About dialog and the launcher
//   frontend/app/asset/wavelet-glyph.svg   the mark as a mask, for the "custom@wavelet" icon (see app.scss)
//
// The mark is a Ricker wavelet, psi(t) = (1 - t^2) exp(-t^2 / 2), drawn as one blue stroke with nothing behind it. It
// is this project's own drawing; nothing here is derived from upstream's logo.
//
//   node ops/make-icon.mjs

import { writeFileSync } from "node:fs";
import sharp from "sharp";

// The stroke runs from MarkPeak at the top of the curve to MarkBase at its troughs; the deeper end is what keeps the
// mark visible on a light taskbar. WaveletBlue in pkg/wcore/workspace.go is MarkPeak; change them together.
const MarkPeak = "#00C6FF";
const MarkBase = "#0091CA";
const MarkPaint = `<defs><linearGradient id="mark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${MarkPeak}"/><stop offset="1" stop-color="${MarkBase}"/></linearGradient></defs>`;

// how far psi dips below zero, relative to its peak of 1
const TroughDepth = 2 * Math.exp(-1.5);

const psi = (t) => (1 - t * t) * Math.exp((-t * t) / 2);
const dpsi = (t) => (t ** 3 - 3 * t) * Math.exp((-t * t) / 2);
const round = (v) => Math.round(v * 100) / 100;

// The curve over [-T, T] as cubic Bezier segments. Each segment is the Hermite interpolant of psi, which needs far
// fewer points than a polyline to look smooth.
function markPath({ T, x0, x1, top, amp }) {
    const segments = 20;
    const sx = (x1 - x0) / (2 * T);
    const X = (t) => x0 + (t + T) * sx;
    const Y = (t) => top + amp * (1 - psi(t));
    const h = (2 * T) / segments;
    let d = `M${round(X(-T))} ${round(Y(-T))}`;
    for (let i = 0; i < segments; i++) {
        const a = -T + i * h;
        const b = a + h;
        const c1 = `${round(X(a) + (sx * h) / 3)} ${round(Y(a) - (amp * dpsi(a) * h) / 3)}`;
        const c2 = `${round(X(b) - (sx * h) / 3)} ${round(Y(b) + (amp * dpsi(b) * h) / 3)}`;
        d += `C${c1} ${c2} ${round(X(b))} ${round(Y(b))}`;
    }
    return d;
}

// The mark alone, fitted into a box with the stroke just touching its edges.
function markSvg({ width, height, stroke, T, paint, defs = "", comment = "" }) {
    const amp = (height - stroke) / (1 + TroughDepth);
    const d = markPath({ T, x0: stroke / 2, x1: width - stroke / 2, top: stroke / 2, amp });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
${comment}${defs}<path d="${d}" stroke="${paint}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;
}

// The app icon on a 256 grid: the mark alone, as wide as the square. It is drawn steeper than its natural proportions,
// which would leave a third of the square empty. Small sizes get a heavier stroke and a shorter stretch of the curve,
// or the mark turns into a smudge.
function iconSvg(size) {
    let p = { T: 2.9, stroke: 34, amp: 124, pad: 2 };
    if (size <= 24) {
        p = { T: 2.7, stroke: 42, amp: 120, pad: 0 };
    } else if (size <= 48) {
        p = { T: 2.8, stroke: 38, amp: 122, pad: 0 };
    }
    const inset = p.stroke / 2 + p.pad;
    // centres the curve's extent, peak to trough, on the square
    const top = 128 - (p.amp * (1 + TroughDepth)) / 2;
    const d = markPath({ T: p.T, x0: inset, x1: 256 - inset, top, amp: p.amp });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
${MarkPaint}
<path d="${d}" fill="none" stroke="url(#mark)" stroke-width="${p.stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

function iconPng(size) {
    // rasterised at the target size, so large icons are not an enlarged 256 pixel image
    return sharp(Buffer.from(iconSvg(size)), { density: (72 * size) / 256 })
        .resize(size, size)
        .png()
        .toBuffer();
}

// An .ico is a small directory followed by the images, which may be stored as PNG.
function ico(images) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    const entries = [];
    let offset = header.length + 16 * images.length;
    for (const { size, data } of images) {
        const entry = Buffer.alloc(16);
        entry.writeUInt8(size === 256 ? 0 : size, 0);
        entry.writeUInt8(size === 256 ? 0 : size, 1);
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(data.length, 8);
        entry.writeUInt32LE(offset, 12);
        entries.push(entry);
        offset += data.length;
    }
    return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

// 20, 24 and 40 are what Windows asks for at 125% and 150% scaling
const icoImages = [];
for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
    icoImages.push({ size, data: await iconPng(size) });
}
writeFileSync("build/icon.ico", ico(icoImages));
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    writeFileSync(`build/icons/${size}x${size}.png`, await iconPng(size));
}
writeFileSync("public/logos/wavelet.png", await iconPng(1024));

const generated = "<!-- Copyright 2026, Wavelet contributors. SPDX-License-Identifier: Apache-2.0 -->\n<!-- Written by ops/make-icon.mjs; change it there. -->\n";
writeFileSync(
    "frontend/app/asset/logo.svg",
    markSvg({
        width: 64,
        height: 44,
        stroke: 6,
        T: 3.4,
        paint: "url(#mark)",
        defs: `${MarkPaint}\n`,
        comment: generated,
    })
);
// shown at the size of a line of text, so it is drawn heavier than the logo
writeFileSync(
    "frontend/app/asset/wavelet-glyph.svg",
    markSvg({ width: 64, height: 44, stroke: 8, T: 3.0, paint: "#000", comment: generated })
);
console.log("wrote the app icon (build/, public/logos/) and the mark (frontend/app/asset/)");
