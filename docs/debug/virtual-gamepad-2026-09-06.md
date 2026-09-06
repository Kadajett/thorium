# Registered Android virtual-gamepad verification

Signal Fleet 0.1.1 correctly handled a registered virtual joystick through
Android's native controller and host-bridge path. No production fix was needed.
The previous shell `input joystick motionevent` observation had received no
bridge events and therefore could not test this path.

## Scope and mechanism

Root verified `emulator-5554` reports emulator mode, a root shell, and the
existing private `dev.yougotserved.thorium.rewrite` process 12496. Both visible,
attached WebViews loaded the exact Signal release content digest
`d17273fce867403e79149652783b6d2a65858a39d838eef38a1f8200994e9747`.
APK and viewport identities are in [the candidate record](../signal-fleet-candidate-0.1.1.md).

The [Android 15 uinput documentation](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/cmds/uinput/README.md)
describes registering a device, declaring absolute-axis ranges, injecting
events and unregistering on stream closure. The emulator provides this tool
at `/system/bin/uinput`; no binary or driver was installed.

The diagnostic registers a uniquely named USB gamepad with EV_KEY/EV_ABS,
standard gamepad buttons, and ABS_X/ABS_Y ranges from -32768 to 32767. It checks
the registered device's reported ranges before input and waits for Android
registration. Each test sends axis values and SYN_REPORT through that device.
No gamepad buttons are pressed, so the probe does not fire or concede a shot.

Temporary pass-through observers on the exact two WebViews collect at most
64 validated direction-control entries: control name, phase, player and value.
They do not retain bootstrap, capability, peer or network payloads. The original
native receiver still handles every message normally and is restored afterward.
These observers report delivery and DOM selection, not input-to-photon latency.

## Results

The first run, `/tmp/thorium-virtual-pad-aW8Zw5`, exercised Y values
32767 → 0 → -32768 → 0. Cursor indices were 16 → 16 → 9 → 9, starting at 9.
Exactly down-pressed, down-released, up-pressed and up-released reached companion
Player Slot 0. Main received no direction controls.

The second run, `/tmp/thorium-virtual-pad-ggvJ39`, asserted every step:

|      X |      Y | Expected and observed cursor |
| -----: | -----: | ---------------------------: |
|   3276 |   3276 |                            9 |
|      0 |      0 |                            9 |
|  32767 |      0 |                           10 |
|      0 |      0 |                           10 |
| -32768 |      0 |                            9 |
|      0 |      0 |                            9 |
|  24000 |  24000 |                           17 |
|      0 |      0 |                           17 |
| -24000 | -24000 |                            9 |
|      0 |      0 |                            9 |

The first two samples produced no controls. Subsequent samples produced exactly
12 expected right/left/down/up press/release entries, all for companion Player
Slot 0, with no main events. Both complete chart HTML values were byte-identical
before and after each run, and the cursor returned to index 9. These checks
validate only these sampled amplitudes, not all deadzone boundaries or hardware
calibration values.

Both directories retain their marked disposable `probe.mts` and `evidence.json`.
The second harness asserts expected cursor position and role ownership at each
step. Additional read-only assertions over the reports verified exact event
sequences, chart restoration and cleanup. These scripts are one-run diagnostics;
their existing evidence files must not be overwritten or treated as generic
production tooling.

## Cleanup and limitations

Each uinput stream was closed, each created device was confirmed absent from
`getevent -lp`, both CDP observers were restored, and the created ADB forward
was removed. The private application remained on PID 12496. Only ordinary
direction inputs were sent; they may cause normal cursor autosaves. No direct
save-write command, APK installation, data clear, package edit or public
publication occurred.

The diagnosis skill guided improving the failing test setup before changing
working production input code. This supports using a registered controller for
future game checks. It is not a physical AYN Thor result, a 60/120 FPS pass,
or proof of analogue steering in Serpent's distinct axis-valued contract.
