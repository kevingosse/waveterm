// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Starts the local shells of every window's active tab without waiting for the frontend to ask for them.
//
// Normally a shell is started when its terminal view has rendered and measured itself, which is after the window is
// on screen. A shell then needs most of a second to reach its first prompt (for PowerShell: runtime startup plus the
// user's profile), about as long as the window needed to appear. Starting it here runs the two side by side, so the
// prompt is there when the terminal becomes visible.
//
// The shell starts at the terminal size stored with the block, which is the size it had last time. When the frontend
// attaches it resizes the pty if the view turned out different. Remote shells are left to the frontend: they need a
// connection, and connecting is something the user should see happen.
func PrestartActiveTabShells(ctx context.Context) {
	defer func() {
		panichandler.PanicHandler("blockcontroller:prestart-scan", recover())
	}()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil || client == nil {
		log.Printf("prestart: cannot read client: %v\n", err)
		return
	}
	for _, windowId := range client.WindowIds {
		window, err := wstore.DBGet[*waveobj.Window](ctx, windowId)
		if err != nil || window == nil {
			continue
		}
		workspace, err := wstore.DBGet[*waveobj.Workspace](ctx, window.WorkspaceId)
		if err != nil || workspace == nil || workspace.ActiveTabId == "" {
			continue
		}
		tab, err := wstore.DBGet[*waveobj.Tab](ctx, workspace.ActiveTabId)
		if err != nil || tab == nil {
			continue
		}
		for _, blockId := range tab.BlockIds {
			block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
			if err != nil || block == nil {
				continue
			}
			if block.Meta.GetString(waveobj.MetaKey_Controller, "") != BlockController_Shell {
				continue
			}
			if !conncontroller.IsLocalConnName(block.Meta.GetString(waveobj.MetaKey_Connection, "")) {
				continue
			}
			go prestartShell(tab.OID, blockId)
		}
	}
}

func prestartShell(tabId string, blockId string) {
	defer func() {
		panichandler.PanicHandler("blockcontroller:prestart", recover())
	}()
	log.Printf("prestart: starting shell for block %s\n", blockId)
	// the stored block is the source of the terminal size here; the frontend's own resync later finds the
	// controller running and leaves it alone
	err := ResyncController(context.Background(), tabId, blockId, nil, false)
	if err != nil {
		log.Printf("prestart: block %s: %v\n", blockId, err)
	}
}
