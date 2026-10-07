# MECT — usage guide

## 1. Overview

The Multisensory Experience Capture Tool (MECT) lets participants capture meaningful moments in a public space without using a screen, using photos or audio as anchors for later reflection in a configurable questionnaire.

**Prepare questionnaire → capture photos and audio → end session → transfer media → complete reflections → download participant package → review results.**

MECT is a configurable research tool rather than a prescribed study method. Researchers remain responsible for defining the study protocol, participant instructions, questionnaire content, ethics procedures, and appropriate storage and management of collected research data.

For first-time setup, start with [Getting Started](GETTING_STARTED.md) and the [Hardware Assembly Guide](HARDWARE_ASSEMBLY.md). This guide focuses on preparing and operating a study.

## 2. Hardware

You need the capture device, its microSD card, a standard USB power bank connected to the board's USB-C port (the tested field-power method), and a computer running the web app. The device has a **Capture** button for photos, an **Audio** button to start or stop WAV recording, and an **End Capture** button to save the session record. An SD-card reader/adapter is needed for card import.

Before a participant starts, check power and card placement and run a short capture/transfer trial. Keep the original files until the participant package has been checked and backed up.

## 3. Preparing a study

### Open the web app

If the researcher has supplied a running app, open its address. To run it locally, install Node.js/npm, open a terminal in the repository's `web` directory, and run:

```powershell
npm.cmd install
npm.cmd run dev
```

Open the local address printed by Vite. Keep that terminal running. On the home page choose **Continue as researcher**.

Use the same browser profile and app address throughout the study: the configured questionnaire and participant counter are saved in that browser. Imported results have a shorter lifetime, described below.

### Configure the questionnaire

The questionnaire file is a **SurveyJS JSON definition** of pages, questions, and settings. It is separate from a participant's answers.

