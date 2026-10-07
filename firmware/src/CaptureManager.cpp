#include "CaptureManager.h"

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include <esp_camera.h>
#include <esp_timer.h>

#include "Config.h"

namespace {

camera_fb_t *acquireFreshFrame(int64_t requestedAtUs) {
  // LATEST may still return a completed or in-flight frame from before the
  // button press. Reject those by DMA start time, not a fixed warm-up discard.
  // Two buffers can contain pre-request frames; bound retries on driver faults.
  constexpr uint8_t maxFrameAttempts = 4;
  for (uint8_t attempt = 0; attempt < maxFrameAttempts; ++attempt) {
    camera_fb_t *frame = esp_camera_fb_get();
    if (frame == nullptr) {
      Serial.println("PHOTO_FAILED: Camera capture failed.");
      return nullptr;
    }

    const int64_t frameStartedAtUs =
        static_cast<int64_t>(frame->timestamp.tv_sec) * 1000000LL +
        frame->timestamp.tv_usec;
    if (frameStartedAtUs >= requestedAtUs) {
      Serial.printf("CAPTURE_FRAME_ACQUIRED: request_us=%lld frame_us=%lld length=%u\n",
                    requestedAtUs, frameStartedAtUs,
                    static_cast<unsigned int>(frame->len));
      return frame;
    }

    esp_camera_fb_return(frame);
    Serial.println("CAPTURE_FRAME_RETURNED: stale frame skipped");
  }

  Serial.println("PHOTO_FAILED: No fresh camera frame available.");
  return nullptr;
}

bool isJpegFrame(const camera_fb_t *frame) {
  return frame->format == PIXFORMAT_JPEG && frame->buf != nullptr &&
      frame->len >= 4 && frame->buf[0] == 0xFF && frame->buf[1] == 0xD8 &&
      frame->buf[frame->len - 2] == 0xFF && frame->buf[frame->len - 1] == 0xD9;
}

}  // namespace

bool initializeSDCard() {
  Serial.println("Initializing microSD card...");

  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("ERROR: microSD card mount failed.");
    return false;
  }

  const uint8_t cardType = SD.cardType();

  if (cardType == CARD_NONE) {
    Serial.println("ERROR: No microSD card detected.");
    return false;
  }

  Serial.print("microSD card type: ");
  if (cardType == CARD_MMC) {
    Serial.println("MMC");
  } else if (cardType == CARD_SD) {
    Serial.println("SDSC");
  } else if (cardType == CARD_SDHC) {
    Serial.println("SDHC");
  } else {
    Serial.println("UNKNOWN");
  }

  const uint64_t cardSizeMB = SD.cardSize() / (1024 * 1024);
  Serial.print("microSD card size: ");
  Serial.print(cardSizeMB);
  Serial.println(" MB");
  return true;
}

bool testSDWriteAndRead() {
  const char *testFilePath = "/capture_test.txt";

  Serial.println("Writing test file...");
  File file = SD.open(testFilePath, FILE_WRITE);

  if (!file) {
    Serial.println("ERROR: Could not open test file for writing.");
    return false;
  }

  file.println("CAPTURE TOOL SD CARD TEST");
  file.println("The microSD card is working.");
  file.close();
  Serial.println("Test file written.");

  Serial.println("Reading test file...");
  file = SD.open(testFilePath);

  if (!file) {
    Serial.println("ERROR: Could not open test file for reading.");
    return false;
  }

  Serial.println("--- FILE CONTENT ---");
  while (file.available()) {
    Serial.write(file.read());
  }
  Serial.println("--- END FILE ---");
  file.close();
  return true;
}

