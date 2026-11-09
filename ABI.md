# Local Game ABI v1

Authors: Christian Reitwiessner

An import-free WebAssembly module can run in this host, regardless of its source
language. A native ELF, PE, Mach-O or Amiga HUNK executable needs a port or an
emulator; selecting one does not convert it to WebAssembly. Emscripten/WASI
modules requiring runtime imports are not supported by this interface.

The host selects a game binary (or a ZIP containing exactly one `.wasm` file)
and optionally one opaque data file from the
local filesystem. Neither is fetched from a URL, uploaded, persisted or bundled
with the website. Games execute in a terminable worker. Only the static host
code is downloaded. WebAssembly modules receive no JavaScript imports, network,
filesystem or DOM access.

## Required exports

Export a non-shared `WebAssembly.Memory` as `memory` and these functions. All
parameters/results are `i32`, interpreted as unsigned except signed input
coordinates. Pointers refer to wasm32 linear memory. Success is exactly `1`;
failure is `0`. Traps are also reported as errors.

| Export | Arguments | Result |
| --- | --- | --- |
| `game_abi_version` | — | `1` |
| `input_resize` | byte length | Writable data pointer, or `0` on allocation failure |
| `game_load` | — | Load the data most recently written by the host; success/failure |
| `game_start` | — | Initialize a fresh game; success/failure |
| `game_input` | kind, a, b | Handle an input event; success/failure |
| `game_frame_width` | — | Display width, 1–2048 |
| `game_frame_height` | — | Display height, 1–2048 |
| `game_frame_ptr` | — | Contiguous width × height × 4 bytes, RGBA8, rows top to bottom |
| `game_status_ptr` | — | UTF-8 status text pointer |
| `game_status_len` | — | Status byte length, 0–65536 |
| `error_ptr` | — | UTF-8 error text pointer |
| `error_len` | — | Error byte length, 0–65536 |

ZIPs may use stored or deflate compression; nested folders and macOS sidecars
are supported, while encrypted, split and ZIP64 archives are rejected. ZIP
headers, entry lengths and CRC-32 are checked. Decompression uses the browser's
[Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream)
inside the game worker, with bounded output. The data file is passed through
unchanged, including when it is itself a ZIP.

The data file is limited to 128 MiB, the game file and unpacked module to 64 MiB. The game can impose
smaller limits. With a data file selected, the host calls `input_resize`, writes
all bytes, calls `game_load`, then `game_start`. An explicitly selected empty
file still calls `game_load`; no selected data file skips both data functions.
Games requiring data should return an explanatory error from `game_start` when
it is absent. The host starts a new worker and module instance for every Start.

After start and every input/update, the host reads and copies the current frame
and status. Getter functions must have no side effects and keep their returned
pointers valid until the next mutating exported call. Mutating calls may grow
memory or relocate buffers; the host reacquires views afterward. RGBA alpha is
composited against an opaque canvas; games should normally emit alpha 255.

## Input events

| kind | a | b |
| --- | --- | --- |
| 1 | Unicode scalar value (character) | 0 |
| 2 | 0 (Return) | 0 |
| 3 | 0 (Backspace) | 0 |
| 4 | 0 (Escape) | 0 |
| 5 | x (left pointer release) | y |
| 6 | x (right pointer release) | y |
| 7 | Game-specific replay/raster input; not emitted by the UI | 0 |
| 8 | 0 (Left arrow) | 0 |
| 9 | 0 (Right arrow) | 0 |

Coordinates are display pixels. Releases outside the displayed image are ignored.
Keyboard autorepeat is delivered normally. The host bounds queued input to 256
events and processes batches of up to 32 before copying the next frame. A single
paste over 256 characters is rejected without sending any of it. Unsupported inputs should be ignored
with success, unless a game intentionally needs to report an error. This small
interface supports text and pointer-driven games. The optional physical keyboard
extension below supplies key-up events; gamepad, audio and save-file channels
remain outside the current protocol.

## Optional animation

Export `game_tick(milliseconds) -> success/failure` for continuous updates.
The host calls it once per completed animation-frame request, never stacking
ticks. The first duration is zero; subsequent durations are rounded elapsed
milliseconds clamped to 0–100, including time spent in the previous update.
Visibility throttling follows the browser. Games without this export update
only on input. The host currently allows 20 seconds for initial loading and
3 seconds per event/update; timeout or Stop terminates the worker.

## Optional pointer motion

Export `game_pointer_move(x, y) -> success/failure` to receive movement over the
display in pixel coordinates. This is separate from the required `game_input`
events so older games do not receive unknown event kinds. The host sends motion
only when this export exists, in the same bounded queue as other inputs. Games
can combine it with `game_tick` for raster-paced scrolling or animation.

## Optional physical keyboard

Export `game_keyboard_mode() -> u32`, returning 1 when physical keyboard events
are wanted. Every snapshot refreshes this mode. While enabled, mapped keys use
`game_input(12, usage, pressed)`, with a USB HID keyboard-page usage ID and
`pressed` equal to 1 for key-down or 0 for key-up. Other input kinds remain
available for mobile text, buttons and pointer input. The host suppresses
autorepeat in physical mode and pairs releases only with captured presses.
Losing focus releases captured keys. A game should ignore physical keys it
does not implement. Games without the export retain the original behavior.

## Implementing a game

Rust can export functions using `#[unsafe(no_mangle)] pub extern "C" fn ...`
and build a `cdylib` for `wasm32-unknown-unknown`. C/C++ and other languages
can implement the same exports. Keep owned frame/data/message buffers alive
between calls. Do not return stack pointers. This protocol is independent of
any game, archive format, palette, renderer or simulation.
