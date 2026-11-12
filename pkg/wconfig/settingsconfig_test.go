// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// Existing settings.json files still contain keys of features that were removed from the fork. Reading them must not
// produce a config error, and changing another setting must keep them in the file rather than fail.
func TestRemovedSettingsKeysAreTolerated(t *testing.T) {
	configDir := t.TempDir()
	wavebase.ConfigHome_VarCache = configDir
	settingsPath := filepath.Join(configDir, SettingsFile)
	settings := `{
  "autoupdate:channel": "latest",
  "telemetry:enabled": false,
  "widget:showhelp": false,
  "term:fontsize": 13
}`
	if err := os.WriteFile(settingsPath, []byte(settings), 0644); err != nil {
		t.Fatalf("failed to write settings: %v", err)
	}

	fullConfig := ReadFullConfig()
	if len(fullConfig.ConfigErrors) != 0 {
		t.Fatalf("expected no config errors, got %+v", fullConfig.ConfigErrors)
	}
	if fullConfig.Settings.TermFontSize != 13 {
		t.Fatalf("expected term:fontsize 13, got %v", fullConfig.Settings.TermFontSize)
	}

	if err := SetBaseConfigValue(waveobj.MetaMapType{ConfigKey_TermFontSize: 14.0}); err != nil {
		t.Fatalf("SetBaseConfigValue failed: %v", err)
	}
	barr, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("failed to read settings back: %v", err)
	}
	var written map[string]any
	if err := json.Unmarshal(barr, &written); err != nil {
		t.Fatalf("written settings are not valid json: %v", err)
	}
	if written["term:fontsize"] != 14.0 {
		t.Fatalf("expected term:fontsize 14 after the update, got %v", written["term:fontsize"])
	}
	if written["autoupdate:channel"] != "latest" || written["telemetry:enabled"] != false || written["widget:showhelp"] != false {
		t.Fatalf("expected the removed keys to be kept as they were, got %s", string(barr))
	}
}
