-- Copyright 2026, Wavelet contributors
-- SPDX-License-Identifier: Apache-2.0

-- A starter workspace shows the logo in the colour of the app icon. Workspaces created by Wave Terminal, or by this
-- fork before it had a colour of its own, carry upstream's green; those that still have that default get the blue.
UPDATE db_workspace
SET data = json_set(data, '$.color', '#00C6FF')
WHERE json_extract(data, '$.icon') = 'custom@wave-logo-solid'
  AND upper(json_extract(data, '$.color')) = '#58C142';
