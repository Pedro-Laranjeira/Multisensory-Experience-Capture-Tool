# Multisensory Experience Capture Tool (MECT)

The Multisensory Experience Capture Tool (MECT) is a research system for participant-led capture of meaningful moments in public, urban, and nature spaces, using photographs or environmental audio as prompts for post-experience reflection. Capture and reflection are deliberately separated so that participants can stay focused on their surroundings during the situated experience and interpret selected moments afterward.

> **New to MECT? Start with the [Getting Started guide](docs/GETTING_STARTED.md).** It leads from device assembly through a complete system test.

## Overview

Participants use a screenless physical device to initiate JPEG photographs or WAV environmental audio recordings. After the experience, they load the session into the web application and revisit its media while completing a digital reflection questionnaire.

Researchers configure questionnaires as SurveyJS JSON. MECT repeats a capture-reflection template for each captured moment and combines participant responses with capture metadata in structured result files.

## Documentation

- [Getting Started](docs/GETTING_STARTED.md) — installation, assembly, first firmware upload, and complete test.
- [Hardware Assembly](docs/HARDWARE_ASSEMBLY.md) — breadboard prototype and confirmed wiring.
- [Usage Guide](docs/USAGE_GUIDE.md) — questionnaire setup and researcher/participant workflow.
- [Data Format](docs/DATA_FORMAT.md) — session manifest, result JSON, media ZIP, and CSV.
- [Firmware README](firmware/README.md) — firmware build, controls, and startup reference.
- [Web application README](web/README.md) — web requirements and commands.

## Workflow

1. Configure the questionnaire.
2. Prepare the capture device and microSD card.
3. Run the situated capture experience, recording selected moments.
4. Load the session over Web Bluetooth or from the microSD card.
5. Complete the participant reflection in the web application.
6. Review participant results and export a combined CSV.

## System Components

- **Screenless capture device:** Firmware for the Seeed Studio XIAO ESP32S3 Sense uses physical controls to capture photos, record audio, and end a session.
- **Web application:** A React and TypeScript application for researcher setup, session transfer or import, participant reflection, and researcher results review.
- **SurveyJS questionnaire:** A researcher-configurable JSON questionnaire. One page named `__capture_template__` is repeated for each capture; ordinary questionnaire pages hold other study questions.
- **Study outputs:** A structured result JSON connects responses with session and capture metadata. A ZIP contains the corresponding captured media.

## Repository Structure

```text
firmware/   ESP32-S3 firmware and PlatformIO configuration
web/        React/TypeScript application and tests
docs/       Researcher usage guide and supporting documentation
```

## Using MECT

### Configure a questionnaire

Create or edit a SurveyJS questionnaire and upload its JSON in Researcher mode. The questionnaire must contain exactly one page named `__capture_template__` with at least one answerable question. When adapting the bundled questionnaire, preserve its `capture_info` element, which MECT uses as the mounting point for the captured media and associated capture information. The current validator does not enforce this element, but removing it prevents that information from being displayed at the intended location.
MECT creates one reflection page for each capture.

### Capture a session

Use the physical controls to capture a photo, start or stop audio recording, and press **End Capture** when the session is complete. The device writes a session manifest and media to its microSD card.

### Import and reflect

Load a session wirelessly over Web Bluetooth or import `session.json` and its referenced JPEG and WAV files from the microSD card. The captured media are presented as prompts in the participant reflection questionnaire.

### Review results

Import participant result JSON files in Researcher mode to inspect individual responses and summaries. Export the imported results as a combined CSV, with one row per capture.

## Outputs

Each completed participant reflection produces two files:

- `P###_result.json` contains structured responses and session/capture metadata (schema 2.0).
- `P###_captures.zip` contains the participant's captured media, named in capture order, for example `P001_capture_01.jpg` and `P001_capture_02.wav`.

The JSON and ZIP are separate downloads. Retain both together as the participant's complete exported record; CSV is an additional analysis format.

## Current Scope and Limitations

MECT currently supports JPEG photo and WAV audio capture. It does not capture video or provide GPS/location coordinates. Questionnaire configuration and participant numbering are stored in the browser. There is no cloud/backend storage, and researcher result inspection is temporary and held in browser memory. Researchers are responsible for retaining and securely storing exported files.

## Research Context

MECT was developed as part of a Master's thesis at Instituto Superior Técnico:

*"Capturing Multisensory Public-Space Experience: Design, Implementation, and Evaluation of a Participant-Led Capture-and-Reflection Approach"*

## Citation

Formal citation information will be added with the thesis release.
