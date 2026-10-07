#pragma once

// Uses the SD mount established by setup; never initializes SD or the camera.
void initializeAudioCapture(bool sdReady);
bool isAudioRecording();
const char *audioRecordingState();
struct AudioCaptureResult {
  char filename[20];
  unsigned long timestampMs;
};

// Session-relative time when loop() services the start request, before setup.
bool startAudioRecording(unsigned long timestampMs);
// Populates result only after the WAV is closed, validated and published.
bool stopAudioRecording(AudioCaptureResult &result);
void processAudioRecording();
