// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package launchwait

// LogLaunchWait does nothing here: the record it reads is kept by the Windows shell.
func LogLaunchWait() {
}
