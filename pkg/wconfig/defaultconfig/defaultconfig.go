// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

package defaultconfig

import "embed"

//go:embed *.json
var ConfigFS embed.FS
