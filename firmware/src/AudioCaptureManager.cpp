#include "AudioCaptureManager.h"

#include <Arduino.h>
#include <SD.h>
#include <driver/i2s.h>
#include <freertos/queue.h>
#include <cstring>

#include "Config.h"

namespace {

// Arduino-ESP32 2.0.x / ESP-IDF 4.4 legacy PDM RX API. S3 PDM RX uses I2S0.
constexpr i2s_port_t microphonePort = I2S_NUM_0;
constexpr uint32_t sampleRate = 16000;
constexpr uint16_t bytesPerSample = 2;  // 16-bit mono PCM
constexpr int audioGain = 2;
constexpr size_t headerSize = 44;
constexpr int dmaBufferCount = 8;
constexpr int samplesPerBuffer = 512;
constexpr size_t chunkSize = samplesPerBuffer * bytesPerSample;
bool sdAvailable = false;
enum class AudioState { IDLE, STARTING, RECORDING, STOPPING };
AudioState state = AudioState::IDLE;
bool driverInstalled = false;
bool driverConfigured = false;
QueueHandle_t audioEvents = nullptr;
File audioFile;
char audioPath[20] = "";
char temporaryPath[20] = "";
bool temporaryOwned = false;
uint16_t nextAudioNumber = 1;
uint32_t dataBytes = 0;
unsigned long lastDataAt = 0;
unsigned long recordingStartedAtMs = 0;
uint8_t audioBuffer[chunkSize];

constexpr int16_t saturatePcmSample(int32_t amplified) {
  return amplified > INT16_MAX ? INT16_MAX :
         amplified < INT16_MIN ? INT16_MIN : static_cast<int16_t>(amplified);
}

// Call only after validating that bytesRead contains complete 16-bit samples.
void applyAudioGain(uint8_t *buffer, size_t bytesRead) {
  for (size_t offset = 0; offset < bytesRead; offset += bytesPerSample) {
    int16_t sample;
    // memcpy avoids alignment/aliasing assumptions about the byte buffer.
    memcpy(&sample, buffer + offset, sizeof(sample));
    sample = saturatePcmSample(static_cast<int32_t>(sample) * audioGain);
    memcpy(buffer + offset, &sample, sizeof(sample));
  }
}

void put16(uint8_t *dest, uint16_t value) {
  dest[0] = value & 0xff;
  dest[1] = value >> 8;
}

void put32(uint8_t *dest, uint32_t value) {
  for (unsigned int i = 0; i < 4; ++i) dest[i] = (value >> (8 * i)) & 0xff;
}

void makeHeader(uint8_t *header) {
  memset(header, 0, headerSize);
  memcpy(header, "RIFF", 4);
  put32(header + 4, dataBytes + 36);
  memcpy(header + 8, "WAVEfmt ", 8);
  put32(header + 16, 16);  // PCM fmt chunk size
  put16(header + 20, 1);   // PCM
  put16(header + 22, 1);   // mono
  put32(header + 24, sampleRate);
  put32(header + 28, sampleRate * bytesPerSample);
  put16(header + 32, bytesPerSample);
  put16(header + 34, 16);
  memcpy(header + 36, "data", 4);
  put32(header + 40, dataBytes);
}

bool writeHeader() {
  uint8_t header[headerSize];
  makeHeader(header);
  return audioFile.seek(0) && audioFile.write(header, headerSize) == headerSize;
}

bool stopMicrophone() {
  if (!driverInstalled) return true;
  if (i2s_stop(microphonePort) == ESP_OK) return true;
  // Only release our own driver on an error; do not assume uninstall succeeds.
  if (i2s_driver_uninstall(microphonePort) == ESP_OK) {
    driverInstalled = false;
    driverConfigured = false;
    audioEvents = nullptr;
    return true;
  }
  return false;
}

bool cleanupTemporary() {
  if (audioFile) audioFile.close();
  if (!temporaryOwned) return true;
  if (!SD.exists(temporaryPath) || SD.remove(temporaryPath)) {
    temporaryOwned = false;
    return true;
  }
  return false;
}

bool failRecording(const char *reason) {
  const bool stopped = stopMicrophone();
  const bool removed = cleanupTemporary();
  state = AudioState::IDLE;
  Serial.printf("AUDIO_RECORDING_FAILED: %s file=%s%s%s\n", reason, audioPath,
                stopped ? "" : "; microphone cleanup failed",
                removed ? "" : "; partial .TMP could not be removed (check SD)");
  return false;
}

bool checkAudioEvents() {
  i2s_event_t event;
  // The event queue is bounded; no waits or per-buffer logging here.
  for (int i = 0; i < 16 && xQueueReceive(audioEvents, &event, 0) == pdTRUE; ++i) {
    if (event.type == I2S_EVENT_DMA_ERROR || event.type == I2S_EVENT_RX_Q_OVF) {
      return failRecording("microphone DMA overflow/error; recording discarded");
    }
  }
  return true;
}

bool writeAvailableChunk(size_t &bytesRead) {
  const esp_err_t error = i2s_read(microphonePort, audioBuffer, chunkSize, &bytesRead, 0);
  if (error != ESP_OK) return failRecording("microphone read failed");
  if (bytesRead == 0) return true;
  if (bytesRead % bytesPerSample != 0 || bytesRead > UINT32_MAX - 36U - dataBytes) {
    return failRecording("invalid PCM block or WAV size limit reached");
  }
  applyAudioGain(audioBuffer, bytesRead);
  if (audioFile.write(audioBuffer, bytesRead) != bytesRead) {
    return failRecording("incomplete SD write");
  }
  dataBytes += bytesRead;
  lastDataAt = millis();
  return true;
}

}  // namespace

