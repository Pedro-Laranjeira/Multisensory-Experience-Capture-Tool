#include "BleManager.h"

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <FS.h>
#include <SD.h>

#include "Config.h"

namespace {

BLECharacteristic *manifestCharacteristic = nullptr;
BLECharacteristic *imageInfoCharacteristic = nullptr;
BLECharacteristic *imageDataCharacteristic = nullptr;
size_t nextManifestChunk = 0;
String selectedImageFilename;
String imageInfo;
File selectedImageFile;
size_t selectedImageSize = 0;
size_t imageTransferOffset = 0;
bool imageSelected = false;
char pendingImageRequest[IMAGE_REQUEST_BUFFER_SIZE];
volatile bool imageRequestPending = false;
volatile bool imageSelectionInProgress = false;
volatile bool transferDisconnected = false;
portMUX_TYPE imageRequestMux = portMUX_INITIALIZER_UNLOCKED;
String bleManifestJson;

// The snapshot is emitted by SessionManager's fixed JSON serializer. Match an
// entire file field; the basename alphabet below excludes JSON/path escapes.
bool isValidImageFilename(const String &filename) {
  if (filename.length() == 0 || filename.length() >= IMAGE_REQUEST_BUFFER_SIZE ||
      filename.indexOf("..") >= 0) return false;
  for (size_t i = 0; i < filename.length(); ++i) {
    const char c = filename[i];
    if (!isAlphaNumeric(c) && c != '_' && c != '-' && c != '.') return false;
  }
  String lower = filename;
  lower.toLowerCase();
  return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".wav");
}

void selectImage(const String &filename) {
  if (selectedImageFile) {
    selectedImageFile.close();
  }

  imageSelected = false;
  imageTransferOffset = 0;
  selectedImageSize = 0;

  Serial.printf("BLE_MEDIA_REQUEST: file=%s\n", filename.c_str());
  if (!isValidImageFilename(filename)) {
    imageInfo = "{\"error\":\"Invalid media filename; expected a JPEG or WAV basename\"}";
  } else if (bleManifestJson.indexOf("\"file\": \"" + filename + "\"") < 0) {
    imageInfo = "{\"error\":\"File is not referenced by the active session manifest\"}";
  } else {
    const String imagePath = "/" + filename;
    File imageFile = SD.open(imagePath, FILE_READ);

    if (!imageFile || imageFile.size() == 0) {
      if (imageFile) imageFile.close();
      Serial.printf(
          "BLE_IMAGE_REQUEST_INVALID: file not found: %s\n",
          filename.c_str()
      );
      imageInfo = "{\"error\":\"Media file not found or empty\"}";
    } else {
      selectedImageFile = imageFile;
      selectedImageFilename = filename;
      selectedImageSize = selectedImageFile.size();
      imageTransferOffset = 0;
      imageSelected = true;

      const size_t chunkCount =
          selectedImageSize / BLE_IMAGE_CHUNK_SIZE +
          (selectedImageSize % BLE_IMAGE_CHUNK_SIZE != 0);
      imageInfo = "{\"file\":\"" + selectedImageFilename +
                  "\",\"size\":" + String(selectedImageSize) +
                  ",\"chunkSize\":" + String(BLE_IMAGE_CHUNK_SIZE) +
                  ",\"chunkCount\":" + String(chunkCount) + "}";
      Serial.printf(
          "BLE_MEDIA_READY: file=%s size=%u\n",
          selectedImageFilename.c_str(),
          selectedImageSize
      );
    }
  }

  if (imageInfoCharacteristic != nullptr) {
    imageInfoCharacteristic->setValue(imageInfo.c_str());
  }

  if (imageDataCharacteristic != nullptr && !imageSelected) {
    imageDataCharacteristic->setValue("");
  }
}

class ConnectionCallbacks : public BLEServerCallbacks {
 public:
  void onDisconnect(BLEServer *) override {
    transferDisconnected = true;
  }
};

