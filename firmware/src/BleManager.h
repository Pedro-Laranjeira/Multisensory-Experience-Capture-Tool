#pragma once

#include <Arduino.h>

void initializeBLE();
void updateBLEManifest(const String &manifestJson);
void processPendingImageRequest();
