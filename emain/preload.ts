// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { StaticInfoArgPrefix } from "@/util/sharedconst";
import { contextBridge, ipcRenderer, webUtils, WebviewTag } from "electron";

// Facts that never change while the app runs arrive on the command line (see getStaticInfoArg in emain-platform.ts),
// so that asking for them does not wait for the main process. The synchronous calls remain as a fallback.
function readStaticInfo(): Record<string, any> {
    try {
        const arg = process.argv.find((a) => a.startsWith(StaticInfoArgPrefix));
        return arg == null ? {} : JSON.parse(decodeURIComponent(arg.slice(StaticInfoArgPrefix.length)));
    } catch (_) {
        return {};
    }
}
const staticInfo = readStaticInfo();

// update type in custom.d.ts (ElectronApi type)
contextBridge.exposeInMainWorld("api", {
    getAuthKey: () => ipcRenderer.sendSync("get-auth-key"),
    getIsDev: () => staticInfo.isDev ?? ipcRenderer.sendSync("get-is-dev"),
    getPlatform: () => staticInfo.platform ?? ipcRenderer.sendSync("get-platform"),
    getCursorPoint: () => ipcRenderer.sendSync("get-cursor-point"),
    getUserName: () => staticInfo.userName ?? ipcRenderer.sendSync("get-user-name"),
    getHostName: () => staticInfo.hostName ?? ipcRenderer.sendSync("get-host-name"),
    getDataDir: () => staticInfo.dataDir ?? ipcRenderer.sendSync("get-data-dir"),
    getConfigDir: () => staticInfo.configDir ?? ipcRenderer.sendSync("get-config-dir"),
    getHomeDir: () => staticInfo.homeDir ?? ipcRenderer.sendSync("get-home-dir"),
    getAboutModalDetails: () => ipcRenderer.sendSync("get-about-modal-details"),
    getWebviewPreload: () => staticInfo.webviewPreload ?? ipcRenderer.sendSync("get-webview-preload"),
    getZoomFactor: () => ipcRenderer.sendSync("get-zoom-factor"),
    openNewWindow: () => ipcRenderer.send("open-new-window"),
    showWorkspaceAppMenu: (workspaceId) => ipcRenderer.send("workspace-appmenu-show", workspaceId),
    showContextMenu: (workspaceId, menu) => ipcRenderer.send("contextmenu-show", workspaceId, menu),
    onContextMenuClick: (callback: (id: string | null) => void) =>
        ipcRenderer.on("contextmenu-click", (_event, id: string | null) => callback(id)),
    downloadFile: (filePath) => ipcRenderer.send("download", { filePath }),
    openExternal: (url) => {
        if (url && typeof url === "string") {
            ipcRenderer.send("open-external", url);
        } else {
            console.error("Invalid URL passed to openExternal:", url);
        }
    },
    getEnv: (varName) => ipcRenderer.sendSync("get-env", varName),
    onFullScreenChange: (callback) =>
        ipcRenderer.on("fullscreen-change", (_event, isFullScreen) => callback(isFullScreen)),
    onZoomFactorChange: (callback) =>
        ipcRenderer.on("zoom-factor-change", (_event, zoomFactor) => callback(zoomFactor)),
    onMenuItemAbout: (callback) => ipcRenderer.on("menu-item-about", callback),
    updateWindowControlsOverlay: (rect) => ipcRenderer.send("update-window-controls-overlay", rect),
    onReinjectKey: (callback) => ipcRenderer.on("reinject-key", (_event, waveEvent) => callback(waveEvent)),
    setWebviewFocus: (focused: number) => ipcRenderer.send("webview-focus", focused),
    registerGlobalWebviewKeys: (keys) => ipcRenderer.send("register-global-webview-keys", keys),
    onControlShiftStateUpdate: (callback) =>
        ipcRenderer.on("control-shift-state-update", (_event, state) => callback(state)),
    createWorkspace: () => ipcRenderer.send("create-workspace"),
    switchWorkspace: (workspaceId) => ipcRenderer.send("switch-workspace", workspaceId),
    deleteWorkspace: (workspaceId) => ipcRenderer.send("delete-workspace", workspaceId),
    setActiveTab: (tabId) => ipcRenderer.send("set-active-tab", tabId),
    createTab: () => ipcRenderer.send("create-tab"),
    closeTab: (workspaceId, tabId, confirmClose) => ipcRenderer.invoke("close-tab", workspaceId, tabId, confirmClose),
    setWindowInitStatus: (status) => ipcRenderer.send("set-window-init-status", status),
    onWaveInit: (callback) => ipcRenderer.on("wave-init", (_event, initOpts) => callback(initOpts)),
    sendLog: (log) => ipcRenderer.send("fe-log", log),
    onQuicklook: (filePath: string) => ipcRenderer.send("quicklook", filePath),
    openNativePath: (filePath: string) => ipcRenderer.send("open-native-path", filePath),
    setKeyboardChordMode: () => ipcRenderer.send("set-keyboard-chord-mode"),
    clearWebviewStorage: (webContentsId: number) => ipcRenderer.invoke("clear-webview-storage", webContentsId),
    nativePaste: () => ipcRenderer.send("native-paste"),
    doRefresh: () => ipcRenderer.send("do-refresh"),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    saveTextFile: (fileName: string, content: string) => ipcRenderer.invoke("save-text-file", fileName, content),
});

// Custom event for "new-window"
ipcRenderer.on("webview-new-window", (e, webContentsId, details) => {
    const event = new CustomEvent("new-window", { detail: details });
    document.getElementById("webview").dispatchEvent(event);
});

ipcRenderer.on("webcontentsid-from-blockid", (e, blockId, responseCh) => {
    const webviewElem: WebviewTag = document.querySelector("div[data-blockid='" + blockId + "'] webview");
    const wcId = webviewElem?.dataset?.webcontentsid;
    ipcRenderer.send(responseCh, wcId);
});
