// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { App } from "@/app/app";
import { loadBadges } from "@/app/store/badge";
import { GlobalModel } from "@/app/store/global-model";
import {
    globalRefocus,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
} from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeTabRouteId } from "@/app/store/wshrouter";
import { initWshrpc, TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { countersClear, countersPrint } from "@/store/counters";
import {
    atoms,
    getApi,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    loadConnStatus,
    subscribeToConnEvents,
} from "@/store/global";
import { activeTabIdAtom } from "@/store/tab-model";
import * as WOS from "@/store/wos";
import { loadFonts } from "@/util/fontutil";
import { setKeyUtilPlatform } from "@/util/keyutil";
import { isMacOS, setMacOSVersion } from "@/util/platformutil";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const platform = getApi().getPlatform();
document.title = `Wavelet`;
let savedInitOpts: WaveInitOpts = null;
let fontsLoaded: Promise<unknown> = null;

// Startup milestones; ops/measure-startup.mjs reads them back with --timeline.
function mark(name: string) {
    performance.mark("wave:" + name);
}

(window as any).WOS = WOS;
(window as any).globalStore = globalStore;
(window as any).globalAtoms = atoms;
(window as any).RpcApi = RpcApi;
(window as any).isFullScreen = false;
(window as any).countersPrint = countersPrint;
(window as any).countersClear = countersClear;
(window as any).getLayoutModelForStaticTab = getLayoutModelForStaticTab;
(window as any).modalsModel = modalsModel;

function updateZoomFactor(zoomFactor: number) {
    console.log("update zoomfactor", zoomFactor);
    document.documentElement.style.setProperty("--zoomfactor", String(zoomFactor));
    document.documentElement.style.setProperty("--zoomfactor-inv", String(1 / zoomFactor));
}

async function initBare() {
    mark("bare");
    getApi().sendLog("Init Bare");
    document.body.style.visibility = "hidden";
    document.body.style.opacity = "0";
    document.body.classList.add("is-transparent");
    getApi().onWaveInit(initWaveWrap);
    setKeyUtilPlatform(platform);
    // The fonts are only needed for the first render, so they load while the tab is being initialised instead of
    // holding that up; frontend/fonts.ts has normally started them already. A terminal must not render before they
    // are in: it would measure its cells with a fallback font.
    loadFonts();
    fontsLoaded = document.fonts.ready;
    updateZoomFactor(getApi().getZoomFactor());
    getApi().onZoomFactorChange((zoomFactor) => {
        updateZoomFactor(zoomFactor);
    });
    console.log("Init Bare Done");
    getApi().setWindowInitStatus("ready");
}

document.addEventListener("DOMContentLoaded", initBare);

async function initWaveWrap(initOpts: WaveInitOpts) {
    try {
        if (savedInitOpts) {
            await reinitWave();
            return;
        }
        savedInitOpts = initOpts;
        await initWave(initOpts);
    } catch (e) {
        getApi().sendLog("Error in initWave " + e.message + "\n" + e.stack);
        console.error("Error in initWave", e);
    } finally {
        document.body.style.visibility = null;
        document.body.style.opacity = null;
        document.body.classList.remove("is-transparent");
    }
}

async function reinitWave() {
    console.log("Reinit Wave");
    getApi().sendLog("Reinit Wave");

    // We use this hack to prevent a flicker of the previously-hovered tab when this view was last active.
    document.body.classList.add("nohover");
    requestAnimationFrame(() =>
        setTimeout(() => {
            document.body.classList.remove("nohover");
        }, 100)
    );

    await WOS.reloadWaveObject<Client>(WOS.makeORef("client", savedInitOpts.clientId));
    const waveWindow = await WOS.reloadWaveObject<WaveWindow>(WOS.makeORef("window", savedInitOpts.windowId));
    const ws = await WOS.reloadWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
    const initialTab = await WOS.reloadWaveObject<Tab>(WOS.makeORef("tab", savedInitOpts.tabId));
    await WOS.reloadWaveObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate));
    reloadAllWorkspaceTabs(ws);
    document.title = `Wavelet - ${initialTab.name}`; // TODO update with tab name change
    getApi().setWindowInitStatus("wave-ready");
    globalStore.set(atoms.reinitVersion, globalStore.get(atoms.reinitVersion) + 1);
    setTimeout(() => {
        globalRefocus();
    }, 50);
}

