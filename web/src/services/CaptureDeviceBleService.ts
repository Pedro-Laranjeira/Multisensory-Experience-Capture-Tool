import { isFirmwareManifest, convertManifestToSession } from "./CaptureSessionManifest.ts";
import type { FirmwareManifest } from "./CaptureSessionManifest.ts";
import type { Session } from "../types/Session";

export const CAPTURE_BLE_SERVICE_UUID =
    "7f2d0001-6f2d-4c32-9a11-2c2c00000001";
export const CAPTURE_BLE_MANIFEST_UUID =
    "7f2d0002-6f2d-4c32-9a11-2c2c00000001";
export const CAPTURE_BLE_IMAGE_REQUEST_UUID =
    "7f2d0003-6f2d-4c32-9a11-2c2c00000001";
export const CAPTURE_BLE_IMAGE_INFO_UUID =
    "7f2d0004-6f2d-4c32-9a11-2c2c00000001";
export const CAPTURE_BLE_IMAGE_DATA_UUID =
    "7f2d0005-6f2d-4c32-9a11-2c2c00000001";

const MAX_MANIFEST_READS = 100;
const IMAGE_INFO_RETRY_MS = 100;
const MAX_IMAGE_INFO_RETRIES = 15;

interface ImageInfo {
    file: string;
    size: number;
    chunkSize: number;
    chunkCount: number;
}

export interface CaptureDeviceBleLoadResult {
    session: Session;
    objectUrls: string[];
    device: BluetoothDevice;
}

export interface CaptureDeviceBleCallbacks {
    onDisconnected?: () => void;
    onStatus?: (status: string) => void;
}

export class CaptureDeviceBleError extends Error {
    readonly kind: "cancelled" | "connection" | "transfer";
    constructor(message: string, kind: "cancelled" | "connection" | "transfer" = "transfer") {
        super(message);
        this.name = "CaptureDeviceBleError";
        this.kind = kind;
    }
}

function isBluetoothAvailable(): boolean {
    return "bluetooth" in navigator;
}

function decodeValue(value: DataView): string {
    const bytes = new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength
    );
    return new TextDecoder().decode(bytes);
}

function isImageInfo(value: unknown): value is ImageInfo {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const info = value as Partial<ImageInfo>;
    return typeof info.file === "string" &&
        typeof info.size === "number" && Number.isSafeInteger(info.size) && info.size > 0 &&
        typeof info.chunkSize === "number" && Number.isSafeInteger(info.chunkSize) && info.chunkSize > 0 &&
        typeof info.chunkCount === "number" && Number.isSafeInteger(info.chunkCount) &&
        info.chunkCount === Math.ceil(info.size / info.chunkSize);
}

function describeError(error: unknown): string {
    if (error instanceof DOMException && error.name === "NotFoundError") {
        return "Bluetooth device selection was cancelled.";
    }

    if (error instanceof DOMException) {
        return `Bluetooth operation failed (${error.name}). Please check the device connection and try again.`;
    }

    if (error instanceof Error) {
        return error.message;
    }

    return "The capture device Bluetooth transfer failed.";
}

async function readManifest(
    characteristic: BluetoothRemoteGATTCharacteristic
): Promise<FirmwareManifest> {
    const decoder = new TextDecoder();
    let text = "";

    for (let read = 0; read < MAX_MANIFEST_READS; read += 1) {
        const value = await characteristic.readValue();
        const bytes = new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength
        );
        text += decoder.decode(bytes);

        try {
            const parsed: unknown = JSON.parse(text);
            if (isFirmwareManifest(parsed)) {
                return parsed;
            }
        } catch {
            // The firmware returns the manifest in sequential chunks.
        }
    }

    throw new CaptureDeviceBleError("The capture device session manifest is incomplete or invalid.");
}

async function readImageInfo(
    characteristic: BluetoothRemoteGATTCharacteristic,
    filename: string
): Promise<ImageInfo> {
    for (let attempt = 0; ; attempt += 1) {
        const text = decodeValue(await characteristic.readValue());
        let parsed: unknown;

        try {
            parsed = JSON.parse(text);
        } catch {
            throw new CaptureDeviceBleError(`Invalid image information for ${filename}.`);
        }

        if (!isImageInfo(parsed)) {
            const error = parsed as { error?: unknown };
            const reason = error && typeof error.error === "string" ? error.error : "unknown error";
            if (reason === "No image selected") {
                // Selection is deferred to the firmware main loop after the request write.
                if (attempt === MAX_IMAGE_INFO_RETRIES) {
                    throw new CaptureDeviceBleError(`Timed out selecting ${filename}: No image selected after ${MAX_IMAGE_INFO_RETRIES} retries.`);
                }
                await new Promise<void>(resolve => setTimeout(resolve, IMAGE_INFO_RETRY_MS));
                continue;
            }
            throw new CaptureDeviceBleError(`The capture device could not select ${filename}: ${reason}.`);
        }

        if (parsed.file !== filename) {
            throw new CaptureDeviceBleError(
                `The capture device returned image ${parsed.file} instead of ${filename}.`
            );
        }

        return parsed;
    }
}

