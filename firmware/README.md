# MECT Firmware

This directory contains firmware for the screenless Multisensory Experience Capture Tool (MECT) device. It records participant-initiated JPEG photographs and WAV audio to microSD, writes a session manifest at the end of each session, and supports BLE transfer to the MECT web application.

## Hardware

The current firmware targets the Seeed Studio XIAO ESP32S3 Sense, using its onboard camera, microphone, and microSD support. The tested field-power method is a standard USB power bank connected to the board's USB-C port. The device has three physical controls:

| Control | Function | Pin |
| --- | --- | --- |
| Capture | Capture one photo | D0 |
| End Capture | End the session and save its manifest | D1 |
| Audio | Start or stop audio recording | D2 |

These pin assignments are defined in `src/Config.h`. For the breadboard assembly and button wiring, see the [Hardware Assembly Guide](../docs/HARDWARE_ASSEMBLY.md).

## Prototype Assembly

The current prototype is assembled around a Seeed Studio XIAO ESP32S3 Sense mounted on a breadboard with three push buttons used for interaction:

- **Capture** button
- **Audio** button
- **End Capture** button

The figure below shows the breadboard-based prototype assembly used during development and evaluation.

![Breadboard assembly of the MECT prototype showing the XIAO ESP32S3 Sense and three push buttons.](../docs/images/mect-prototype-assembly.jpg)

The button functions and pin mappings are described in the Hardware section and defined in `src/Config.h`. This assembly is intended as a prototype reference rather than a finalized enclosure design.

## Supported Capture Types

- JPEG photographs
- WAV audio recordings
- No video capture
- No GPS or location coordinates

WAV audio is recorded as 16 kHz, mono, 16-bit PCM with 2x digital gain and saturation.

## Session Storage

Media files are written to the microSD card. Photographs use names such as `IMG_0001.JPG`; audio recordings use names such as `AUD_0001.WAV`. When **End Capture** is pressed, the firmware writes `session.json` with each registered capture's ID, filename, media type, and timestamp in milliseconds relative to the session start. An active audio recording is finalized before the manifest is written.

## Build and Upload

1. Open `firmware/` as a PlatformIO project.
2. Connect the XIAO ESP32S3 Sense.
3. Select the `seeed_xiao_esp32s3` environment.
4. Build the project in PlatformIO.
5. Upload the firmware to the board.
6. Open the serial monitor at **115200 baud**.

The environment is configured in `platformio.ini` for the `seeed_xiao_esp32s3` board using the Arduino framework.

## Expected Startup Checks

Check serial output before field use. Individually verify the microSD write/read test (`SD_TEST_SUCCESS`), camera initialization (`Camera initialized.`), and button initialization (`Buttons initialized.`). Do not rely on the final `Device ready.` message alone, because it can appear after an earlier SD or camera failure. Microphone setup occurs when audio recording is first started, not at boot; verify it with a short test recording.

## Field Use

- Press **Capture** to save one photo when the camera and storage are available.
- Press **Audio** to start a recording, then press it again to stop and save the WAV file.
- Press **End Capture** to finalize any active audio recording and write `session.json`.
- Photos are ignored while audio recording is active.
- A session can register up to 50 captures total. Captures beyond this limit are not registered in the session manifest.

## Transfer

The session can be imported from the microSD card or transferred over BLE to the web application. See the [MECT Usage Guide](../docs/USAGE_GUIDE.md) for the detailed study workflow.

## Current Constraints

The device has no display, GPS, or video capture.

### Tested firmware environment

The thesis-release firmware successfully builds with:

- PlatformIO Core 6.2.0
- Espressif 32 platform 7.0.1
- Board: `seeed_xiao_esp32s3`
- Arduino framework
- `framework-arduinoespressif32` 3.20017.241212+sha.dcc1105b
- Xtensa ESP32-S3 toolchain 8.4.0+2021r2-patch5
