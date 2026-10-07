#include "ButtonManager.h"

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include "Config.h"

namespace {

struct DebouncedButton {
  uint8_t pin;
  const char *pressedMessage;
  int lastRawState;
  int stableState;
  unsigned long lastChangeTime;
  QueueHandle_t presses = nullptr;

  DebouncedButton(uint8_t buttonPin, const char *message)
      : pin(buttonPin),
        pressedMessage(message),
        lastRawState(HIGH),
        stableState(HIGH),
        lastChangeTime(0) {}
};

DebouncedButton captureButton(
    CAPTURE_BUTTON_PIN,
    "CAPTURE_BUTTON_PRESSED"
);
DebouncedButton endCaptureButton(
    END_CAPTURE_BUTTON_PIN,
    "END_CAPTURE_BUTTON_PRESSED"
);
// D2 reports only from loop(), after its queued event is consumed.
DebouncedButton audioButton(AUDIO_BUTTON_PIN, nullptr);

bool updateButton(DebouncedButton &button) {
  const int rawState = digitalRead(button.pin);
  const unsigned long now = millis();
  bool pressed = false;

  if (rawState != button.lastRawState) {
    if (button.pressedMessage != nullptr && rawState == HIGH && button.stableState == HIGH &&
        button.lastRawState == LOW) {
      Serial.printf("BUTTON_IGNORED: pin=%u reason=debounce duration_ms=%lu\n",
                    button.pin, now - button.lastChangeTime);
    }
    button.lastRawState = rawState;
    button.lastChangeTime = now;
  }

  if (rawState != button.stableState &&
      now - button.lastChangeTime >= DEBOUNCE_DELAY_MS) {
    button.stableState = rawState;

    if (button.stableState == LOW) {
      if (button.pressedMessage != nullptr) Serial.println(button.pressedMessage);
      pressed = true;
    }
  }

  return pressed;
}

// Poll independently of the blocking camera/SD path, including release edges.
void pollButtons(void *) {
  TickType_t lastWake = xTaskGetTickCount();
  for (;;) {
    for (DebouncedButton *button : {&captureButton, &endCaptureButton, &audioButton}) {
      if (updateButton(*button)) {
        const unsigned long detectedAt = millis();
        if (xQueueSend(button->presses, &detectedAt, 0) != pdTRUE && button->pressedMessage != nullptr) {
          Serial.printf("BUTTON_IGNORED: pin=%u reason=pending_queue_full\n", button->pin);
        }
      }
    }
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(5));
  }
}

bool takePress(DebouncedButton &button) {
  unsigned long detectedAt;
  if (button.presses == nullptr || xQueueReceive(button.presses, &detectedAt, 0) != pdTRUE) {
    return false;
  }
  if (button.pressedMessage != nullptr) {
    Serial.printf("BUTTON_SERVICED: pin=%u queued_ms=%lu\n", button.pin, millis() - detectedAt);
  }
  return true;
}

}  // namespace

void initializeButtons() {
  pinMode(CAPTURE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(END_CAPTURE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(AUDIO_BUTTON_PIN, INPUT_PULLUP);
  captureButton.presses = xQueueCreate(8, sizeof(unsigned long));
  endCaptureButton.presses = xQueueCreate(8, sizeof(unsigned long));
  audioButton.presses = xQueueCreate(8, sizeof(unsigned long));
  if (captureButton.presses == nullptr || endCaptureButton.presses == nullptr || audioButton.presses == nullptr ||
      xTaskCreate(pollButtons, "capture-buttons", 3072, nullptr, 1, nullptr) != pdPASS) {
    if (captureButton.presses != nullptr) vQueueDelete(captureButton.presses);
    if (endCaptureButton.presses != nullptr) vQueueDelete(endCaptureButton.presses);
    if (audioButton.presses != nullptr) vQueueDelete(audioButton.presses);
    audioButton.presses = nullptr;
    captureButton.presses = nullptr;
    endCaptureButton.presses = nullptr;
    Serial.println("BUTTON_INITIALIZATION_FAILED");
    return;
  }
  Serial.println("Buttons initialized.");
}

bool captureButtonPressed() {
  return takePress(captureButton);
}

bool endCaptureButtonPressed() {
  return takePress(endCaptureButton);
}

bool audioButtonPressed() {
  return takePress(audioButton);
}