bool initializeCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = CAMERA_Y2_PIN;
  config.pin_d1 = CAMERA_Y3_PIN;
  config.pin_d2 = CAMERA_Y4_PIN;
  config.pin_d3 = CAMERA_Y5_PIN;
  config.pin_d4 = CAMERA_Y6_PIN;
  config.pin_d5 = CAMERA_Y7_PIN;
  config.pin_d6 = CAMERA_Y8_PIN;
  config.pin_d7 = CAMERA_Y9_PIN;
  config.pin_xclk = CAMERA_XCLK_PIN;
  config.pin_pclk = CAMERA_PCLK_PIN;
  config.pin_vsync = CAMERA_VSYNC_PIN;
  config.pin_href = CAMERA_HREF_PIN;
  config.pin_sccb_sda = CAMERA_SIOD_PIN;
  config.pin_sccb_scl = CAMERA_SIOC_PIN;
  config.pin_pwdn = CAMERA_PWDN_PIN;
  config.pin_reset = CAMERA_RESET_PIN;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_UXGA;
  config.jpeg_quality = 10;
  // LATEST needs more than one buffer to refresh the queue while idle.
  config.fb_count = 2;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;

  Serial.println("Initializing camera...");
  const esp_err_t result = esp_camera_init(&config);

  if (result != ESP_OK) {
    Serial.printf("ERROR: Camera initialization failed (0x%x).\n", result);
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_vflip(sensor, 1);
  }

  // Initialization-only warm-up for the initial green frame; never retain it.
  camera_fb_t *warmupFrame = esp_camera_fb_get();
  if (warmupFrame != nullptr) {
    esp_camera_fb_return(warmupFrame);
  } else {
    Serial.println("ERROR: Camera warm-up failed.");
    esp_camera_deinit();
    return false;
  }

  Serial.println("Camera initialized.");
  return true;
}

PhotoCaptureResult capturePhoto() {
  const int64_t requestedAtUs = esp_timer_get_time();
  static uint16_t nextImageNumber = 1;
  PhotoCaptureResult result = {false, "", 0};
  char imagePath[20];

  // Acquire the scene before potentially slow filename scanning on the SD card.
  camera_fb_t *frameBuffer = acquireFreshFrame(requestedAtUs);
  if (frameBuffer == nullptr) {
    return result;
  }

  while (nextImageNumber <= 9999) {
    snprintf(imagePath, sizeof(imagePath), "/IMG_%04u.JPG", nextImageNumber);
    if (!SD.exists(imagePath)) {
      break;
    }
    ++nextImageNumber;
  }

  if (nextImageNumber > 9999) {
    Serial.println("PHOTO_FAILED: No available image filename.");
    esp_camera_fb_return(frameBuffer);
    Serial.println("CAPTURE_FRAME_RETURNED: no filename available");
    return result;
  }

  if (!isJpegFrame(frameBuffer)) {
    Serial.println("PHOTO_FAILED: Invalid JPEG framebuffer.");
    esp_camera_fb_return(frameBuffer);
    Serial.println("CAPTURE_FRAME_RETURNED: invalid JPEG");
    return result;
  }

  Serial.printf("CAPTURE_FILE: %s\n", imagePath + 1);
  File imageFile = SD.open(imagePath, FILE_WRITE);
  bool saved = false;
  if (!imageFile) {
    Serial.printf("PHOTO_FAILED: Could not open %s.\n", imagePath);
  } else {
    const size_t bytesWritten = imageFile.write(
        frameBuffer->buf,
        frameBuffer->len
    );
    imageFile.close();
    saved = bytesWritten == frameBuffer->len;

    if (saved) {
      Serial.printf("PHOTO_SAVED: %s (%u bytes)\n", imagePath, frameBuffer->len);
    } else {
      Serial.printf("PHOTO_FAILED: Incomplete write for %s.\n", imagePath);
    }
  }

  result.size = frameBuffer->len;
  esp_camera_fb_return(frameBuffer);
  Serial.println("CAPTURE_FRAME_RETURNED");

  if (saved) {
    snprintf(result.filename, sizeof(result.filename), "%s", imagePath + 1);
    result.success = true;
    ++nextImageNumber;
  }

  return result;
}
