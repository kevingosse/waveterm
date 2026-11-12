-- Copyright 2026, Wavelet contributors
-- SPDX-License-Identifier: Apache-2.0

UPDATE db_workspace
SET data = json_set(data, '$.color', '#58C142')
WHERE json_extract(data, '$.icon') = 'custom@wave-logo-solid'
  AND upper(json_extract(data, '$.color')) = '#00C6FF';
