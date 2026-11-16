// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

package launchwait

import (
	"encoding/binary"
	"os"
	"testing"
	"time"
)

func TestRot13(t *testing.T) {
	got := rot13(`C:\Users\me\AppData\Local\Programs\Wavelet\app\Wavelet.exe`)
	want := `P:\Hfref\zr\NccQngn\Ybpny\Cebtenzf\Jniryrg\ncc\Jniryrg.rkr`
	if got != want {
		t.Fatalf("rot13 = %q, want %q", got, want)
	}
	if rot13(got) != `C:\Users\me\AppData\Local\Programs\Wavelet\app\Wavelet.exe` {
		t.Fatalf("rot13 is not its own inverse")
	}
}

func TestParseLastStart(t *testing.T) {
	want := time.Date(2026, 11, 16, 9, 19, 0, 879_000_000, time.UTC)
	// a FILETIME counts 100 ns steps from 1601-01-01
	const EpochDiff100ns = 116444736000000000
	data := make([]byte, 72)
	binary.LittleEndian.PutUint64(data[LastStartOffset:], uint64(want.UnixNano()/100+EpochDiff100ns))
	got, ok := parseLastStart(data)
	if !ok || !got.Equal(want) {
		t.Fatalf("parseLastStart = %v, %v; want %v", got, ok, want)
	}
	if _, ok := parseLastStart(data[:LastStartOffset+4]); ok {
		t.Fatalf("a short value was accepted")
	}
	if _, ok := parseLastStart(make([]byte, 72)); ok {
		t.Fatalf("a value without a start time was accepted")
	}
}

func TestOwnProcess(t *testing.T) {
	path, created, err := getProcessPathAndCreation(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if !sameFile(t, path, self) {
		t.Fatalf("path = %q, want %q", path, self)
	}
	age := time.Since(created)
	if age < 0 || age > time.Minute {
		t.Fatalf("created %v ago", age)
	}
}

func sameFile(t *testing.T, a string, b string) bool {
	t.Helper()
	ai, err := os.Stat(a)
	if err != nil {
		t.Fatal(err)
	}
	bi, err := os.Stat(b)
	if err != nil {
		t.Fatal(err)
	}
	return os.SameFile(ai, bi)
}
