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