1. Choose **Download default questionnaire**. The file is `multisensory-experience-capture-tool-default-questionnaire.json`; downloading it does not change the active questionnaire.
2. Choose **Open SurveyJS Creator**, or use [the study's SurveyJS Creator link](https://surveyjs.io/create-free-survey).
3. Load/paste the downloaded definition into the Creator's JSON editor, then edit the questions. Save/export the questionnaire definition as a JSON file.
4. Under **Upload or replace questionnaire**, select that JSON file. A valid upload replaces the questionnaire used for new participant reflections. Check the current questionnaire name and structure shown on the page.
5. Test the questionnaire with a small session before collecting study data.

MECT validates uploaded SurveyJS questionnaires, and some advanced SurveyJS features are not supported by the current processing pipeline. If a questionnaire is rejected, use the validation details shown in the application to adjust it.

**Download current questionnaire** gives you the active version for further editing. **Reset to default** replaces the uploaded selection with the bundled questionnaire. Keep your edited JSON separately if you want to use it again.

### Questionnaire structure

| Section | Required? | Answered |
| --- | --- | --- |
| Participant/profile | Some: age range, gender, and relationship with the place are required in the bundled questionnaire | Once, before capture reflections |
| Capture reflections | At least one answerable question is required; `c_sentidos` is required in the bundled questionnaire | Once per captured moment |
| Overall experience | No | Once, after capture reflections |
| Final reflections | No | Once, after capture reflections |

Technical setup: the questionnaire must contain exactly one page named `__capture_template__` with at least one answerable question. The app repeats this page automatically; do not manually duplicate it for individual captures. Other ordinary questionnaire pages may appear before or after it. Every page needs a unique stable name, and answer-bearing questions need unique names across the questionnaire. The ordinary page names do not need to match the bundled names; their answers are included in the result under their page names.

When adapting the bundled questionnaire, preserve its `capture_info` element, which MECT uses as the mounting point for the captured media and associated capture information. The current validator does not enforce this element, but removing it prevents that information from being displayed at the intended location.

In the bundled questionnaire, the other profile questions are optional, as are the overall and final-reflection questions. You can add ordinary pages and arrange them before or after the capture template; their answers are exported as generic sections. Test the exported result after editing the questionnaire.

### Before collecting study data

Run one complete test using the final questionnaire:

1. Capture at least one photograph and one audio recording.
2. Press **End Capture**.
3. Confirm that `session.json` and its referenced media were written.
4. Import or transfer the session into the web application.
5. Complete a test reflection.
6. Download both the result JSON and media ZIP.
7. Import the result JSON in Researcher mode and verify the output.

## 4. Participant capture session

1. Insert the microSD card and power the device. Wait for it to be ready before starting.
2. Point at a meaningful moment and press **Capture**. Hold the scene briefly while the photo is acquired; avoid rapid presses.
3. To record audio, press **Audio** once to start and again to stop and save a WAV recording. **End Capture** also finalizes an active audio recording. Repeat either capture action as needed during the experience.
4. Press **End Capture** and let the device finish saving before transferring or removing power.

End Capture writes `session.json`, which lists the session's photos and audio recordings. Download and retain each participant's package before starting another participant. Start a new device session by restarting the device; do not assume End Capture resets the session. A later session can replace the card's `session.json`.

## 5. Transfer options

On the home page choose **Continue as participant**.

### A. Wireless / Bluetooth

Choose **Connect wirelessly** and select `MECT-Capture` in the browser's device chooser. Use a browser that supports Web Bluetooth. Keep the capture device powered and nearby throughout transfer.

Transfer may take a little while, particularly with several captures, larger photos, or audio recordings. Wait for the session-ready screen before beginning reflections.

### B. Import from SD card

After End Capture finishes saving, power off the device and remove the microSD card. Connect the **card** to the computer with a card reader/adapter.

Choose **Import from SD card**. Select `session.json` **and all the media files it references together**. The current importer accepts JPEG photos (`.jpg` / `.jpeg`) and WAV audio (`.wav`). Selecting only the session file is not enough. Do not rename source files before import. Extra media from older sessions is not needed.

This workflow reads the card; it does not require connecting the capture device itself by USB.

## 6. Participant questionnaire

When the session is ready, choose **Begin reflection**. In the bundled questionnaire, age range, gender, and relationship with the place are required profile questions; the other profile questions are optional. Reflect on each photo or audio recording and answer any overall/final questions as configured by the researcher.

After completing the questionnaire, wait for package preparation. Choose **Download participant package** to initiate two separate downloads. If the browser asks to allow multiple downloads, allow them and confirm both files were saved.

If preparation fails, keep the page open and choose **Retry preparation**. Completed answers remain available on that page. Retrying the download uses the same prepared files and participant ID. Do not refresh or leave before both files are saved.

## 7. Output files

For participant `P001`:

- **`P001_result.json`** — structured answers, participant ID, session/capture metadata, and media references (schema 2.0).
- **`P001_captures.zip`** — that participant's photos and audio recordings, named in capture order, for example `P001_capture_01.jpg` and `P001_capture_02.wav`.

The JSON is a separate file; it is not inside the ZIP. For each capture, `sourceFile` preserves the original name (such as `IMG_0140.JPG` or `AUD_0001.WAV`) and `exportFile` names the matching ZIP entry (such as `P001_capture_01.jpg` or `P001_capture_02.wav`). Renaming happens only in the export package.

As an optional organizational convention, researchers can store each participant's files in a separate folder and keep the study questionnaire separately:

```text
study-data/
├── P001/
│   ├── P001_result.json
│   └── P001_captures.zip
├── P002/
│   ├── P002_result.json
│   └── P002_captures.zip
└── questionnaire/study-questionnaire.json
```

This is a suggested organization, not a requirement imposed by MECT.

IDs advance from `P001` to `P002`, etc., after both files are prepared. Re-downloading does not consume another ID, and researcher imports do not change the counter. Clearing browser storage or switching browser profiles/app addresses can restart numbering. Keep using the study's established browser profile and address.

If multiple computers or browser profiles are used for the same study, their participant counters are independent and may generate duplicate participant IDs. Use one reflection setup where possible, or maintain an additional site/device identifier in the study records.

## 8. Researcher results

Return to the researcher page and import the **result JSON files**, not the ZIPs or `session.json`.

- Review the automatic summary.
- Find a participant ID and choose **Inspect result** for individual answers and capture references.
- Choose **Export CSV** for a table with one row per capture, including participant ID and exported filename. The download is named `multisensory-experience-capture-tool-results-YYYY-MM-DD.csv` using the current date.
- **Clear imported results** clears the page's working collection, not downloaded source files.

Keep the JSON and ZIP packages as the complete research records; CSV is an additional analysis format.

## 9. Current scope and limitations

- The device and current transfer workflows support **JPEG photos and WAV audio**. GPS is not implemented; imported captures have no GPS coordinates.
- There is no cloud/backend storage for participant results.
- Results imported into the researcher page live **only in browser memory**. Leaving or refreshing that page clears them; re-import the source JSON files when needed.
- Participant answers and prepared downloads also need the current page to stay open until saved.
- Source JSON/ZIP files are the durable records. Back them up using the study's storage procedure.
- The current researcher interface accepts result files using schema **2.0**.

## 10. Troubleshooting

| Problem | What to do |
| --- | --- |
| BLE device not found | Check that the device is powered, nearby, and ready for transfer after End Capture. Check browser Bluetooth support and computer Bluetooth availability; close another connection to the device, then retry. |
| Wireless transfer takes time | Keep the device powered and nearby. Larger sessions take longer; wait for progress to finish. If an error appears, retry or import from SD card. |
| SD import reports a missing file | Select `session.json` and every referenced JPEG and WAV file together. Check the original filenames; a renamed copy such as `IMG_0140 (1).JPG` is not the same source file. |
| Questionnaire lacks a capture section | Restore the page named `__capture_template__`, or begin with the downloaded default. It must contain an answerable question and appear exactly once. Other pages need unique names and may appear before or after it. |
| Only one package file downloads | Allow multiple/automatic downloads for the app in the browser, then choose **Download participant package** again. Check that both JSON and ZIP are present; retry can create duplicate downloads. |
| Package preparation fails | Keep the completed questionnaire page open, use **Retry preparation**, and share the displayed researcher details with the researcher if it fails again. |
| Device does not create captures | Check power, microSD availability, startup messages, and button operation. Run a short photo and audio test before field use. |
| `session.json` is missing | Ensure **End Capture** was pressed and the device finished writing before power was removed or the microSD card was disconnected. |
| Wrong questionnaire is active | Return to Researcher mode and upload the intended questionnaire, or reset to the bundled default and re-upload the study questionnaire. |
| Result JSON cannot be imported | Confirm it is a MECT result using the currently supported schema version (2.0) and that it has not been manually altered. |
