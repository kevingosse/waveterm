// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Modified by the Wavelet fork; modifications Copyright 2026, Wavelet contributors.

import { getEnv } from "./getenv";
import { lazy } from "./util";

export const WebServerEndpointVarName = "WAVE_SERVER_WEB_ENDPOINT";
export const WSServerEndpointVarName = "WAVE_SERVER_WS_ENDPOINT";

export const getWebServerEndpoint = lazy(() => {
    return `http://${getEnv(WebServerEndpointVarName)}`;
});

export const getWSServerEndpoint = lazy(() => {
    return `ws://${getEnv(WSServerEndpointVarName)}`;
});
