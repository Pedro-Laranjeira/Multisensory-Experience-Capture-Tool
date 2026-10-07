#include "SessionManager.h"

#include <Arduino.h>
#include <SD.h>

#include "Config.h"

namespace {

enum class MediaType { Photo, Audio };

struct CaptureRecord {
  uint16_t id;
  MediaType mediaType;
  char filename[20];
  unsigned long timestampMs;
};

CaptureRecord sessionCaptures[MAX_SESSION_CAPTURES];
uint8_t sessionCaptureCount = 0;
char sessionId[32];
unsigned long sessionStartedAtMs = 0;
String sessionManifestJson;

}  // namespace

void initializeSession() {
  sessionStartedAtMs = millis();
  snprintf(sessionId, sizeof(sessionId), "session_%lu", sessionStartedAtMs);
  Serial.print("SESSION_ID: ");
  Serial.println(sessionId);
}

unsigned long getSessionElapsedMs() {
  return millis() - sessionStartedAtMs;
}

namespace {

bool addCapture(MediaType mediaType, const char *filename, unsigned long timestampMs) {
  if (sessionCaptureCount >= MAX_SESSION_CAPTURES) {
    Serial.printf("WARNING: Capture limit reached; %s not added to manifest.\n",
                  mediaType == MediaType::Photo ? "photo" : "audio");
    return false;
  }

  CaptureRecord &record = sessionCaptures[sessionCaptureCount];
  record.id = sessionCaptureCount + 1;
  record.mediaType = mediaType;
  snprintf(record.filename, sizeof(record.filename), "%s", filename);
  record.timestampMs = timestampMs;
  ++sessionCaptureCount;
  if (mediaType == MediaType::Photo) {
    Serial.printf("PHOTO_REGISTERED: session=%s file=%s count=%u\n",
                  sessionId, record.filename, sessionCaptureCount);
  } else {
    Serial.printf("AUDIO_SESSION_CAPTURE_ADDED: id=%u file=/%s timestamp_ms=%lu\n",
                  record.id, record.filename, record.timestampMs);
  }
  return true;
}

}  // namespace

bool addPhotoCapture(const char *filename, unsigned long timestampMs) {
  return addCapture(MediaType::Photo, filename, timestampMs);
}

bool addAudioCapture(const char *filename, unsigned long timestampMs) {
  return addCapture(MediaType::Audio, filename, timestampMs);
}

bool saveSessionManifest() {
  const char *manifestPath = "/session.json";
  const unsigned long finishedAtMs = millis();
  Serial.printf("SESSION_SAVE_START: session=%s count=%u\n",
                sessionId, sessionCaptureCount);

  // Build the same human-readable JSON structure used before the refactor.
  sessionManifestJson = "{\n";
  sessionManifestJson += "  \"sessionId\": \"";
  sessionManifestJson += sessionId;
  sessionManifestJson += "\",\n  \"startedAtMs\": ";
  sessionManifestJson += String(sessionStartedAtMs);
  sessionManifestJson += ",\n  \"finishedAtMs\": ";
  sessionManifestJson += String(finishedAtMs);
  sessionManifestJson += ",\n  \"captures\": [\n";

  for (uint8_t index = 0; index < sessionCaptureCount; ++index) {
    const CaptureRecord &record = sessionCaptures[index];
    sessionManifestJson += "    {\"id\": \"";
    sessionManifestJson += String(record.id);
    sessionManifestJson += "\", \"mediaType\": \"";
    sessionManifestJson += record.mediaType == MediaType::Photo ? "photo" : "audio";
    sessionManifestJson += "\", \"file\": \"";
    sessionManifestJson += record.filename;
    sessionManifestJson += "\", \"timestampMs\": ";
    sessionManifestJson += String(record.timestampMs);
    sessionManifestJson += "}";

    if (index + 1 < sessionCaptureCount) {
      sessionManifestJson += ",";
    }
    sessionManifestJson += "\n";
  }

  sessionManifestJson += "  ]\n}\n";

  if (SD.exists(manifestPath) && !SD.remove(manifestPath)) {
    Serial.println("SESSION_FAILED: Could not replace /session.json.");
    return false;
  }

  File manifest = SD.open(manifestPath, FILE_WRITE);
  if (!manifest) {
    Serial.println("SESSION_FAILED: Could not open /session.json.");
    return false;
  }

  manifest.print(sessionManifestJson);
  manifest.close();
  return true;
}

void printSessionSaved() {
  Serial.printf(
      "SESSION_SAVED: /session.json (%u captures)\n",
      sessionCaptureCount
  );
}

const String &getSessionManifestJson() {
  return sessionManifestJson;
}
