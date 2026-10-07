import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCaptureDeviceSession } from '../src/services/CaptureDeviceBleService.ts';

function deviceFixture(t, captures, payloads, errorFile) {
    const encode = v => new DataView(new TextEncoder().encode(JSON.stringify(v)).buffer);
    let selected, offset = 0, pending = false;
    const writes = [], reads = [];
    const device = new EventTarget();
    t.mock.method(globalThis, 'setTimeout', callback => { callback(); return 1; });
    device.gatt = { connected: true, disconnect() { this.connected = false; }, async connect() {
        return { getPrimaryService: async () => ({ getCharacteristic: async uuid => {
            if (uuid.startsWith('7f2d0002')) return { readValue: async () => encode({ sessionId: 'mixed', startedAtMs: 0, finishedAtMs: 30000, captures }) };
            if (uuid.startsWith('7f2d0003')) return { writeValueWithResponse: async bytes => {
                selected = new TextDecoder().decode(bytes); offset = 0; pending = true; writes.push(selected);
            } };
            if (uuid.startsWith('7f2d0004')) return { readValue: async () => {
                if (pending) { pending = false; return encode({ error: 'No image selected' }); }
                if (selected === errorFile) return encode({ error: 'Media file not found' });
                return encode({ file: selected, size: payloads[selected].length, chunkSize: 180, chunkCount: Math.ceil(payloads[selected].length / 180) });
            } };
            return { readValue: async () => {
                const bytes = payloads[selected].slice(offset, offset + 180);
                reads.push([selected, offset]); offset += bytes.length;
                return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            } };
        } }) };
    } };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    t.after(() => delete navigator.bluetooth);
    return { writes, reads, device };
}
const capture = (id, mediaType, file) => ({ id, mediaType, file, timestampMs: id * 1000 });

test('mixed BLE transfers preserve MIME, exact large WAV bytes, manifest order and sequential offsets', async t => {
    const captures = [capture(1, 'photo', 'IMG_0001.JPG'), capture(2, 'audio', 'AUD_0001.WAV'), capture(3, 'photo', 'IMG_0002.JPEG'), capture(4, 'audio', 'AUD_0002.wav')];
    // Exceeds the former 20,000-read ceiling; final chunk is partial.
    const payloads = Object.fromEntries(captures.map((c, i) => [c.file, Uint8Array.from({ length: i === 1 ? 3600187 : 367 + i }, (_, j) => (j * 17 + i) % 256)]));
    const f = deviceFixture(t, captures, payloads);
    const statuses = [];
    const loaded = await loadCaptureDeviceSession({ onStatus: status => statuses.push(status) });
    assert.deepEqual(statuses, [
        'Loading session...',
        'Downloading capture 1 of 4...',
        'Downloading capture 2 of 4...',
        'Downloading capture 3 of 4...',
        'Downloading capture 4 of 4...',
        'Preparing questionnaire...'
    ]);
    t.after(() => loaded.objectUrls.forEach(url => URL.revokeObjectURL(url)));
    assert.deepEqual(f.writes, captures.map(c => c.file));
    assert.deepEqual(loaded.session.captures.map(c => c.mediaType), captures.map(c => c.mediaType));
    assert.deepEqual(loaded.session.captures.map(c => c.sourceFile), captures.map(c => c.file));
    for (const c of loaded.session.captures) {
        const response = await fetch(c.file);
        assert.equal(response.headers.get('content-type'), c.mediaType === 'audio' ? 'audio/wav' : 'image/jpeg');
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payloads[c.sourceFile]);
        assert.equal(f.reads.find(r => r[0] === c.sourceFile)[1], 0);
    }
});
for (const [type, file] of [['video', 'MOV_0001.MP4'], ['audio', 'AUD_0001.JPG'], ['photo', 'IMG_0001.WAV'], ['audio', 'AUD_0001.MP3']]) {
    test(`BLE rejects ${type}/${file} before request`, async t => {
        const f = deviceFixture(t, [capture(1, type, file)], {});
        await assert.rejects(loadCaptureDeviceSession(), /Unsupported/);
        assert.deepEqual(f.writes, []);
        assert.equal(f.device.gatt.connected, false);
    });
}
test('missing WAV reports filename and disconnects; a new attempt succeeds', async t => {
    const captures = [capture(1, 'audio', 'AUD_0001.WAV')];
    const f = deviceFixture(t, captures, {}, captures[0].file);
    await assert.rejects(loadCaptureDeviceSession(), /AUD_0001.WAV.*Media file not found/);
    assert.equal(f.device.gatt.connected, false);
    deviceFixture(t, captures, { 'AUD_0001.WAV': new Uint8Array(181) });
    const loaded = await loadCaptureDeviceSession();
    t.after(() => loaded.objectUrls.forEach(url => URL.revokeObjectURL(url)));
    assert.equal((await (await fetch(loaded.session.captures[0].file)).arrayBuffer()).byteLength, 181);
});
