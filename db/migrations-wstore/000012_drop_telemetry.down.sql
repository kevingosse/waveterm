-- Copyright 2026, Wavelet contributors
-- SPDX-License-Identifier: Apache-2.0

-- same definitions as in 000003_activity, 000004_history and 000007_events
CREATE TABLE db_activity (
    day varchar(20) PRIMARY KEY,
    uploaded boolean NOT NULL,
    tdata json NOT NULL,
    tzname varchar(50) NOT NULL,
    tzoffset int NOT NULL,
    clientversion varchar(20) NOT NULL,
    clientarch varchar(20) NOT NULL,
    buildtime varchar(20) NOT NULL DEFAULT '-',
    osrelease varchar(20) NOT NULL DEFAULT '-'
);

CREATE TABLE history_migrated (
	historyid varchar(36) PRIMARY KEY,
    ts bigint NOT NULL,
	remotename varchar(200) NOT NULL,
	haderror boolean NOT NULL,
    cmdstr text NOT NULL,
	exitcode int NULL DEFAULT NULL, 
	durationms int NULL DEFAULT NULL
);

CREATE TABLE db_tevent (
   uuid varchar(36) PRIMARY KEY,
   ts int NOT NULL,
   tslocal varchar(100) NOT NULL,
   event varchar(50) NOT NULL,
   props json NOT NULL,
   uploaded boolean NOT NULL DEFAULT 0
);