async function downloadImage(
    dataCharacteristic: BluetoothRemoteGATTCharacteristic,
    info: ImageInfo,
    filename: string,
    mimeType: string
): Promise<string> {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let reads = 0;

    while (totalBytes < info.size) {
        if (reads >= info.chunkCount) {
            throw new CaptureDeviceBleError(`Incomplete image transfer for ${filename}.`);
        }

        const value = await dataCharacteristic.readValue();
        const bytes = new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength
        );
        const remaining = info.size - totalBytes;

        if (bytes.byteLength !== Math.min(info.chunkSize, remaining)) {
            throw new CaptureDeviceBleError(`Invalid image chunk received for ${filename}.`);
        }

        const ownedChunk = new Uint8Array(bytes.byteLength);
        ownedChunk.set(bytes);
        chunks.push(ownedChunk);
        totalBytes += ownedChunk.byteLength;
        reads += 1;
    }

    if (totalBytes !== info.size) {
        throw new CaptureDeviceBleError(`Incomplete image transfer for ${filename}.`);
    }

    const imageBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        imageBytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    const blob = new Blob([imageBytes.buffer], { type: mimeType });
    return URL.createObjectURL(blob);
}

export async function loadCaptureDeviceSession(
    callbacks: CaptureDeviceBleCallbacks = {}
): Promise<CaptureDeviceBleLoadResult> {
    if (!isBluetoothAvailable()) {
        throw new CaptureDeviceBleError("Web Bluetooth is unavailable in this browser.");
    }

    let device: BluetoothDevice;
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ name: "MECT-Capture" }],
            optionalServices: [CAPTURE_BLE_SERVICE_UUID]
        });
    } catch (error) {
        console.error("Wireless operation failed", error);
        throw new CaptureDeviceBleError(describeError(error), error instanceof DOMException && error.name === "NotFoundError" ? "cancelled" : "connection");
    }

    if (callbacks.onDisconnected) {
        device.addEventListener(
            "gattserverdisconnected",
            callbacks.onDisconnected
        );
    }

    const objectUrls: string[] = [];
    let disconnected = false;
    const markDisconnected = () => { disconnected = true; };
    device.addEventListener("gattserverdisconnected", markDisconnected);

    try {
        if (!device.gatt) {
            throw new CaptureDeviceBleError("The capture device does not expose a GATT server.");
        }

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(CAPTURE_BLE_SERVICE_UUID);
        const manifestCharacteristic = await service.getCharacteristic(
            CAPTURE_BLE_MANIFEST_UUID
        );
        const imageRequestCharacteristic = await service.getCharacteristic(
            CAPTURE_BLE_IMAGE_REQUEST_UUID
        );
        const imageInfoCharacteristic = await service.getCharacteristic(
            CAPTURE_BLE_IMAGE_INFO_UUID
        );
        const imageDataCharacteristic = await service.getCharacteristic(
            CAPTURE_BLE_IMAGE_DATA_UUID
        );

        const manifest = await readManifest(manifestCharacteristic);
        callbacks.onStatus?.("Loading session...");
        const mediaUrls = new Map<string, string>();

        for (const [index, capture] of manifest.captures.entries()) {
            if (capture.mediaType !== "photo" && capture.mediaType !== "audio") {
                throw new CaptureDeviceBleError(
                    `Unsupported capture type ${capture.mediaType} for ${capture.file}.`
                );
            }

            const extension = capture.mediaType === "photo" ? /\.jpe?g$/i : /\.wav$/i;
            if (!extension.test(capture.file)) {
                throw new CaptureDeviceBleError(`Unsupported ${capture.mediaType} file ${capture.file}: expected ${capture.mediaType === "photo" ? "JPG/JPEG" : "WAV"}.`);
            }
            const mimeType = capture.mediaType === "photo" ? "image/jpeg" : "audio/wav";
            const filenameBytes = new TextEncoder().encode(capture.file);
            callbacks.onStatus?.(
                `Downloading capture ${index + 1} of ${manifest.captures.length}...`
            );
            await imageRequestCharacteristic.writeValueWithResponse(filenameBytes);
            const info = await readImageInfo(imageInfoCharacteristic, capture.file);
            const objectUrl = await downloadImage(
                imageDataCharacteristic,
                info,
                capture.file,
                mimeType
            );
            mediaUrls.set(capture.file, objectUrl);
            objectUrls.push(objectUrl);
            console.debug(`Capture device media ${index + 1}/${manifest.captures.length} loaded`);
        }

        if (disconnected) throw new CaptureDeviceBleError("Transfer interrupted.");
        callbacks.onStatus?.("Preparing questionnaire...");
        return {
            session: convertManifestToSession(manifest, mediaUrls, Date.now()),
            objectUrls,
            device
        };
    } catch (error) {
        console.error("Wireless transfer failed", error);
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        disconnectCaptureDevice(device);
        if (error instanceof CaptureDeviceBleError) {
            throw error;
        }
        throw new CaptureDeviceBleError(describeError(error));
    } finally {
        device.removeEventListener("gattserverdisconnected", markDisconnected);
        if (callbacks.onDisconnected) device.removeEventListener("gattserverdisconnected", callbacks.onDisconnected);
    }
}

export function disconnectCaptureDevice(device: BluetoothDevice): void {
    if (device.gatt?.connected) {
        device.gatt.disconnect();
    }
}
