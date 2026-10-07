#pragma once

#include <Arduino.h>

struct PhotoCaptureResult {
  bool success;
  char filename[20];
  size_t size;
};

bool initializeSDCard();
bool testSDWriteAndRead();
bool initializeCamera();
PhotoCaptureResult capturePhoto();
