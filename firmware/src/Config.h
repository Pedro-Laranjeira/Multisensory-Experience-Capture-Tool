#pragma once

#include <Arduino.h>

// Button configuration.
constexpr uint8_t CAPTURE_BUTTON_PIN = D0;
constexpr uint8_t END_CAPTURE_BUTTON_PIN = D1;
constexpr uint8_t AUDIO_BUTTON_PIN = D2;
constexpr unsigned long DEBOUNCE_DELAY_MS = 50;

// Built-in Sense microphone (PDM).
constexpr int8_t MICROPHONE_CLOCK_PIN = 42;
constexpr int8_t MICROPHONE_DATA_PIN = 41;

// Official CAMERA_MODEL_XIAO_ESP32S3 pin configuration.
constexpr int8_t CAMERA_PWDN_PIN = -1;
constexpr int8_t CAMERA_RESET_PIN = -1;
constexpr int8_t CAMERA_XCLK_PIN = 10;
constexpr int8_t CAMERA_SIOD_PIN = 40;
constexpr int8_t CAMERA_SIOC_PIN = 39;
constexpr int8_t CAMERA_Y9_PIN = 48;
constexpr int8_t CAMERA_Y8_PIN = 11;
constexpr int8_t CAMERA_Y7_PIN = 12;
constexpr int8_t CAMERA_Y6_PIN = 14;
constexpr int8_t CAMERA_Y5_PIN = 16;
constexpr int8_t CAMERA_Y4_PIN = 18;
constexpr int8_t CAMERA_Y3_PIN = 17;
constexpr int8_t CAMERA_Y2_PIN = 15;
constexpr int8_t CAMERA_VSYNC_PIN = 38;
constexpr int8_t CAMERA_HREF_PIN = 47;
constexpr int8_t CAMERA_PCLK_PIN = 13;

// XIAO ESP32S3 Sense onboard microSD chip-select pin.
constexpr uint8_t SD_CS_PIN = 21;

constexpr uint8_t MAX_SESSION_CAPTURES = 50;

// Stable BLE identifiers for the capture device session and media transfer service.
constexpr char CAPTURE_BLE_SERVICE_UUID[] = "7f2d0001-6f2d-4c32-9a11-2c2c00000001";
constexpr char CAPTURE_BLE_MANIFEST_UUID[] = "7f2d0002-6f2d-4c32-9a11-2c2c00000001";
constexpr char CAPTURE_BLE_IMAGE_REQUEST_UUID[] = "7f2d0003-6f2d-4c32-9a11-2c2c00000001";
constexpr char CAPTURE_BLE_IMAGE_INFO_UUID[] = "7f2d0004-6f2d-4c32-9a11-2c2c00000001";
constexpr char CAPTURE_BLE_IMAGE_DATA_UUID[] = "7f2d0005-6f2d-4c32-9a11-2c2c00000001";
constexpr size_t BLE_MANIFEST_CHUNK_SIZE = 180;
constexpr size_t BLE_IMAGE_CHUNK_SIZE = 180;
constexpr size_t IMAGE_REQUEST_BUFFER_SIZE = 20;