function reloadAllWorkspaceTabs(ws: Workspace) {
    if (ws == null || !ws.tabids?.length) {
        return;
    }
    ws.tabids?.forEach((tabid) => {
        WOS.reloadWaveObject<Tab>(WOS.makeORef("tab", tabid));
    });
}

function loadAllWorkspaceTabs(ws: Workspace) {
    if (ws == null || !ws.tabids?.length) {
        return;
    }
    ws.tabids?.forEach((tabid) => {
        WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabid));
    });
}

async function initWave(initOpts: WaveInitOpts) {
    mark("init");
    getApi().sendLog("Init Wave " + JSON.stringify(initOpts));
    const globalInitOpts: GlobalInitOptions = {
        tabId: initOpts.tabId,
        clientId: initOpts.clientId,
        windowId: initOpts.windowId,
        platform,
        environment: "renderer",
    };
    console.log("Wave Init", globalInitOpts);
    globalStore.set(activeTabIdAtom, initOpts.tabId);
    await GlobalModel.getInstance().initialize(globalInitOpts);
    initGlobal(globalInitOpts);
    (window as any).globalAtoms = atoms;

    // Init WPS event handlers
    const globalWS = initWshrpc(makeTabRouteId(initOpts.tabId));
    (window as any).globalWS = globalWS;
    (window as any).TabRpcClient = TabRpcClient;

    // Everything the first render needs is asked for at once; none of these requests depends on another's answer.
    const fullConfigLoad = RpcApi.GetFullConfigCommand(TabRpcClient);
    // ensures client/window/workspace are loaded into the cache before rendering
    try {
        const [_connStatus, _badges, [_client, waveWindow, initialTab]] = await Promise.all([
            loadConnStatus(),
            loadBadges(),
            Promise.all([
                WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", initOpts.clientId)),
                WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", initOpts.windowId)),
                WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", initOpts.tabId)),
            ]),
        ]);
        initGlobalWaveEventSubs(initOpts);
        subscribeToConnEvents();
        if (isMacOS()) {
            const macOSVersion = await RpcApi.MacOSVersionCommand(TabRpcClient);
            setMacOSVersion(macOSVersion);
        }
        // The tab's blocks are fetched along with the rest. Left to the first render, each block would only appear
        // one round trip after it.
        const blockLoads = (initialTab.blockids ?? []).map((blockId) =>
            WOS.reloadWaveObject<Block>(WOS.makeORef("block", blockId))
        );
        const [ws, _layoutState] = await Promise.all([
            WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid)),
            WOS.reloadWaveObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate)),
        ]);
        await Promise.all(blockLoads);
        loadAllWorkspaceTabs(ws);
        WOS.wpsSubscribeToObject(WOS.makeORef("workspace", waveWindow.workspaceid));
        document.title = `Wavelet - ${initialTab.name}`; // TODO update with tab name change
    } catch (e) {
        console.error("Failed initialization error", e);
        getApi().sendLog("Error in initialization (wave.ts, loading required objects) " + e.message + "\n" + e.stack);
    }
    registerGlobalKeys();
    registerElectronReinjectKeyHandler();
    registerControlShiftStateUpdateHandler();
    mark("objects");
    const fullConfig = await fullConfigLoad;
    console.log("fullconfig", fullConfig);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
    mark("config");
    await fontsLoaded;
    mark("fonts");
    console.log("Wave First Render");
    let firstRenderResolveFn: () => void = null;
    const firstRenderPromise = new Promise<void>((resolve) => {
        firstRenderResolveFn = resolve;
    });
    const reactElem = createElement(App, { onFirstRender: firstRenderResolveFn }, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    root.render(reactElem);
    await firstRenderPromise;
    mark("rendered");
    console.log("Wave First Render Done");
    getApi().setWindowInitStatus("wave-ready");
}
