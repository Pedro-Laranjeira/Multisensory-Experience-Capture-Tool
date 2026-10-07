import test from "node:test";
import assert from "node:assert/strict";
import { loadCaptureDeviceSession } from "../src/services/CaptureDeviceBleService.ts";
import { loadCaptureSessionFiles } from "../src/services/CaptureFileImportService.ts";
import { isFirmwareManifest } from "../src/services/CaptureSessionManifest.ts";

const manifest = { sessionId: "test", startedAtMs: 0, finishedAtMs: 10, captures: [] };
test("empty local sessions and malformed filenames cannot reach a questionnaire", async () => {
    await assert.rejects(loadCaptureSessionFiles([new File([JSON.stringify(manifest)], "session.json")]), /No captured moments/);
    assert.equal(isFirmwareManifest({ ...manifest, captures: [{ id: 1, mediaType: "photo", file: " ", timestampMs: 0 }] }), false);
});
test("wireless cancellation is distinguished from device connection failure", async t => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice: async () => { throw new DOMException("Cancelled", "NotFoundError"); } } });
    t.after(() => delete navigator.bluetooth);
    await assert.rejects(loadCaptureDeviceSession(), error => error.kind === "cancelled");
    navigator.bluetooth.requestDevice = async () => { throw new DOMException("Unavailable", "NetworkError"); };
    await assert.rejects(loadCaptureDeviceSession(), error => error.kind === "connection");
});
test("interrupted wireless transfer rejects entire candidate and releases earlier photo URLs", async t => {
    const revoked = [];
    t.mock.method(URL, "createObjectURL", () => "blob:test-photo");
    t.mock.method(URL, "revokeObjectURL", url => revoked.push(url));
    const data = value => { const bytes = new TextEncoder().encode(JSON.stringify(value)); return new DataView(bytes.buffer); };
    let photo = 0;
    const device = new EventTarget();
    device.gatt = { connected: true, disconnect() { this.connected = false; }, async connect() { return { getPrimaryService: async () => ({ getCharacteristic: async uuid => {
        if (uuid.startsWith("7f2d0002")) return { readValue: async () => data({ ...manifest, captures: [1,2].map(id => ({ id, file: `IMG_${id}.JPG`, mediaType: "photo", timestampMs: id })) }) };
        if (uuid.startsWith("7f2d0003")) return { writeValueWithResponse: async () => { photo++; } };
        if (uuid.startsWith("7f2d0004")) return { readValue: async () => data({ file: `IMG_${photo}.JPG`, size: 2, chunkSize: 2, chunkCount: 1 }) };
        return { readValue: async () => { if (photo === 2) throw new Error("Disconnected"); return new DataView(new Uint8Array([255,216]).buffer); } };
    } }) }; } };
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice: async () => device } });
    t.after(() => delete navigator.bluetooth);
    await assert.rejects(loadCaptureDeviceSession(), /Disconnected/);
    assert.deepEqual(revoked, ["blob:test-photo"]);
    assert.equal(device.gatt.connected, false);
});
