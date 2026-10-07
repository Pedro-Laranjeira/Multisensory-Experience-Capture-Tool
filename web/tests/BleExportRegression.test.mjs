import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { Model } from 'survey-core';
import { loadCaptureDeviceSession } from '../src/services/CaptureDeviceBleService.ts';
import { buildSurvey } from '../src/services/SurveyTemplateProcessor.ts';
import { buildStudyResult } from '../src/services/StudyResultBuilder.ts';
import { prepareStudyExport } from '../src/services/StudyExportPreparation.ts';

test('simulated BLE transfer preserves usable media through questionnaire completion and package preparation', async t => {
    const manifest = { sessionId: 'ble-regression', startedAtMs: 0, finishedAtMs: 2000,
        captures: [62, 63].map(id => ({ id, file: `IMG_${id}.JPG`, mediaType: 'photo', timestampMs: 1000 })) };
    const data = value => new DataView(new TextEncoder().encode(JSON.stringify(value)).buffer);
    const bytes = new Uint8Array([255, 216, 255, 217]);
    let selected;
    const device = new EventTarget();
    device.gatt = { connected: true, disconnect() { this.connected = false; }, async connect() {
        return { getPrimaryService: async () => ({ getCharacteristic: async uuid => {
            if (uuid.startsWith('7f2d0002')) return { readValue: async () => data(manifest) };
            if (uuid.startsWith('7f2d0003')) return { writeValueWithResponse: async value => { selected = new TextDecoder().decode(value); } };
            if (uuid.startsWith('7f2d0004')) return { readValue: async () => data({ file: selected, size: bytes.length, chunkSize: bytes.length, chunkCount: 1 }) };
            return { readValue: async () => new DataView(bytes.buffer) };
        } }) };
    } };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    t.after(() => delete navigator.bluetooth);
    const loaded = await loadCaptureDeviceSession();
    t.after(() => loaded.objectUrls.forEach(url => URL.revokeObjectURL(url)));
    const snapshot = structuredClone(loaded.session);
    const definition = buildSurvey({ pages: [{ name: '__capture_template__', elements: [{ type: 'html', name: 'capture_media' }, { type: 'text', name: 'note' }] }] }, loaded.session);
    const survey = new Model(definition);
    t.after(() => survey.dispose());
    survey.setValue('capture_62_note', 'First answer');
    assert.equal(survey.getValue('capture_63_note'), undefined);
    survey.setValue('capture_63_note', 'Second answer');
    const storageValues = new Map();
    const storage = { getItem: key => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) };
    const files = await prepareStudyExport(loaded.session, id => buildStudyResult(survey.data, loaded.session, definition, id), () => true, storage);
    const result = JSON.parse(await files.json.text());
    const zip = await JSZip.loadAsync(await files.zip.arrayBuffer());
    assert.deepEqual(result.captures.map(c => c.reflection.note), ['First answer', 'Second answer']);
    assert.deepEqual(Object.keys(zip.files), ['P001_capture_01.jpg', 'P001_capture_02.jpg']);
    for (const capture of result.captures) assert.deepEqual(await zip.file(capture.exportFile).async('uint8array'), bytes);
    for (const capture of loaded.session.captures) assert.deepEqual(new Uint8Array(await (await fetch(capture.file)).arrayBuffer()), bytes);
    assert.deepEqual(loaded.session, snapshot);
    assert.equal(device.gatt.connected, true);
});
