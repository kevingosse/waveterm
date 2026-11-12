// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/migrateutil"

	dbfs "github.com/wavetermdev/waveterm/db"
)

var droppedTables = []string{"db_activity", "db_tevent", "history_migrated"}

func getTableSql(t *testing.T, db *sql.DB, tableName string) string {
	t.Helper()
	var tableSql string
	err := db.QueryRow("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", tableName).Scan(&tableSql)
	if err == sql.ErrNoRows {
		return ""
	}
	if err != nil {
		t.Fatalf("reading schema of %s: %v", tableName, err)
	}
	return tableSql
}

// Migration 12 drops the telemetry and history-import tables; its down migration must recreate them exactly as the
// original migrations did.
func TestDropTelemetryTablesMigration(t *testing.T) {
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "migrations.db")+"?mode=rwc")
	if err != nil {
		t.Fatalf("opening db: %v", err)
	}
	m, err := migrateutil.MakeMigrate("wstore", db, dbfs.WStoreMigrationFS, "migrations-wstore")
	if err != nil {
		t.Fatalf("making migrate: %v", err)
	}
	defer m.Close()

	if err := m.Migrate(11); err != nil {
		t.Fatalf("migrating to 11: %v", err)
	}
	originalSql := make(map[string]string)
	for _, tableName := range droppedTables {
		originalSql[tableName] = getTableSql(t, db, tableName)
		if originalSql[tableName] == "" {
			t.Fatalf("expected %s to exist at version 11", tableName)
		}
	}

	if err := m.Migrate(12); err != nil {
		t.Fatalf("migrating to 12: %v", err)
	}
	for _, tableName := range droppedTables {
		if getTableSql(t, db, tableName) != "" {
			t.Fatalf("expected %s to be dropped at version 12", tableName)
		}
	}

	if err := m.Steps(-1); err != nil {
		t.Fatalf("migrating down to 11: %v", err)
	}
	for _, tableName := range droppedTables {
		if tableSql := getTableSql(t, db, tableName); tableSql != originalSql[tableName] {
			t.Fatalf("down migration recreated %s differently:\n%s\nexpected:\n%s", tableName, tableSql, originalSql[tableName])
		}
	}
}
