-- Copyright 2026, Wavelet contributors
-- SPDX-License-Identifier: Apache-2.0

-- The app has a mark of its own now, and upstream's logo is no longer offered as a workspace icon.
UPDATE db_workspace
SET data = json_set(data, '$.icon', 'custom@wavelet')
WHERE json_extract(data, '$.icon') = 'custom@wave-logo-solid';
