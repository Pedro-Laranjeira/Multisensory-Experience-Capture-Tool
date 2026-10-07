#include <Arduino.h>

#include "AudioCaptureManager.h"
#include "BleManager.h"
#include "ButtonManager.h"
#include "CaptureManager.h"
#include "SessionManager.h"

namespace {

void finalizeAudioCapture() {
  AudioCaptureResult result = {};
  if (stopAudioRecording(result)) {
    if (!addAudioCapture(result.filename, result.timestampMs)) {
      Serial.printf("AUDIO_REGISTRATION_FAILED: file=%s\n", result.filename);
    }
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);

  Serial.println();
  Serial.println("Capture device firmware starting...");

  initializeSession();
  initializeBLE();

  const bool sdReady = initializeSDCard();
  if (sdReady) {
    const bool testPassed = testSDWriteAndRead();
    if (testPassed) {
      Serial.println("SD_TEST_SUCCESS");
    } else {
      Serial.println("SD_TEST_FAILED");
    }
  } else {
    Serial.println("SD_INITIALIZATION_FAILED");
  }

  const bool cameraReady = initializeCamera();
  if (!cameraReady) {
    Serial.println("CAMERA_INITIALIZATION_FAILED");
  }

  initializeAudioCapture(sdReady);
  initializeButtons();
  Serial.println("Device ready.");
}

void loop() {
  processPendingImageRequest();

  if (captureButtonPressed()) {
    if (isAudioRecording()) {
      Serial.println("PHOTO_IGNORED: audio recording is active");
    } else {
      const unsigned long captureStartedAt = millis();
      Serial.printf("CAPTURE_START: ms=%lu\n", captureStartedAt);
      const PhotoCaptureResult result = capturePhoto();
      if (result.success) {
        if (!addPhotoCapture(result.filename, getSessionElapsedMs())) {
          Serial.printf("PHOTO_REGISTRATION_FAILED: file=%s\n", result.filename);
        }
      }
      Serial.printf("CAPTURE_END: success=%u duration_ms=%lu\n",
                    result.success, millis() - captureStartedAt);
    }
  }

  if (endCaptureButtonPressed()) {
    if (isAudioRecording()) finalizeAudioCapture();
    if (saveSessionManifest()) {
      updateBLEManifest(getSessionManifestJson());
      printSessionSaved();
    }
    // End Capture wins over audio toggle events already queued during finalization.
    while (audioButtonPressed()) {
      Serial.println("AUDIO_BUTTON_IGNORED: End Capture took priority");
    }
  }

  if (audioButtonPressed()) {
    Serial.printf("AUDIO_BUTTON_SERVICED: state=%s\n", audioRecordingState());
    if (isAudioRecording()) finalizeAudioCapture();
    else startAudioRecording(getSessionElapsedMs());
  }

  processAudioRecording();
}
