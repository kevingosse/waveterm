// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

package shellexec

import "testing"

func TestPwshOptsHaveCommand(t *testing.T) {
	tests := []struct {
		name string
		opts []string
		want bool
	}{
		{"no options", nil, false},
		{"flags only", []string{"-NoLogo", "-NoExit", "-NoProfile"}, false},
		{"execution policy is not a command", []string{"-ExecutionPolicy", "Bypass", "-ex", "Bypass", "-ep", "Bypass"}, false},
		{"configuration name is not a command", []string{"-ConfigurationName", "x", "-config", "x"}, false},
		{"working directory", []string{"-WorkingDirectory", "C:\\src", "-wd", "C:\\src"}, false},
		{"command", []string{"-NoExit", "-Command", "&{Enter-VsDevShell}"}, true},
		{"command abbreviated", []string{"-c", "ls"}, true},
		{"command mixed case", []string{"-COMMAND", "ls"}, true},
		{"file", []string{"-File", "x.ps1"}, true},
		{"file abbreviated", []string{"-f", "x.ps1"}, true},
		{"encoded command", []string{"-EncodedCommand", "AAAA"}, true},
		{"encoded command abbreviated", []string{"-e", "AAAA"}, true},
		{"encoded command ec", []string{"-ec", "AAAA"}, true},
		{"command with args", []string{"-CommandWithArgs", "x"}, true},
		{"command with args abbreviated", []string{"-cwa", "x"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := pwshOptsHaveCommand(tt.opts); got != tt.want {
				t.Errorf("pwshOptsHaveCommand(%q) = %v, want %v", tt.opts, got, tt.want)
			}
		})
	}
}
