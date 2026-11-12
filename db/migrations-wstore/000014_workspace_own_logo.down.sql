-- Copyright 2026, Wavelet contributors
-- SPDX-License-Identifier: Apache-2.0

UPDATE db_workspace
SET data = json_set(data, '$.icon', 'custom@wave-logo-solid')
WHERE json_extract(data, '$.icon') = 'custom@wavelet';
