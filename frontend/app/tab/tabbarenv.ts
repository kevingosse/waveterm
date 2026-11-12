// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type TabBarEnv = WaveEnvSubset<{
    electron: {
        createTab: WaveEnv["electron"]["createTab"];
        closeTab: WaveEnv["electron"]["closeTab"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
        showWorkspaceAppMenu: WaveEnv["electron"]["showWorkspaceAppMenu"];
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
    };
    rpc: {
        ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        UpdateTabNameCommand: WaveEnv["rpc"]["UpdateTabNameCommand"];
        UpdateWorkspaceTabIdsCommand: WaveEnv["rpc"]["UpdateWorkspaceTabIdsCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        hasConfigErrors: WaveEnv["atoms"]["hasConfigErrors"];
        staticTabId: WaveEnv["atoms"]["staticTabId"];
        isFullScreen: WaveEnv["atoms"]["isFullScreen"];
        zoomFactorAtom: WaveEnv["atoms"]["zoomFactorAtom"];
        reinitVersion: WaveEnv["atoms"]["reinitVersion"];
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
    };
    wos: WaveEnv["wos"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"app:tabbar" | "tab:confirmclose" | "window:showmenubar">;
    showContextMenu: WaveEnv["showContextMenu"];
    isWindows: WaveEnv["isWindows"];
    isMacOS: WaveEnv["isMacOS"];
}>;
