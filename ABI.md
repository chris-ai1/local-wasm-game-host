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
direct filesystem or DOM access. The optional file extension below exposes only
browser-local storage through explicit requests.

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
extension below supplies key-up events; the optional local file extension
supports saves and imports. Gamepad input remains outside this protocol.

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

## Optional stereo audio

Export all four functions below to supply signed 16-bit, little-endian,
interleaved stereo PCM. Games without these exports retain silent operation.
No microphone, network access or browser imports are provided to the module.

| Export | Arguments | Result |
| --- | --- | --- |
| `game_audio_configure` | sample rate in Hz, 8000–192000 | success/failure |
| `game_audio_render` | frame count, 1–8192 | success/failure |
| `game_audio_ptr` | — | PCM buffer pointer |
| `game_audio_len` | — | PCM byte length, exactly frame count × 4 |

After `game_start`, the host configures audio once with the Web Audio device's
sample rate, then requests bounded blocks as playback consumes them. A stereo
frame is left then right; divide each signed sample by 32768 for Web Audio.
The host validates length/range and copies PCM after rendering, reacquiring
memory in case it grew. The pointer remains valid until the next mutating call.
Starting a fresh game resets audio configuration. Rendering audio must not
advance gameplay, input, display or simulation state.

The runner starts Web Audio from the Start button's gesture, keeps a short
bounded output queue and stops it on Stop, file changes, failures or restart.
Mute changes output gain while continuing to consume PCM, preserving the game's
audio clock. Audio failures are reported independently and leave game input
available. Games should keep audio generation within the normal worker timeout.

## Implementing a game

Rust can export functions using `#[unsafe(no_mangle)] pub extern "C" fn ...`
and build a `cdylib` for `wasm32-unknown-unknown`. C/C++ and other languages
can implement the same exports. Keep owned frame/data/message buffers alive
between calls. Do not return stack pointers. This protocol is independent of
any game, archive format, palette, renderer or simulation.


## Optional local files

Export all of the following to request persistent files on the user's device.
Paths are UTF-8 relative paths with `/` separators, ASCII case-insensitive lookup,
no empty/`.`/`..` components, NUL, backslash or colon. The host uses IndexedDB;
files are never sent over the network. Namespace is an opaque stable game ID
(up to 128 characters) which should remain the same across compatible builds.

| Export | Arguments | Result |
| --- | --- | --- |
| `game_file_namespace_ptr` / `game_file_namespace_len` | — | UTF-8 game ID |
| `game_file_kind` | — | 0 none, 1 list directory, 2 read, 3 write |
| `game_file_path_ptr` / `game_file_path_len` | — | Pending request path |
| `game_file_data_ptr` / `game_file_data_len` | — | Write bytes; ignored for list/read |
| `game_file_limit` | — | Maximum read byte count; ignored otherwise |
| `game_file_reply` | opened (0 or 1) | Consume reply and continue; success/failure |

Optional `game_file_default_dir_ptr` / `game_file_default_dir_len` provide the
initial destination folder for the import controls. Without them it is the root.
The game owns its save/load UI; host import and download controls transfer files
between browser storage and the user's filesystem. The namespace persists when
Start creates a fresh instance or the page reloads. Clearing site data deletes
local stored files. Backups download as ordinary individual files.

A request remains stable until replied to. The game must ignore gameplay inputs
while one is pending. The host copies write bytes before awaiting storage.
For replies it calls `input_resize`, writes the returned bytes, and calls
`game_file_reply(opened)`. Successful lists contain concatenated records:
unsigned big-endian 16-bit basename byte length followed by that many UTF-8
bytes, without a record count or terminator. The storage enumeration order is
retained. Read replies contain at most `game_file_limit` raw bytes. Write replies
are empty. Missing files/storage failure reply with opened=0 and empty bytes.
A read may also report partial delivered bytes; games decide their own error
and continuation behavior. The reply buffer is independent of the original
data already loaded by `game_load`.

The host handles requests after each input/update, including between inputs in
a batch. Worker operations are serialized so async file completions cannot
race a new input or audio request. A maximum of sixteen consecutive requests
and 16 MiB per file/reply bound host work. Modules without these exports keep
working; partial extensions are rejected with a readable error.