void initializeAudioCapture(bool sdReady) {
  sdAvailable = sdReady;
}

bool isAudioRecording() {
  return state != AudioState::IDLE;
}

const char *audioRecordingState() {
  switch (state) {
    case AudioState::STARTING: return "STARTING";
    case AudioState::RECORDING: return "RECORDING";
    case AudioState::STOPPING: return "STOPPING";
    default: return "IDLE";
  }
}

namespace {

bool prepareMicrophone() {
  if (driverInstalled && driverConfigured) return stopMicrophone();
  if (driverInstalled) {
    if (i2s_driver_uninstall(microphonePort) != ESP_OK) return false;
    driverInstalled = false;
    audioEvents = nullptr;
  }
  i2s_config_t config = {};
  config.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_PDM);
  config.sample_rate = sampleRate;
  config.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  config.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  config.dma_buf_count = dmaBufferCount;
  config.dma_buf_len = samplesPerBuffer;
  config.use_apll = false;
  const esp_err_t installed = i2s_driver_install(microphonePort, &config, 16, &audioEvents);
  if (installed != ESP_OK) return false;
  driverInstalled = true;
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = I2S_PIN_NO_CHANGE;
  pins.ws_io_num = MICROPHONE_CLOCK_PIN;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = MICROPHONE_DATA_PIN;
  if (i2s_set_pin(microphonePort, &pins) != ESP_OK ||
      i2s_set_clk(microphonePort, sampleRate, I2S_BITS_PER_SAMPLE_16BIT, I2S_CHANNEL_MONO) != ESP_OK ||
      i2s_stop(microphonePort) != ESP_OK) {
    // A partially configured driver must not be reused on the next attempt.
    if (i2s_driver_uninstall(microphonePort) == ESP_OK) {
      driverInstalled = false;
      audioEvents = nullptr;
    }
    return false;
  }
  driverConfigured = true;
  return true;
}

bool discardPendingSamples() {
  // i2s_start resets DMA, but the legacy driver's RX queue can retain old buffers.
  // Drain it while stopped, before restarting DMA and accepting this recording.
  for (int i = 0; i <= dmaBufferCount; ++i) {
    size_t bytesRead = 0;
    if (i2s_read(microphonePort, audioBuffer, chunkSize, &bytesRead, 0) != ESP_OK) return false;
    if (bytesRead == 0) return xQueueReset(audioEvents) == pdPASS;
  }
  return false;
}

bool validateClosedRecording() {
  // Arduino File.flush/close have no status return. Reopen and verify persisted
  // header/length instead of reporting success based only on a cached file size.
  File saved = SD.open(temporaryPath, FILE_READ);
  if (!saved) return false;
  uint8_t expected[headerSize], actual[headerSize];
  makeHeader(expected);
  const bool valid = saved.size() == headerSize + dataBytes &&
      saved.read(actual, headerSize) == headerSize &&
      memcmp(actual, expected, headerSize) == 0;
  saved.close();
  return valid;
}

}  // namespace

