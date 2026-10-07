import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { peekParticipantId, consumeParticipantId } from '../src/services/ParticipantIdService.ts';
import { captureExportFilename, createStudyMediaZip } from '../src/services/StudyMediaExporter.ts';
import { prepareStudyExport } from '../src/services/StudyExportPreparation.ts';
import { buildStudyResult } from '../src/services/StudyResultBuilder.ts';
import { validateStudyResult } from '../src/services/StudyResultValidation.ts';
import { importStudyResults } from '../src/services/StudyResultImportService.ts';

function memoryStorage() {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function fixture() {
    const sources = ['IMG_0062.JPG', 'SOUND.WAV', 'MOVIE.WEBM'];
    const types = ['photo', 'audio', 'video'];
    const blobs = sources.map((_, i) => new Blob([`capture bytes ${i}`]));
    const urls = blobs.map(blob => URL.createObjectURL(blob));
    const session = { sessionId: 'test', captures: sources.map((sourceFile, i) => ({ id: i + 62, sourceFile, file: urls[i], mediaType: types[i], timestamp: '00:00:01', latitude: null, longitude: null })) };
    return { session, blobs, cleanup: () => urls.forEach(url => URL.revokeObjectURL(url)), build: id => buildStudyResult({}, session, {}, id) };
}

test('first ID, repeated peek, increments and persisted storage across consumers', () => {
    const storage = memoryStorage();
    assert.equal(peekParticipantId(storage), 'P001');
    assert.equal(peekParticipantId(storage), 'P001');
    consumeParticipantId('P001', storage);
    assert.equal(peekParticipantId({ ...storage }), 'P002');
    consumeParticipantId('P002', { ...storage });
    assert.equal(peekParticipantId(storage), 'P003');
    assert.throws(() => consumeParticipantId('P001', storage), /changed/);
    // Legacy persistent counter intentionally remains shared with older tabs.
    storage.setItem('pic2.nextParticipantNumber', '1000');
    assert.equal(peekParticipantId(storage), 'P1000');
    storage.setItem('pic2.nextParticipantNumber', 'broken');
    assert.throws(() => peekParticipantId(storage), /invalid/);
});

test('safe lowercase extensions, source order and minimum padding', () => {
    for (const ext of ['JPG','JPEG','WAV','MP3','WEBM','MP4']) {
        assert.equal(captureExportFilename('P001', 2, `file.${ext}`, 'photo'), `P001_capture_02.${ext.toLowerCase()}`);
    }
    assert.equal(captureExportFilename('P1000', 123, ' file.JPEG \t', 'photo'), 'P1000_capture_123.jpeg');
    for (const [type, ext] of [['photo','jpg'],['audio','wav'],['video','mp4']]) {
        assert.equal(captureExportFilename('P001', 1, 'unknown.EXE', type), `P001_capture_01.${ext}`);
    }
});

test('schema 2.0, provenance, unique export references and explicit 1.0 import rejection', async () => {
    const f = fixture();
    try {
        const before = structuredClone(f.session);
        const result = f.build('P001');
        assert.equal(validateStudyResult(result), result);
        assert.equal(result.schemaVersion, '2.0');
        assert.deepEqual(result.captures.map(c => c.sourceFile), ['IMG_0062.JPG','SOUND.WAV','MOVIE.WEBM']);
        assert.deepEqual(result.captures.map(c => c.exportFile), ['P001_capture_01.jpg','P001_capture_02.wav','P001_capture_03.webm']);
        assert.deepEqual(f.session, before);
        assert.doesNotMatch(JSON.stringify(result), /blob:/);
        for (const id of ['', ' ', 'participant1', 'P001/']) {
            assert.throws(() => validateStudyResult({ ...result, participantId: id }), /participantId/);
        }
        const duplicate = structuredClone(result);
        duplicate.captures[1].exportFile = duplicate.captures[0].exportFile;
        assert.throws(() => validateStudyResult(duplicate), /unique exportFile/);
        const old = { ...result, schemaVersion: '1.0' };
        assert.throws(() => validateStudyResult(old), /Expected 2.0/);
        const imported = await importStudyResults([new File([JSON.stringify(old)], 'old.json')], []);
        assert.match(imported.errors[0].message, /Expected 2.0/);
    } finally { f.cleanup(); }
});

test('Blob object URLs export exact bytes with one entry per capture without revoking previews', async () => {
    const f = fixture();
    try {
        const result = f.build('P001');
        const zip = await JSZip.loadAsync(await (await createStudyMediaZip(f.session, result)).arrayBuffer());
        assert.deepEqual(Object.keys(zip.files), result.captures.map(c => c.exportFile));
        for (const [i, capture] of result.captures.entries()) {
            assert.equal(await zip.file(capture.exportFile).async('string'), await f.blobs[i].text());
            assert.equal(await (await fetch(f.session.captures[i].file)).text(), await f.blobs[i].text());
        }
    } finally { f.cleanup(); }
});

test('failed media preparation can retry retained answers without consuming an ID; imports do not advance it', async t => {
    const f = fixture(), storage = memoryStorage();
    const answers = { note: 'Completed answer' };
    const build = id => buildStudyResult(answers, f.session, { pages: [{ name: 'final_reflections', elements: [{type:'text', name:'note'}] }] }, id);
    try {
        const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('temporary failure'); });
        await assert.rejects(prepareStudyExport(f.session, build, () => true, storage), /temporary failure/);
        assert.equal(peekParticipantId(storage), 'P001');
        fetchMock.mock.restore();
        const files = await prepareStudyExport(f.session, build, () => true, storage);
        const result = JSON.parse(await files.json.text());
        assert.equal(files.participantId, 'P001');
        assert.deepEqual(result.sections[0].responses, answers);
        assert.equal(peekParticipantId(storage), 'P002');
        await importStudyResults([new File([await files.json.text()], 'P001_result.json')], []);
        assert.equal(peekParticipantId(storage), 'P002');
        await assert.rejects(prepareStudyExport(f.session, build, () => false, storage), /cancelled/);
        assert.equal(peekParticipantId(storage), 'P002');
        const deniedStorage = { ...storage, setItem() { throw new Error('storage unavailable'); } };
        await assert.rejects(prepareStudyExport(f.session, build, () => true, deniedStorage), /storage unavailable/);
        assert.equal(peekParticipantId(storage), 'P002');
    } finally { f.cleanup(); }
});
