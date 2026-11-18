// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { assert, test } from "vitest";
import { getDefaultTermBlockDef, listWidgetsForWorkspace, shouldIncludeWidgetForWorkspace } from "./widgetfilter";

test("shouldIncludeWidgetForWorkspace includes widgets with missing or empty workspaces", () => {
    assert(shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} } }, "ws-1"));
    assert(shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: [] }, "ws-1"));
});

test("shouldIncludeWidgetForWorkspace only includes configured workspace IDs", () => {
    assert(shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: ["ws-1", "ws-2"] }, "ws-1"));
    assert(!shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: ["ws-1", "ws-2"] }, "ws-3"));
    assert(!shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: ["ws-1"] }, null));
});

test("listWidgetsForWorkspace keeps the workspace's widgets, in display order", () => {
    const widgets = listWidgetsForWorkspace(
        {
            last: { label: "last", "display:order": 2, blockdef: { meta: {} } },
            elsewhere: { label: "elsewhere", workspaces: ["ws-2"], blockdef: { meta: {} } },
            first: { label: "first", "display:order": -5, blockdef: { meta: {} } },
            unordered: { label: "unordered", blockdef: { meta: {} } },
        },
        "ws-1"
    );
    assert.deepEqual(
        widgets.map((widget) => widget.label),
        ["first", "unordered", "last"]
    );
    assert.deepEqual(listWidgetsForWorkspace(null, "ws-1"), []);
});

test("getDefaultTermBlockDef follows the terminal widget when the configuration overrides it", () => {
    assert.deepEqual(getDefaultTermBlockDef(null), { meta: { view: "term", controller: "shell" } });
    assert.deepEqual(getDefaultTermBlockDef({ other: { blockdef: { meta: { view: "web" } } } }), {
        meta: { view: "term", controller: "shell" },
    });
    const overridden: BlockDef = { meta: { view: "term", controller: "shell", "term:localshellpath": "pwsh.exe" } };
    assert.deepEqual(getDefaultTermBlockDef({ "defwidget@terminal": { blockdef: overridden } }), overridden);
});
