import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    loadStoredTemplate, loadTemplate, saveTemplate, resetTemplate
} from "../src/services/TemplateManager.ts";
import { peekParticipantId } from "../src/services/ParticipantIdService.ts";
import { prepareStudyExport } from "../src/services/StudyExportPreparation.ts";
import { buildStudyResult } from "../src/services/StudyResultBuilder.ts";
import { loadCaptureSessionFiles } from "../src/services/CaptureFileImportService.ts";
import { createSyntheticJpeg } from "./fixtures/syntheticMedia.mjs";
import * as ble from "../src/services/CaptureDeviceBleService.ts";

const currentKey = "capture-tool.surveyTemplate";
// These literals intentionally verify backward compatibility with older versions.
const legacyKey = "pic2-survey-template";
const legacyCounter = "pic2.nextParticipantNumber";
const legacyLock = "pic2.participantExport";
const survey = { pages: [{ name: "__capture_template__", title: "Reflexão", elements: [
    { type: "text", name: "c_nota_aberta", title: "O que sentiu?" }
] }] };
const stored = name => ({ fileName: name, uploadedAt: "2026-09-16T10:00:00Z", survey });

function storageFixture(t, entries = []) {
    const values = new Map(entries);
    const storage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else delete globalThis.localStorage;
    });
    return { values, storage };
}

test("legacy questionnaire migrates exact bytes, authored text and metadata without deleting its old copy", t => {
    const json = JSON.stringify(stored("questionário.json"), null, 2);
    const { values } = storageFixture(t, [[legacyKey, json]]);
    assert.deepEqual(loadStoredTemplate(), JSON.parse(json));
    assert.equal(values.get(currentKey), json);
    assert.equal(values.get(legacyKey), json);
    assert.deepEqual(loadTemplate(), survey);
});

test("new questionnaire selection wins over a stale legacy copy", t => {
    const old = JSON.stringify(stored("old.json"));
    const current = JSON.stringify(stored("current.json"));
    const { values } = storageFixture(t, [[legacyKey, old], [currentKey, current]]);
    assert.equal(loadStoredTemplate().fileName, "current.json");
    saveTemplate("replacement.json", survey);
    assert.equal(loadStoredTemplate().fileName, "replacement.json");
    assert.equal(values.get(legacyKey), old);
});

test("legacy questionnaire stays usable when migration storage writes are denied", t => {
    const json = JSON.stringify(stored("old.json"));
    const { values, storage } = storageFixture(t, [[legacyKey, json]]);
    storage.setItem = () => { throw new DOMException("Denied", "QuotaExceededError"); };
    assert.deepEqual(loadTemplate(), survey);
    assert.equal(values.get(legacyKey), json);
    assert.equal(values.has(currentKey), false);
});

test("invalid legacy questionnaires are preserved but never promoted", t => {
    const { values } = storageFixture(t);
    for (const json of ["{", JSON.stringify({}), JSON.stringify({ ...stored("invalid.json"), survey: { pages: [] } })]) {
        values.set(legacyKey, json);
        assert.throws(() => loadStoredTemplate());
        assert.equal(values.get(legacyKey), json);
        assert.equal(values.has(currentKey), false);
    }
});

test("invalid current selection is reported without silently replacing it with legacy data", t => {
    const { values } = storageFixture(t, [[currentKey, "{"], [legacyKey, JSON.stringify(stored("old.json"))]]);
    assert.throws(() => loadStoredTemplate(), /could not be read/);
    assert.equal(values.get(currentKey), "{");
});

test("explicit reset clears current and legacy selections so old uploads cannot reappear", t => {
    const { values } = storageFixture(t, [[legacyKey, JSON.stringify(stored("old.json"))]]);
    loadStoredTemplate();
    resetTemplate();
    assert.equal(values.has(legacyKey), false);
    assert.equal(values.has(currentKey), false);
    assert.equal(loadStoredTemplate(), null);
});

