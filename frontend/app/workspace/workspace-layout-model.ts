// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, getOrefMetaKeyAtom, getSettingsKeyAtom } from "@/store/global";
import * as jotai from "jotai";
import { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";
import { debounce } from "throttle-debounce";

const VTabBar_DefaultWidth = 220;
const VTabBar_MinWidth = 110;
const VTabBar_MaxWidth = 280;

function clampVTabWidth(w: number): number {
    return Math.max(VTabBar_MinWidth, Math.min(w, VTabBar_MaxWidth));
}

class WorkspaceLayoutModel {
    private static instance: WorkspaceLayoutModel | null = null;

    panelGroupRef: ImperativePanelGroupHandle = null;
    vtabPanelRef: ImperativePanelHandle = null;
    panelContainerRef: HTMLDivElement = null;
    vtabPanelWrapperRef: HTMLDivElement = null;

    inResize = false;
    vtabWidth = VTabBar_DefaultWidth;
    vtabVisible = false;
    transitionTimeoutRef: NodeJS.Timeout = null;
    debouncedPersistVTabWidth: debounce<() => void>;
    widgetsSidebarVisibleAtom: jotai.Atom<boolean>;

    private constructor() {
        this.widgetsSidebarVisibleAtom = jotai.atom(
            (get) =>
                get(getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:widgetsvisible")) ??
                true
        );
        this.initializeFromMeta();

        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handlePanelLayout = this.handlePanelLayout.bind(this);

        this.debouncedPersistVTabWidth = debounce(300, () => {
            if (!this.vtabVisible) return;
            const width = this.vtabPanelWrapperRef?.offsetWidth;
            if (width == null || width <= 0) return;
            try {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("workspace", this.getWorkspaceId()),
                    meta: { "layout:vtabbarwidth": width },
                });
            } catch (e) {
                console.warn("Failed to persist vtabbar width:", e);
            }
        });
    }

    static getInstance(): WorkspaceLayoutModel {
        if (!WorkspaceLayoutModel.instance) {
            WorkspaceLayoutModel.instance = new WorkspaceLayoutModel();
        }
        return WorkspaceLayoutModel.instance;
    }

    private getWorkspaceId(): string {
        return globalStore.get(atoms.workspace)?.oid ?? "";
    }

    private getVTabBarWidthAtom(): jotai.Atom<number> {
        return getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:vtabbarwidth");
    }

    private initializeFromMeta(): void {
        try {
            const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
            if (savedVTabWidth != null && savedVTabWidth > 0) {
                this.vtabWidth = savedVTabWidth;
            }
            const tabBarPosition = globalStore.get(getSettingsKeyAtom("app:tabbar")) ?? "top";
            this.vtabVisible = tabBarPosition === "left";
        } catch (e) {
            console.warn("Failed to initialize from workspace meta:", e);
        }
    }

    private getResolvedVTabWidth(): number {
        return clampVTabWidth(this.vtabWidth);
    }

    // The panel group works in percentages; the tab bar width is kept in pixels so that it does not change when
    // the window is resized.
    private computeLayout(windowWidth: number): number[] {
        const vtabW = this.vtabVisible ? this.getResolvedVTabWidth() : 0;
        const vtabPct = windowWidth > 0 ? (vtabW / windowWidth) * 100 : 0;
        return [vtabPct, Math.max(0, 100 - vtabPct)];
    }

    private commitLayout(windowWidth: number): void {
        if (!this.panelGroupRef) return;
        this.inResize = true;
        this.panelGroupRef.setLayout(this.computeLayout(windowWidth));
        this.inResize = false;
    }

    handlePanelLayout(sizes: number[]): void {
        if (this.inResize) return;
        const windowWidth = window.innerWidth;
        if (this.vtabVisible) {
            this.vtabWidth = clampVTabWidth((sizes[0] / 100) * windowWidth);
            this.debouncedPersistVTabWidth();
        }
        this.commitLayout(windowWidth);
    }

    handleWindowResize(): void {
        this.commitLayout(window.innerWidth);
    }

    syncVTabWidthFromMeta(): void {
        const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
        if (savedVTabWidth != null && savedVTabWidth > 0 && savedVTabWidth !== this.vtabWidth) {
            this.vtabWidth = savedVTabWidth;
            this.commitLayout(window.innerWidth);
        }
    }

    registerRefs(
        panelGroupRef: ImperativePanelGroupHandle,
        vtabPanelRef: ImperativePanelHandle,
        panelContainerRef: HTMLDivElement,
        vtabPanelWrapperRef: HTMLDivElement,
        showLeftTabBar: boolean
    ): void {
        this.panelGroupRef = panelGroupRef;
        this.vtabPanelRef = vtabPanelRef;
        this.panelContainerRef = panelContainerRef;
        this.vtabPanelWrapperRef = vtabPanelWrapperRef;
        this.vtabVisible = showLeftTabBar;
        this.syncPanelCollapse();
        this.commitLayout(window.innerWidth);
    }

    private syncPanelCollapse(): void {
        if (!this.vtabPanelRef) return;
        if (this.vtabVisible) {
            this.vtabPanelRef.expand();
        } else {
            this.vtabPanelRef.collapse();
        }
    }

    private enableTransitions(duration: number): void {
        if (!this.panelContainerRef) return;
        const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
        panels.forEach((panel: HTMLElement) => {
            panel.style.transition = "flex 0.2s ease-in-out";
        });
        if (this.transitionTimeoutRef) {
            clearTimeout(this.transitionTimeoutRef);
        }
        this.transitionTimeoutRef = setTimeout(() => {
            if (!this.panelContainerRef) return;
            const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
            panels.forEach((panel: HTMLElement) => {
                panel.style.transition = "none";
            });
        }, duration);
    }

    getVTabInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        if (!showLeftTabBar || windowWidth <= 0) return 0;
        return (this.getResolvedVTabWidth() / windowWidth) * 100;
    }

    setShowLeftTabBar(showLeftTabBar: boolean): void {
        if (this.vtabVisible === showLeftTabBar) return;
        this.vtabVisible = showLeftTabBar;
        this.enableTransitions(250);
        this.syncPanelCollapse();
        this.commitLayout(window.innerWidth);
    }
}

export { WorkspaceLayoutModel };
