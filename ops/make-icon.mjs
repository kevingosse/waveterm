// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Regenerates the Windows app icon as a recoloured version of upstream's, so that Wavelet and an official Wave
// install can be told apart on the taskbar. Always starts from upstream's originals (read from git), so running it
// twice gives the same result.
//
//   node ops/make-icon.mjs [hue-rotation-in-degrees]
//
// The colours that are written by hand follow from the same rotation and have to be changed with it: the gradient
// in frontend/app/asset/logo.svg and the workspace colour WaveletBlue in pkg/wcore/workspace.go (upstream's
// #58C142 comes out as #00C6FF at the default 95 degrees).

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const ForkBase = "9f1c9670d407be3b93cf090319a63ef30bf54d0e";
const Sizes = [16, 32, 48, 64, 128, 256];
const hue = Number(process.argv[2] ?? 95);

function upstreamFile(path) {
    return execFileSync("git", ["show", `${ForkBase}:${path}`], { maxBuffer: 16 * 1024 * 1024 });
}

const pngs = [];
for (const size of Sizes) {
    const recoloured = await sharp(upstreamFile(`build/icons/${size}x${size}.png`))
        .modulate({ hue })
        .png()
        .toBuffer();
    writeFileSync(`build/icons/${size}x${size}.png`, recoloured);
    pngs.push({ size, data: recoloured });
}
writeFileSync(
    "build/icons/512x512.png",
    await sharp(upstreamFile("build/icons/512x512.png")).modulate({ hue }).png().toBuffer()
);
// the window icon on Linux, the only logo image the app loads at run time
writeFileSync(
    "public/logos/wavelet.png",
    await sharp(upstreamFile("public/logos/wave-logo-dark.png")).modulate({ hue }).png().toBuffer()
);

// An .ico is a small directory followed by the images, which may be stored as PNG.
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
const entries = [];
let offset = header.length + 16 * pngs.length;
for (const { size, data } of pngs) {
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
writeFileSync("build/icon.ico", Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
console.log(`wrote build/icon.ico, build/icons/*.png and public/logos/wavelet.png (hue rotated by ${hue} degrees)`);
