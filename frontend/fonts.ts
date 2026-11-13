// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// A script of its own, placed before the app in index.html, so that the fonts start loading as soon as the page is
// parsed rather than once the whole app has been loaded and evaluated.

import { loadFonts } from "@/util/fontutil";

loadFonts();
