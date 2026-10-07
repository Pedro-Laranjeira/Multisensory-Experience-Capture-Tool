#pragma once

#include <Arduino.h>

void initializeSession();
unsigned long getSessionElapsedMs();
bool addPhotoCapture(const char *filename, unsigned long timestampMs);
bool addAudioCapture(const char *filename, unsigned long timestampMs);
bool saveSessionManifest();
void printSessionSaved();
const String &getSessionManifestJson();
