import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCaptureDeviceSession, CaptureDeviceBleError } from '../src/services/CaptureDeviceBleService.ts';

function mockDevice(t, readInfo, withEarlierPhoto = false) {
    const filename = 'IMG_0140.JPG';
    const manifest = { sessionId: 'selection-retry', startedAtMs: 0, finishedAtMs: 2000,
        captures: (withEarlierPhoto ? [139, 140] : [140]).map(id => ({ id, file: `IMG_0${id}.JPG`, mediaType: 'photo', timestampMs: 1000 })) };
    const valid = { file: filename, size: 2, chunkSize: 2, chunkCount: 1 };
    const encode = value => new DataView(new TextEncoder().encode(JSON.stringify(value)).buffer);
    const state = { reads: 0, writes: [], waits: [], dataReads: 0, revoked: [] };
    let selected;
    t.mock.method(globalThis, 'setTimeout', (callback, ms) => { state.waits.push(ms); callback(); return 1; });
    t.mock.method(URL, 'createObjectURL', () => 'blob:transferred-photo');
    t.mock.method(URL, 'revokeObjectURL', url => state.revoked.push(url));
    const device = new EventTarget();
    device.gatt = { connected: true, disconnect() { this.connected = false; }, async connect() {
        return { getPrimaryService: async () => ({ getCharacteristic: async uuid => {
            if (uuid.startsWith('7f2d0002')) return { readValue: async () => encode(manifest) };
            if (uuid.startsWith('7f2d0003')) return { writeValueWithResponse: async bytes => { selected = new TextDecoder().decode(bytes); state.writes.push(selected); } };
            if (uuid.startsWith('7f2d0004')) return { readValue: async () => {
                if (selected !== filename) return encode({ ...valid, file: selected });
                const value = readInfo(++state.reads, valid);
                return value instanceof DataView ? value : encode(value);
            } };
            return { readValue: async () => { state.dataReads++; return new DataView(new Uint8Array([255, 216]).buffer); } };
        } }) };
    } };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    t.after(() => delete navigator.bluetooth);
    return { state, device };
}

for (const transientReads of [0, 1, 5, 15]) {
    test(`image selection succeeds after ${transientReads} transient reads`, async t => {
        const { state, device } = mockDevice(t, (read, valid) => read <= transientReads ? { error: 'No image selected' } : valid);
        const result = await loadCaptureDeviceSession();
        assert.equal(state.reads, transientReads + 1);
        assert.deepEqual(state.waits, Array(transientReads).fill(100));
        assert.deepEqual(state.writes, ['IMG_0140.JPG']);
        assert.equal(state.dataReads, 1);
        assert.equal(result.session.captures[0].sourceFile, 'IMG_0140.JPG');
        assert.equal(device.gatt.connected, true);
        assert.deepEqual(state.revoked, []);
    });
}

test('selection timeout identifies the file and retains existing earlier-photo cleanup', async t => {
    const { state, device } = mockDevice(t, () => ({ error: 'No image selected' }), true);
    await assert.rejects(loadCaptureDeviceSession(), error => error instanceof CaptureDeviceBleError && /Timed out selecting IMG_0140\.JPG.*15 retries/.test(error.message));
    assert.equal(state.reads, 16);
    assert.deepEqual(state.waits, Array(15).fill(100));
    assert.deepEqual(state.writes, ['IMG_0139.JPG', 'IMG_0140.JPG']);
    assert.equal(state.dataReads, 1);
    assert.deepEqual(state.revoked, ['blob:transferred-photo']);
    assert.equal(device.gatt.connected, false);
});

for (const [name, response, message] of [
    ['unrelated device error', () => ({ error: 'Image not found' }), /Image not found/],
    ['malformed JSON', () => new DataView(new TextEncoder().encode('{').buffer), /Invalid image information/],
    ['wrong filename', (_, valid) => ({ ...valid, file: 'OTHER.JPG' }), /instead of IMG_0140.JPG/],
    ['GATT read failure', () => { throw new Error('GATT disconnected'); }, /GATT disconnected/]
]) {
    test(`${name} fails immediately without retry`, async t => {
        const { state, device } = mockDevice(t, response);
        await assert.rejects(loadCaptureDeviceSession(), message);
        assert.equal(state.reads, 1);
        assert.deepEqual(state.waits, []);
        assert.equal(state.dataReads, 0);
        assert.equal(device.gatt.connected, false);
    });
}

test('unrelated error after a transient response stops further retries', async t => {
    const { state } = mockDevice(t, read => ({ error: read === 1 ? 'No image selected' : 'SD read failed' }));
    await assert.rejects(loadCaptureDeviceSession(), /SD read failed/);
    assert.equal(state.reads, 2);
    assert.deepEqual(state.waits, [100]);
});
