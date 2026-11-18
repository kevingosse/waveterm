// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

const DefaultTermWidgetKey = "defwidget@terminal";

function shouldIncludeWidgetForWorkspace(widget: WidgetConfigType, workspaceId?: string): boolean {
    const workspaces = widget.workspaces;
    return !Array.isArray(workspaces) || workspaces.length === 0 || (workspaceId != null && workspaces.includes(workspaceId));
}

function listWidgetsForWorkspace(
    widgetsMap: { [key: string]: WidgetConfigType },
    workspaceId?: string
): WidgetConfigType[] {
    const widgets = Object.values(widgetsMap ?? {}).filter((widget) =>
        shouldIncludeWidgetForWorkspace(widget, workspaceId)
    );
    widgets.sort((a, b) => (a["display:order"] ?? 0) - (b["display:order"] ?? 0));
    return widgets;
}

// The terminal widget is the one place the configuration says what a plain new terminal is, so overriding it
// in widgets.json changes what a "new terminal" means everywhere it is offered.
function getDefaultTermBlockDef(widgetsMap: { [key: string]: WidgetConfigType }): BlockDef {
    return widgetsMap?.[DefaultTermWidgetKey]?.blockdef ?? { meta: { view: "term", controller: "shell" } };
}

export { getDefaultTermBlockDef, listWidgetsForWorkspace, shouldIncludeWidgetForWorkspace };
