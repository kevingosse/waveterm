// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Writes a consistent, compacted copy of a SQLite database, even while another process has it open in WAL mode.
// Copying the .db/-wal/-shm files of a live database instead can produce a torn snapshot.
//
//   node ops/sqlite-snapshot.mjs <source.db> <destination.db>

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
    console.error("usage: node ops/sqlite-snapshot.mjs <source.db> <destination.db>");
    process.exit(2);
}
if (!existsSync(source)) {
    console.error(`source database not found: ${source}`);
    process.exit(1);
}
if (existsSync(destination)) {
    console.error(`destination already exists: ${destination}`);
    process.exit(1);
}

const db = new DatabaseSync(source, { readOnly: true });
try {
    db.prepare("VACUUM INTO ?").run(destination);
} finally {
    db.close();
}

const copy = new DatabaseSync(destination, { readOnly: true });
try {
    const check = copy.prepare("PRAGMA integrity_check").get();
    const verdict = Object.values(check)[0];
    if (verdict !== "ok") {
        console.error(`integrity check failed for ${destination}: ${verdict}`);
        process.exit(1);
    }
} finally {
    copy.close();
}
console.log(`snapshot ok: ${destination} (${(statSync(destination).size / 1024 / 1024).toFixed(1)} MB)`);