test("failed legacy reset retains the current selection", t => {
    const current = JSON.stringify(stored("current.json"));
    const { values, storage } = storageFixture(t, [[legacyKey, JSON.stringify(stored("old.json"))], [currentKey, current]]);
    storage.removeItem = key => {
        if (key === legacyKey) throw new Error("Storage denied");
        values.delete(key);
    };
    assert.throws(() => resetTemplate(), /Storage denied/);
    assert.equal(values.get(currentKey), current);
});

test("participant numbering and export lock remain shared with older tool tabs", async t => {
    const { storage, values } = storageFixture(t, [[legacyCounter, "42"]]);
    assert.equal(peekParticipantId(storage), "P042");
    const original = Object.getOwnPropertyDescriptor(navigator, "locks");
    let lock;
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name, callback) => { lock = name; return callback(); } } });
    t.after(() => {
        if (original) Object.defineProperty(navigator, "locks", original);
        else delete navigator.locks;
    });
    const session = { sessionId: "legacy-session", captures: [] };
    const prepared = await prepareStudyExport(session, id => buildStudyResult({}, session, {}, id), () => true, storage);
    assert.equal(prepared.participantId, "P042");
    assert.equal(values.get(legacyCounter), "43");
    assert.equal(lock, legacyLock);
    // Simulate another older consumer advancing the original key.
    storage.setItem(legacyCounter, "44");
    assert.equal(peekParticipantId(storage), "P044");
});

test("BLE UUID values remain unchanged and match firmware; advertised and filtered names agree", () => {
    const names = ["SERVICE", "MANIFEST", "IMAGE_REQUEST", "IMAGE_INFO", "IMAGE_DATA"];
    const firmware = readFileSync(new URL("../../firmware/src/Config.h", import.meta.url), "utf8");
    for (const [index, name] of names.entries()) {
        const expected = `7f2d000${index + 1}-6f2d-4c32-9a11-2c2c00000001`;
        assert.equal(ble[`CAPTURE_BLE_${name}_UUID`], expected);
        assert.ok(firmware.includes(`CAPTURE_BLE_${name}_UUID[] = "${expected}"`));
    }
    const implementation = readFileSync(new URL("../../firmware/src/BleManager.cpp", import.meta.url), "utf8");
    assert.ok(implementation.includes('BLEDevice::init("MECT-Capture")'));
});

test("browser discovery uses the new device name with the unchanged service UUID", async t => {
    const original = Object.getOwnPropertyDescriptor(navigator, "bluetooth");
    let options;
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: {
        requestDevice: async value => { options = value; throw new DOMException("Cancelled", "NotFoundError"); }
    } });
    t.after(() => {
        if (original) Object.defineProperty(navigator, "bluetooth", original);
        else delete navigator.bluetooth;
    });
    t.mock.method(console, "error", () => {});
    await assert.rejects(ble.loadCaptureDeviceSession(), error => error.kind === "cancelled");
    assert.deepEqual(options, { filters: [{ name: "MECT-Capture" }], optionalServices: [ble.CAPTURE_BLE_SERVICE_UUID] });
});

test("pre-migration SD session metadata and media names remain readable without rewriting data", async t => {
    const manifest = { sessionId: "legacy-session", startedAtMs: 0, finishedAtMs: 1000, captures: [
        { id: "62", mediaType: "photo", file: "IMG_0062.JPG", timestampMs: 500 }
    ] };
    const loaded = await loadCaptureSessionFiles([
        new File([JSON.stringify(manifest)], "session.json"),
        new File([createSyntheticJpeg()], "IMG_0062.JPG", { type: "image/jpeg" })
    ]);
    t.after(() => loaded.objectUrls.forEach(url => URL.revokeObjectURL(url)));
    assert.equal(loaded.session.sessionId, manifest.sessionId);
    assert.equal(loaded.session.captures[0].id, 62);
    assert.equal(loaded.session.captures[0].sourceFile, "IMG_0062.JPG");
    assert.equal(loaded.session.captures[0].timestamp, "00:00:00");
});
