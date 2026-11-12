-- Copyright 2026, Wavelet contributors
-- SPDX-License-Identifier: Apache-2.0

-- telemetry (db_activity, db_tevent) and the one-time history import (history_migrated) are gone
DROP TABLE IF EXISTS db_activity;
DROP TABLE IF EXISTS db_tevent;
DROP TABLE IF EXISTS history_migrated;
