# First controller event lost when leaving touch mode

## Reproduction and scope

Observed on an Android emulator running the published `0.1.0-dev.7` APK, with a
1080×2400 portrait main display and both catalog games visible in one column.
This is Android runtime evidence, not a claim of physical AYN Thor verification.

```sh
node apps/android/scripts/catalog-controller-repro.mjs
node apps/android/scripts/catalog-controller-repro.mjs --joystick
```

The script requires an installed APK and a catalog containing Cinder Circuit and
Serpent World. It restarts the app without clearing its data, taps an inert heading
to enter touch mode, cold-restarts, and injects one real Android input event. It
derives the expected card from the actual layout bounds and checks both semantic
selection and Android accessibility focus. Each run saves UI XML and bounded,
capability-free `ThoriumInput` logs under a unique temporary evidence directory.

Override `ADB`, `ANDROID_SERIAL`, and `THORIUM_APP_ID` for another test target.
Do not run this against a user's active game without permission: it force-stops
the selected application to establish a repeatable cold-launch state.

## Red before the fix

Initial state: Cinder `checked=true`, `focused=false`; Serpent unselected.

The first `input -d 0 keyevent KEYCODE_DPAD_DOWN` produced:

- Search `focused=true`;
- both game cards `checked=false` and `focused=false`;
- no catalog input trace for that key.

The replay failed with `First Down selects Serpent World`. A second Down reached
the Activity and produced `role=catalog key=20 action=0`, distinguishing pipeline
consumption from a missing command collector or a navigation-policy calculation.

## Cause and minimal fix

Android processes the touch-mode transition before dispatching keys to the
Activity. If the transition establishes a new focused view, it can consume the
navigation key. This behavior is explicit in AOSP's
[`EarlyPostImeInputStage` and `checkForLeavingTouchModeAndConsume`](https://android.googlesource.com/platform/frameworks/base/+/android12-release/core/java/android/view/ViewRootImpl.java).

The launcher's clickable cards had explicit selection but could not retain focus
in touch mode. Consequently the Activity-level interception never saw the first
Down, and framework-established Search focus changed the Compose selection.

`GameCoverCard` now applies `focusProperties { canFocus = true }`. Its existing
FocusRequester can establish and retain the selected card's actual focus in touch
mode. The first key therefore reaches the existing explicit navigation policy.
No directional commands are synthesized and no extra input listeners are needed.

## Green after the fix

Both real-event replays passed on the emulator using the locally built dev.8 APK:

| Input | Before | After one event |
| --- | --- | --- |
| D-pad Down | Cinder selected and focused | Serpent selected and focused |
| Joystick `MOVE 0 1` | Cinder selected and focused | Serpent selected and focused |

Search remained unfocused. The joystick event reached the Activity with
`role=catalog motion=2 source=16777232 display=0`.

The full native gate also passed: 120 JVM tests across 23 suites, zero failures or
errors, `lintDebug`, and `assembleDebug`. Lint retained only the unrelated existing
`UseKtx` warning in `DeviceAccountAuthorization.kt`.

The regression specifically covers the launcher ViewRoot/Activity/Compose input
boundary. It does not verify game WebView controller semantics, hardware axis
mapping, dual-display placement on Thor, or game startup/rendering. Those require
their own runtime checks; the Serpent startup failure had a separate SDK bootstrap
validation cause.
