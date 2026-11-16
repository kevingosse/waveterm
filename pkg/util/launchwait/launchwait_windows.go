// Copyright 2026, Wavelet contributors
// SPDX-License-Identifier: Apache-2.0

// Package launchwait reports how long Windows took to create the app's process after Explorer was asked to
// start it. Nothing the app logs about itself can show that time, and it is where an antivirus scan of the
// app's executable is spent.
package launchwait

import (
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Explorer keeps, for every program it has started, a run count and the time of the last start. A value is
// named after the program's path, in ROT13. Programs under a few system folders are recorded with the
// folder's id in place of its path; those are not looked for.
const UserAssistKey = `Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist\{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}\Count`

// where the FILETIME of the last start sits in a value
const LastStartOffset = 60

// An older record is of an earlier start: this time something other than Explorer started the app.
const MaxWait = 2 * time.Minute

// long enough after the backend's start that looking this up cannot compete with start-up
const LogDelay = 3 * time.Second

func rot13(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return 'a' + (r-'a'+13)%26
		case r >= 'A' && r <= 'Z':
			return 'A' + (r-'A'+13)%26
		}
		return r
	}, s)
}

func parseLastStart(data []byte) (time.Time, bool) {
	if len(data) < LastStartOffset+8 {
		return time.Time{}, false
	}
	ft := windows.Filetime{
		LowDateTime:  binary.LittleEndian.Uint32(data[LastStartOffset:]),
		HighDateTime: binary.LittleEndian.Uint32(data[LastStartOffset+4:]),
	}
	if ft.LowDateTime == 0 && ft.HighDateTime == 0 {
		return time.Time{}, false
	}
	return time.Unix(0, ft.Nanoseconds()), true
}

func getLastExplorerStart(exePath string) (time.Time, bool) {
	key, err := registry.OpenKey(registry.CURRENT_USER, UserAssistKey, registry.QUERY_VALUE)
	if err != nil {
		return time.Time{}, false
	}
	defer key.Close()
	data, _, err := key.GetBinaryValue(rot13(exePath))
	if err != nil {
		return time.Time{}, false
	}
	return parseLastStart(data)
}

func getProcessPathAndCreation(pid int) (string, time.Time, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("opening process %d: %w", pid, err)
	}
	defer windows.CloseHandle(handle)
	var creation, exit, kernel, user windows.Filetime
	err = windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("reading the times of process %d: %w", pid, err)
	}
	buf := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buf))
	err = windows.QueryFullProcessImageName(handle, 0, &buf[0], &size)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("reading the path of process %d: %w", pid, err)
	}
	return windows.UTF16ToString(buf[:size]), time.Unix(0, creation.Nanoseconds()), nil
}

// LogLaunchWait writes one line to the log when the app (the process that started this one) was started
// through Explorer: Start menu, taskbar, desktop. It blocks for LogDelay; call it in a goroutine.
func LogLaunchWait() {
	time.Sleep(LogDelay)
	exePath, created, err := getProcessPathAndCreation(os.Getppid())
	if err != nil {
		return
	}
	asked, found := getLastExplorerStart(exePath)
	if !found {
		return
	}
	wait := created.Sub(asked)
	if wait < 0 || wait > MaxWait {
		return
	}
	log.Printf("launch: Windows created the app's process %d ms after Explorer was asked to start it\n", wait.Milliseconds())
}