bool startAudioRecording(unsigned long timestampMs) {
  if (state != AudioState::IDLE) {
    Serial.printf("AUDIO_ACTION_REJECTED: state=%s action=start\n", audioRecordingState());
    return false;
  }
  state = AudioState::STARTING;
  recordingStartedAtMs = timestampMs;
  if (!sdAvailable) return failRecording("microSD was not initialized");
  if (!cleanupTemporary()) return failRecording("previous temporary file cleanup failed");
  if (!prepareMicrophone() || !driverInstalled) return failRecording("microphone initialization/stop failed");

  // No final-named WAV is visible until successful finalization. Skip existing
  // WAVs and TMPs, including incomplete files left by a previous power loss.
  while (nextAudioNumber <= 9999) {
    snprintf(audioPath, sizeof(audioPath), "/AUD_%04u.WAV", nextAudioNumber);
    snprintf(temporaryPath, sizeof(temporaryPath), "/AUD_%04u.TMP", nextAudioNumber);
    if (!SD.exists(audioPath) && !SD.exists(temporaryPath)) break;
    ++nextAudioNumber;
  }
  if (nextAudioNumber > 9999) return failRecording("no available audio filename");
  temporaryOwned = true;
  audioFile = SD.open(temporaryPath, FILE_WRITE);
  if (!audioFile) return failRecording("could not create temporary recording");
  dataBytes = 0;
  if (!writeHeader()) return failRecording("could not write placeholder header");
  if (!discardPendingSamples() || i2s_start(microphonePort) != ESP_OK) {
    return failRecording("could not reset/start microphone");
  }
  // Confirm actual PCM arrival before announcing success (bounded startup only).
  size_t bytesRead = 0;
  if (i2s_read(microphonePort, audioBuffer, chunkSize, &bytesRead, pdMS_TO_TICKS(250)) != ESP_OK ||
      bytesRead == 0 || bytesRead % bytesPerSample != 0) {
    return failRecording("microphone produced no valid startup PCM");
  }
  applyAudioGain(audioBuffer, bytesRead);
  if (audioFile.write(audioBuffer, bytesRead) != bytesRead) return failRecording("startup SD write failed");
  dataBytes = bytesRead;
  lastDataAt = millis();
  if (!checkAudioEvents()) return false;
  state = AudioState::RECORDING;
  Serial.printf("AUDIO_RECORDING_STARTED: file=%s\n", audioPath);
  return true;
}

void processAudioRecording() {
  if (state != AudioState::RECORDING || !checkAudioEvents()) return;
  size_t bytesRead = 0;
  // At most 1 KB per loop iteration. DMA continues between calls.
  if (!writeAvailableChunk(bytesRead)) return;
  if (millis() - lastDataAt > 2000) failRecording("no microphone data received for 2 seconds");
}

bool stopAudioRecording(AudioCaptureResult &result) {
  result = {};
  if (state != AudioState::RECORDING) {
    Serial.printf("AUDIO_ACTION_REJECTED: state=%s action=stop\n", audioRecordingState());
    return false;
  }
  state = AudioState::STOPPING;
  if (i2s_stop(microphonePort) != ESP_OK) return failRecording("could not stop microphone");
  if (!checkAudioEvents()) return false;
  // DMA is stopped. Drain completed buffers without waiting for new samples.
  // The in-flight partial DMA buffer is not exposed by the driver (up to 32 ms).
  for (int i = 0; i <= dmaBufferCount; ++i) {
    size_t bytesRead = 0;
    if (!writeAvailableChunk(bytesRead)) return false;
    if (bytesRead == 0) break;
  }
  // Require at least 100 ms of PCM, not just a header or a few startup samples.
  if (dataBytes < sampleRate * bytesPerSample / 10) return failRecording("recording too short (less than 100 ms)");
  if (!writeHeader()) return failRecording("could not finalize WAV header");
  audioFile.flush();
  if (audioFile.size() != headerSize + dataBytes) return failRecording("WAV file size mismatch");
  audioFile.close();
  if (!validateClosedRecording()) return failRecording("closed WAV validation failed");
  if (SD.exists(audioPath) || !SD.rename(temporaryPath, audioPath)) {
    return failRecording("could not publish finalized WAV");
  }
  temporaryOwned = false;
  snprintf(result.filename, sizeof(result.filename), "%s", audioPath + 1);
  result.timestampMs = recordingStartedAtMs;
  ++nextAudioNumber;
  state = AudioState::IDLE;
  const uint32_t durationMs = static_cast<uint64_t>(dataBytes) * 1000 / (sampleRate * bytesPerSample);
  Serial.printf("AUDIO_RECORDING_STOPPED: file=%s duration_ms=%lu bytes=%lu\n",
                audioPath, static_cast<unsigned long>(durationMs), static_cast<unsigned long>(dataBytes));
  return true;
}
