// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

package cmd

import (
	"encoding/json"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var debugCmd = &cobra.Command{
	Use:               "debug",
	Short:             "debug commands",
	PersistentPreRunE: preRunSetupRpcClient,
	Hidden:            true,
}

var debugBlockIdsCmd = &cobra.Command{
	Use:    "block",
	Short:  "list sub-blockids for block",
	RunE:   debugBlockIdsRun,
	Hidden: true,
}

func init() {
	debugCmd.AddCommand(debugBlockIdsCmd)
	rootCmd.AddCommand(debugCmd)
}

func debugBlockIdsRun(cmd *cobra.Command, args []string) error {
	oref, err := resolveBlockArg()
	if err != nil {
		return err
	}
	blockInfo, err := wshclient.BlockInfoCommand(RpcClient, oref.OID, nil)
	if err != nil {
		return err
	}
	barr, err := json.MarshalIndent(blockInfo, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(barr))
	return nil
}