class ManifestReadCallbacks : public BLECharacteristicCallbacks {
 public:
  void onRead(BLECharacteristic *characteristic) override {
    const String &manifestJson = bleManifestJson;
    if (manifestJson.length() == 0) {
      characteristic->setValue("{}");
      return;
    }

    const size_t manifestLength = manifestJson.length();
    const size_t chunkCount =
        (manifestLength + BLE_MANIFEST_CHUNK_SIZE - 1) /
        BLE_MANIFEST_CHUNK_SIZE;
    if (nextManifestChunk >= chunkCount) {
      nextManifestChunk = 0;
    }

    const size_t chunkStart = nextManifestChunk * BLE_MANIFEST_CHUNK_SIZE;
    const size_t chunkLength = min(
        BLE_MANIFEST_CHUNK_SIZE,
        manifestLength - chunkStart
    );
    const String chunk = manifestJson.substring(
        chunkStart,
        chunkStart + chunkLength
    );
    characteristic->setValue(chunk.c_str());
    ++nextManifestChunk;
  }
};

class ImageRequestCallbacks : public BLECharacteristicCallbacks {
 public:
  void onWrite(
      BLECharacteristic *characteristic,
      esp_ble_gatts_cb_param_t *param
  ) override {
    portENTER_CRITICAL(&imageRequestMux);
    // Invalid/oversized requests must invalidate the previous selection too.
    const size_t length = param->write.len;
    if (length >= IMAGE_REQUEST_BUFFER_SIZE || memchr(param->write.value, 0, length)) {
      pendingImageRequest[0] = '\0';
    } else {
      memcpy(pendingImageRequest, param->write.value, length);
      pendingImageRequest[length] = '\0';
    }
    imageRequestPending = true;
    portEXIT_CRITICAL(&imageRequestMux);
  }
};

class ImageInfoReadCallbacks : public BLECharacteristicCallbacks {
 public:
  void onRead(BLECharacteristic *characteristic) override {
    portENTER_CRITICAL(&imageRequestMux);
    const bool pending = imageRequestPending || imageSelectionInProgress;
    portEXIT_CRITICAL(&imageRequestMux);
    characteristic->setValue(pending ? "{\"error\":\"No image selected\"}" : imageInfo.c_str());
  }
};

class ImageDataReadCallbacks : public BLECharacteristicCallbacks {
 public:
  void onRead(BLECharacteristic *characteristic) override {
    if (imageRequestPending || imageSelectionInProgress || !imageSelected || !selectedImageFile) {
      characteristic->setValue("");
      return;
    }

    if (imageTransferOffset >= selectedImageSize) {
      characteristic->setValue("");
      return;
    }

    uint8_t chunk[BLE_IMAGE_CHUNK_SIZE];
    const size_t bytesToRead = min(
        BLE_IMAGE_CHUNK_SIZE,
        selectedImageSize - imageTransferOffset
    );

    if (!selectedImageFile.seek(imageTransferOffset)) {
      Serial.println("BLE_IMAGE_ERROR: Could not seek media file.");
      selectedImageFile.close();
      imageSelected = false;
      characteristic->setValue("");
      return;
    }

    const size_t bytesRead = selectedImageFile.read(chunk, bytesToRead);
    if (bytesRead != bytesToRead) {
      Serial.println("BLE_IMAGE_ERROR: Could not read media chunk.");
      selectedImageFile.close();
      imageSelected = false;
      characteristic->setValue("");
      return;
    }

    characteristic->setValue(chunk, bytesRead);
    imageTransferOffset += bytesRead;

    if (imageTransferOffset >= selectedImageSize) {
      Serial.printf("BLE_MEDIA_TRANSFER_COMPLETE: file=%s bytes=%u\n",
                    selectedImageFilename.c_str(), imageTransferOffset);
      imageSelected = false;
      selectedImageFile.close();
    }
  }
};

}  // namespace

