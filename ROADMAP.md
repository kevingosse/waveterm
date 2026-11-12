# Wavelet roadmap

Where the fork is going and why. Decisions are recorded with the evidence behind them, so that they can be revisited
when the evidence changes.

## Goals

1. A terminal that is ready when it opens: no waiting on the shell, no waiting on the app.
2. Only what gets used. Everything else is removed rather than hidden, so it costs nothing at startup and nothing to
   maintain.
3. Better window management, and better interaction with coding agents through `wsh`.

## Decisions

**Keep the architecture: Electron, a Go backend, a React frontend. No rewrite.**
The slowness that prompted the fork was not in the architecture. In the official app's logs, the window is on screen
about 1.1 s after launch and the Go backend is ready after 0.15 s (median of 120 startups: 134 ms). What made a new
terminal sit on the PowerShell banner was a `wsh.exe` launch in the shell's startup script, which antivirus held for
8 to 18 seconds. A rewrite would spend months re-creating the terminal emulation, layout and remote-connection code to
fix a problem that a small change fixed. What is left of the startup cost is mostly code that loads without being
used, which pruning and lazy loading address directly. Revisit this once Phase 2 is measured: if a cold start is still
far from the target with everything unnecessary gone, the next thing to question is one renderer process per tab.

**Hard fork.** Upstream is a remote to cherry-pick from, not something to stay mergeable with. Removing features makes
merges conflict everywhere, and upstream's pace is slow enough that little is lost.

**Windows only, with Linux `wsh` for remotes.** Cross-platform code paths stay where they cost nothing, but only
Windows x64 is built and tested, plus `wsh` for Linux x64 and arm64 (WSL, SSH hosts).

**Deployed from source as an unpacked directory.** No installer and no updater. `ops/deploy.ps1` builds, smoke-tests,
stages and swaps; `ops/rollback.ps1` goes back. Versions are `0.20.<commits since the fork point>`.

## Phase 0: foundation (done)

- Builds from source on Windows; development, release and rollback tooling in `ops/`.
- Own identity, directories and remote directory; nothing sent to upstream's cloud; no auto-update.
- Local shells no longer launch `wsh` before their first prompt. Measured in a dev build: 565 to 631 ms from creating
  a terminal block to the PowerShell prompt, which is PowerShell's own startup plus the user profile.

## Phase 1: remove what is not used

In this order, because of how the pieces depend on each other. Each step ends with a build, a type check, the test
suite, and a smoke test of the packaged app.

1. **Dead code and developer tooling**: the component preview server, unused files and npm packages, unused Go
   packages and test harnesses. Goes first because the preview server mocks the interfaces that every later step
   changes.
2. **The app builder (Tsunami, WaveApps) together with Wave AI.** They import each other on both the Go and the
   TypeScript side. This is the largest step: the AI panel is part of the workspace layout, of focus handling and of
   keyboard navigation, and is mounted in every tab even when hidden.
3. **What is left of telemetry, onboarding and the updater**, including the calls spread through the connection and
   job code, and the telemetry tables (dropped by a new migration, not by editing old ones).
4. **Help, tips and the documentation site.**
5. **Optional, decide when we get there**: the legacy VDOM view (woven into the terminal view) and the process
   viewer.

Known traps:

- The generated RPC client is referenced by name from frontend types. Remove frontend uses before, or together with,
  regenerating after an RPC is removed.
- When removing RPC types, run `generatego` before `generatets`, and prune the hard-coded import list in
  `cmd/generatego/main-generatego.go`, or the generated client will not compile.
- `secretstore` stays (SSH passwords), and so does `TermGetScrollbackLines` (`wsh termscrollback`).
- First launch gets its starter layout from the terms-of-service flow. When onboarding goes, that has to move.

## Phase 2: startup

Measure first; `ops/measure-prompt.mjs` covers the shell, and the app start needs the same treatment. Then, roughly
in order of expected gain:

1. Load on demand what is rarely needed: the code editor, charts, the markdown stack. Today every tab loads all of
   it before showing anything.
2. Stop waiting for 9.5 MB of fonts before reporting a tab ready.
3. Run the initial requests of a tab in parallel instead of one after another.
4. Create the first tab's renderer while the backend starts, not after; delay the spare tab until the first one is
   visible; show each window as soon as it is ready.
5. Start the shell before the terminal view has been measured, and resize once the size is known.

## Phase 3: windows and agents

To be designed. Starting points: what `wsh` can already do for an agent (open previews, editors, web views, read
scrollback), what is awkward about it (every call used to block on a telemetry round-trip; addressing blocks is
clumsy), and what window management lacks today.

## Open questions

- **Antivirus and fresh builds.** Every new build is a new unsigned binary, and Windows Defender sometimes holds a Go
  binary it has not seen at its path for about ten seconds on first launch (the first start of the first deployed
  build waited 10.9 s for the backend; the second start, 51 ms). The deploy now launches the installed binaries once
  to take that hit early. Whether the hold comes back for a binary that has aged a few hours is not known yet. If it
  shows up in daily use, the options are a Defender exclusion for the install directory or signing the binaries with
  a locally trusted certificate.
- **A terminal that lost its first output.** Once, a terminal block created by a script within seconds of the app
  starting showed neither its first line of output nor its first prompt until something was typed. Two retries on a
  settled instance were fine. Unconfirmed, but the suspect is the terminal view being rebuilt while the tab is still
  initialising (it is rebuilt whenever any `term:*` setting object changes). Look at this in Phase 2, since the first
  terminal of a fresh start is exactly the case that has to be right.
