# Local Game Room

Authors: Christian Reitwiessner

A generic static GitHub Pages host for a **locally selected `.wasm` game (or ZIP containing it) and
optional data file**. It contains no game binaries, original archives or assets.
Files stay in browser memory for the session. There are no uploads, analytics,
remote scripts, runtime dependencies or storage APIs.

Games implement [Local Game ABI v1](ABI.md): a framebuffer, input events and
status text. This is a compatible-module runner, not a universal emulator.
No game-specific names, hashes, archive parsing or simulation code are used by
the host runtime. It works under GitHub Pages subpaths.

1. Open the hosted page.
2. Choose your compiled `.wasm` game or its downloaded build ZIP. No extraction needed.
3. Choose its data file if needed, then Start.
4. Click the display to use the keyboard, or use the touch controls.

For the private Der Patrizier reimplementation, run `make web` in that checkout,
select `web/patrizier.wasm` (or the `patrizier-web-….zip` release build) and your original `patrizier.zip`. Its data parser,
German interface and current gameplay limitations come from the selected module.
The main game repository and binaries are not published with this site.

Games can supply optional signed 16-bit stereo PCM through the audio extension
in `ABI.md`. Start enables Web Audio; Mute sound silences the output while the
game's music clock continues. Stop and file changes close playback. Audio errors
leave the game running and remain in the runner's error panel. No audio or other
game data is fetched, uploaded or bundled with this site.

Games can opt into physical keyboard input through `game_keyboard_mode`.
The host then forwards USB HID usage IDs with separate press/release events,
including function keys, while suppressing browser key repeat. Other games
retain the existing text/control interface. See the optional extension in
[the ABI documentation](ABI.md).

## Development

Node 20 or newer; no package installation required:

```sh
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. ES module workers require an HTTP(S) origin; opening
`index.html` as a `file://` URL is not supported. The test suite generates tiny
synthetic Wasm fixtures in memory and never needs original game files. Optional
integration checks use `GAME_WASM` and `GAME_DATA` paths outside this repository.

GitHub Pages uses the Actions workflow in `.github/workflows/pages.yml`, following
[GitHub's custom workflow instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Enable Pages with GitHub Actions as the source. Builds publish only `dist/`.

The frame protocol uses the standard [WebAssembly JavaScript interface](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Using_the_JavaScript_API).
The worker accepts no module imports. It validates memory ranges and display
sizes before copying output. Stop and request timeouts terminate execution so
an unresponsive game does not block the page. No backend or service worker is used.

Published builds use content-versioned filenames across the full script, worker
and stylesheet graph so a fresh page cannot mix an old runner with new ZIP code.
The footer identifies the loaded build. Existing open tabs need navigation to
load an update; a fresh query-string URL also bypasses a cached index page.
Errors stay in a separate panel until Dismiss or a new Start, independently of
status messages. "Reload latest runner" navigates to a fresh page and requires
reselecting the local files.
