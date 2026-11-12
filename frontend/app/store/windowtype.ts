// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

// waveWindowType is set once at startup and never changes.
let waveWindowType: "tab" | "builder" = "tab";

function getWaveWindowType(): "tab" | "builder" {
    return waveWindowType;
}

function isBuilderWindow(): boolean {
    return waveWindowType === "builder";
}

function isTabWindow(): boolean {
    return waveWindowType === "tab";
}

function setWaveWindowType(windowType: "tab" | "builder") {
    waveWindowType = windowType;
}

export { getWaveWindowType, isBuilderWindow, isTabWindow, setWaveWindowType };