void initializeBLE() {
  BLEDevice::init("MECT-Capture");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ConnectionCallbacks());
  BLEService *service = server->createService(CAPTURE_BLE_SERVICE_UUID);

  manifestCharacteristic = service->createCharacteristic(
      CAPTURE_BLE_MANIFEST_UUID,
      BLECharacteristic::PROPERTY_READ
  );
  manifestCharacteristic->setCallbacks(new ManifestReadCallbacks());
  manifestCharacteristic->setValue("{}");
  Serial.println("BLE_CHARACTERISTIC_READY: 0002 MANIFEST READ");

  BLECharacteristic *imageRequestCharacteristic = service->createCharacteristic(
      CAPTURE_BLE_IMAGE_REQUEST_UUID,
      BLECharacteristic::PROPERTY_WRITE |
          BLECharacteristic::PROPERTY_WRITE_NR
  );
  imageRequestCharacteristic->setCallbacks(new ImageRequestCallbacks());
  Serial.println("BLE_CHARACTERISTIC_READY: 0003 IMAGE_REQUEST WRITE");

  imageInfoCharacteristic = service->createCharacteristic(
      CAPTURE_BLE_IMAGE_INFO_UUID,
      BLECharacteristic::PROPERTY_READ
  );
  imageInfoCharacteristic->setCallbacks(new ImageInfoReadCallbacks());
  imageInfo = "{\"error\":\"No image selected\"}";
  imageInfoCharacteristic->setValue(imageInfo.c_str());
  Serial.println("BLE_CHARACTERISTIC_READY: 0004 IMAGE_INFO READ");

  imageDataCharacteristic = service->createCharacteristic(
      CAPTURE_BLE_IMAGE_DATA_UUID,
      BLECharacteristic::PROPERTY_READ
  );
  imageDataCharacteristic->setCallbacks(new ImageDataReadCallbacks());
  imageDataCharacteristic->setValue("");
  Serial.println("BLE_CHARACTERISTIC_READY: 0005 IMAGE_DATA READ");

  service->start();
  Serial.println("BLE_SERVICE_STARTED");

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(CAPTURE_BLE_SERVICE_UUID);
  advertising->start();
  Serial.println("BLE_READY");
}

void updateBLEManifest(const String &manifestJson) {
  bleManifestJson = manifestJson;
  nextManifestChunk = 0;

  if (manifestCharacteristic != nullptr) {
    const size_t firstChunkLength = min(
        BLE_MANIFEST_CHUNK_SIZE,
        bleManifestJson.length()
    );
    manifestCharacteristic->setValue(
        bleManifestJson.substring(0, firstChunkLength).c_str()
    );
    Serial.println("BLE_SESSION_UPDATED");
  }
}

void processPendingImageRequest() {
  if (transferDisconnected) {
    transferDisconnected = false;
    if (selectedImageFile) selectedImageFile.close();
    imageSelected = false;
    imageTransferOffset = 0;
    selectedImageSize = 0;
    nextManifestChunk = 0;
    imageInfo = "{\"error\":\"No image selected\"}";
    portENTER_CRITICAL(&imageRequestMux);
    imageRequestPending = false;
    portEXIT_CRITICAL(&imageRequestMux);
    BLEDevice::startAdvertising();
  }
  char requestedFilename[IMAGE_REQUEST_BUFFER_SIZE];
  bool hasPendingRequest = false;

  portENTER_CRITICAL(&imageRequestMux);
  if (imageRequestPending) {
    memcpy(requestedFilename, pendingImageRequest, sizeof(requestedFilename));
    imageRequestPending = false;
    imageSelectionInProgress = true;
    hasPendingRequest = true;
  }
  portEXIT_CRITICAL(&imageRequestMux);

  if (hasPendingRequest) {
    selectImage(String(requestedFilename));
    portENTER_CRITICAL(&imageRequestMux);
    imageSelectionInProgress = false;
    portEXIT_CRITICAL(&imageRequestMux);
  }
}
