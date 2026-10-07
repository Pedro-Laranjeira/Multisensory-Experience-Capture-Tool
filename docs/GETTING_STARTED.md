# Getting Started with MECT

The Multisensory Experience Capture Tool (MECT) combines a screenless physical capture device, a web application, a researcher-configured questionnaire, and exported research data. Participants record selected JPEG photographs or WAV audio during an experience, then reflect on those moments afterward.

Start with this guide, assemble the device, then use the [Usage Guide](USAGE_GUIDE.md) for the full researcher and participant workflow.

## 1. What You Need

### Hardware

- Seeed Studio XIAO ESP32S3 Sense board, which includes the camera, microphone, and microSD interface.
- Breadboard, three normally-open momentary push buttons, and jumper wires.
- A 32 GB microSD card (the tested capacity).
- USB-C cable for connecting the board to a computer during firmware upload.
- A USB power bank connected to the board's USB-C port for the tested field-power configuration.
- microSD card reader or adapter for importing a session from the card.
- A computer for setup and use.

### Software

- Git, or download the repository files.
- Visual Studio Code with the PlatformIO IDE extension for firmware build and upload. Firmware is the program installed on the capture device; PlatformIO is the tool used here to build and upload it.
- Node.js is required to run the MECT web application on your computer. Install a current Node.js LTS version from the official Node.js website. npm is installed automatically together with Node.js. The versions tested with MECT require Node.js 20.19 or newer.
- A desktop browser. For wireless transfer, use a Chromium-based browser that provides Web Bluetooth. Otherwise, use the microSD import option.

## 2. Download the Repository

A repository is the project folder containing its files. Cloning makes a local copy on your computer. Open PowerShell or another terminal in the folder where you want the project folder to be created, then run:

```powershell
git clone https://github.com/Pedro-Laranjeira/Multisensory-Experience-Capture-Tool.git
cd Multisensory-Experience-Capture-Tool
```

If you downloaded an archive instead, extract it and open a terminal in the extracted project folder. In the next steps, commands are run from the project root unless another folder is named.

## 3. Assemble the Capture Device

Complete the breadboard assembly before uploading firmware. Follow the [Hardware Assembly Guide](HARDWARE_ASSEMBLY.md), which shows the confirmed button wiring and tested power method.

## 4. Build and Upload the Firmware

1. Install Visual Studio Code. Open its Extensions view, search for **PlatformIO IDE**, and install the extension. PlatformIO manages the board-specific tools used to build and upload the firmware.
2. In VS Code, choose **File > Open Folder** and select this project's `firmware/` folder, not the repository root. Wait for PlatformIO to finish loading the project.
3. Connect the XIAO ESP32S3 Sense to the computer with the USB-C cable. The same port is used for firmware upload.
4. Select the `seeed_xiao_esp32s3` environment. The tested setup is PlatformIO Core 6.2.0, Espressif 32 platform 7.0.1, Arduino framework, `framework-arduinoespressif32` 3.20017.241212+sha.dcc1105b, and Xtensa ESP32-S3 toolchain 8.4.0+2021r2-patch5.
5. Choose **Build** in PlatformIO. Wait for the output to report `SUCCESS` before continuing.
6. Choose **Upload** and wait for the upload operation to report `SUCCESS`.
7. Open the PlatformIO serial monitor at **115200 baud**. A serial monitor displays messages sent by the board over USB.

For first setup, inspect the individual messages: confirm `SD_TEST_SUCCESS`, `Camera initialized.`, and `Buttons initialized.` Do not rely on `Device ready.` alone; that message can appear even if an earlier SD or camera check failed. Microphone setup occurs when audio recording is first started, not at boot; test audio as described below.

## 5. Start the Web Application

Node.js runs the web development tools; npm downloads and manages the web application's packages. Open a terminal at the project root, then enter the `web/` folder and install the packages:

```powershell
cd web
npm install
```

On Windows PowerShell, if `npm.ps1` is blocked by the execution policy, use `npm.cmd` instead:

```powershell
npm.cmd install
```

Keep the terminal in `web/` and start the app:

```powershell
npm run dev
```

Or, if needed in PowerShell:

```powershell
npm.cmd run dev
```

Vite starts a local development server, meaning the app is served from your computer for testing. In the terminal, find the `Local:` address it prints (often `http://localhost:5173/`) and open that address in your desktop browser. Leave the terminal running while using the app. To check a production build, still from `web/`, run `npm run build` or `npm.cmd run build`; the command should finish without TypeScript or build errors.

## 6. Prepare a Questionnaire

In the web app, open Researcher mode and download the bundled questionnaire or upload your own SurveyJS JSON. SurveyJS is the questionnaire format and editor used by MECT. The questionnaire must contain exactly one page named `__capture_template__` with at least one answerable question. When adapting the bundled questionnaire, preserve its `capture_info` element, which MECT uses as the mounting point for the captured media and associated capture information. The current validator does not enforce this element, but removing it prevents that information from being displayed at the intended location. For more detail, see [Questionnaire structure in the Usage Guide](USAGE_GUIDE.md#questionnaire-structure).

## 7. Run a Complete Test

Use the final questionnaire and test the whole path before involving participants:

1. With the assembled, powered device, press **Capture** once to take a photo.
2. Press **Audio** to start recording, then press **Audio** again to stop and save the WAV recording.
3. Press **End Capture** and wait for the save operation to finish.
4. Confirm that `session.json` and the media it references were written. For card import, power off the device before removing the card; use a card reader to inspect it. The device writes a startup SD test file as well.
5. In Participant mode, load the session using Web Bluetooth (Bluetooth Low Energy, or BLE, is short-range wireless transfer) or import `session.json` and all referenced media from the microSD card.
6. Complete a test reflection and download both the participant result JSON and media ZIP.
7. In Researcher mode, import the result JSON and check that the result is listed and can be inspected.

## 8. What Success Looks Like

- Firmware build and upload both report `SUCCESS`.
- Serial output confirms the SD write/read test, camera initialization, and button initialization; an audio test starts and stops successfully.
- The session contains `session.json` and the referenced JPEG and WAV files.
- The web app loads the session, displays its media during reflection, and downloads both participant files.
- Researcher mode imports and displays the result JSON.

## 9. Where to Go Next

- [Hardware Assembly](HARDWARE_ASSEMBLY.md) for the physical prototype.
- [Usage Guide](USAGE_GUIDE.md) for questionnaire setup, data collection, participant reflection, results, and troubleshooting.
- [Data Format](DATA_FORMAT.md) for manifest, result JSON, ZIP, and CSV details.
- [Firmware README](../firmware/README.md) for the firmware reference.
- [Web application README](../web/README.md) for web requirements and commands.
