# MECT Data Format

The Multisensory Experience Capture Tool (MECT) produces a device session manifest (`session.json`), a participant result JSON file, a participant media ZIP, and an optional combined CSV export for analysis. The JSON result is the structured record connecting questionnaire responses with captures and session metadata.

## 1. Device Session Manifest

The firmware writes `session.json` to the microSD card when the session ends. It contains:

| Field | Meaning |
| --- | --- |
| `sessionId` | Identifier for the device session. |
| `startedAtMs` | Value from the device's `millis()` counter when the session started. |
| `finishedAtMs` | Value from the device's `millis()` counter when the session ended. |
| `captures` | Ordered list of registered captures. |

`startedAtMs` and `finishedAtMs` are device-uptime-relative values, not wall-clock, UTC, or calendar timestamps.

Each capture has an `id`, a `mediaType`, a `file` filename, and `timestampMs`, the capture time in milliseconds elapsed since the session started. Current media type values are `photo` and `audio`. The filename refers to a media file stored on the microSD card, such as a JPEG photo or WAV audio recording. The manifest does not contain latitude or longitude fields.

## 2. Participant Result JSON

Participant results use schema version `2.0`. The top-level `StudyResult` contains:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Currently `2.0`. |
| `participantId` | Participant identifier, such as `P001`. |
| `resultId` | Unique result identifier generated for this result. |
| `sessionId` | Identifier of the device session associated with the result. |
| `completedAt` | Result completion date and time in ISO format. |
| `questionnaire` | Optional questionnaire metadata: `name` and `uploadedAt`. |
| `sections` | Ordered generic questionnaire sections for ordinary pages. |
| `captures` | Captures and their reflection responses. |

There is no separate top-level participant, overall-experience, or final-reflections field. Ordinary questionnaire pages are represented in `sections[]`; each section has its page `name`, an optional `title`, and a `responses` object keyed by question names. For example, the bundled pages `participant_information`, `overall_experience`, and `final_reflections` use this same generic structure. Custom ordinary page names are preserved as section names.

Each entry in `captures[]` contains:

| Field | Meaning |
| --- | --- |
| `id` | Capture identifier from the session. |
| `mediaType` | Current capture value: `photo` or `audio`. |
| `sourceFile` | Original device filename from the session. |
| `exportFile` | Renamed media filename inside the participant ZIP. |
| `timestamp` | Capture time formatted as `HH:MM:SS` elapsed from session start. |
| `latitude`, `longitude` | Numeric coordinates or `null`; current capture workflows do not provide GPS coordinates. |
| `reflection` | Answers to the repeated capture-reflection questionnaire page, keyed by question name. |

`sourceFile` preserves the source filename, such as `IMG_0001.JPG` or `AUD_0001.WAV`. `exportFile` identifies its renamed entry in the participant's media ZIP, such as `P001_capture_01.jpg` or `P001_capture_02.wav`.

**JSON Example**

```json
{
  "schemaVersion": "2.0",
  "participantId": "P001",
  "resultId": "4e4b15b1-a588-45d8-8b1b-4f0de5308792",
  "sessionId": "session_42819",
  "completedAt": "2026-10-05T12:00:00.000Z",
  "sections": [],
  "captures": [
    {
      "id": 1,
      "mediaType": "photo",
      "sourceFile": "IMG_0018.JPG",
      "exportFile": "P001_capture_01.jpg",
      "timestamp": "00:00:59",
      "latitude": null,
      "longitude": null,
      "reflection": {
        "sensory_modalities": ["hearing", "thermal"]
      }
    }
  ]
}
```

## 3. Participant Media ZIP

The ZIP is named `P###_captures.zip`, for example `P001_captures.zip`. It contains the participant's captured media, renamed in capture order using the pattern `P###_capture_##.<extension>`. Examples include `P001_capture_01.jpg` and `P001_capture_02.wav`. The result JSON is a separate file and is not stored inside the ZIP.

## 4. Researcher CSV Export

The researcher export contains one row per capture. Participant-level result fields and ordinary questionnaire section responses are repeated across that participant's capture rows. Capture metadata and that capture's reflection responses occupy capture-specific columns.

The CSV uses a semicolon (`;`) delimiter, UTF-8 encoding with a byte-order mark (BOM), and CRLF line endings. Cells containing quotes, delimiters, or line breaks are quoted and embedded quotes are doubled. Nested object values are flattened into dot-separated column paths; literal dots and backslashes in keys are escaped. Recognized choice-question arrays are joined using semicolons; other array values are represented as JSON text.

The download name is `multisensory-experience-capture-tool-results-YYYY-MM-DD.csv`, using the current UTC date.

## 5. Identifiers and Relationships

`participantId` is the browser-assigned identifier used to associate a result with its corresponding media ZIP. `sessionId` connects the result to the source device session. `resultId` identifies one completed result. A capture's `id` links it to its session-manifest entry; `exportFile` identifies the corresponding renamed media entry in the ZIP. The result's `sourceFile` retains the device filename that was recorded in the manifest.

## 6. Persistence and Storage

The participant result JSON and media ZIP together form the complete exported participant record. Researcher-mode result imports are temporary and remain in browser memory; they are cleared when the page is left or refreshed. CSV is an additional analysis format, not a replacement for the JSON and ZIP. Researchers should store exported files according to their study procedures.

## 7. Version Compatibility

The current researcher interface accepts result files using schema version `2.0`.
