// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type VTabBarEnv = WaveEnvSubset<{
    electron: {
        createTab: WaveEnv["electron"]["createTab"];
        closeTab: WaveEnv["electron"]["closeTab"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
    };
    rpc: {
        UpdateWorkspaceTabIdsCommand: WaveEnv["rpc"]["UpdateWorkspaceTabIdsCommand"];
        UpdateTabNameCommand: WaveEnv["rpc"]["UpdateTabNameCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    atoms: {
        staticTabId: WaveEnv["atoms"]["staticTabId"];
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        reinitVersion: WaveEnv["atoms"]["reinitVersion"];
        documentHasFocus: WaveEnv["atoms"]["documentHasFocus"];
        isFullScreen: WaveEnv["atoms"]["isFullScreen"];
    };
    wos: WaveEnv["wos"];
    showContextMenu: WaveEnv["showContextMenu"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"tab:confirmclose" | "app:tabbar">;
    isWindows: WaveEnv["isWindows"];
    isMacOS: WaveEnv["isMacOS"];
}>;
