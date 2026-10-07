import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadParticipantPackage } from '../src/services/DownloadService.ts';

for (const failedIndex of [null, 0, 1]) {
    test(`package downloads both prepared files and retries unchanged (failure: ${failedIndex})`, t => {
        const prepared = Object.freeze({ participantId: 'P001', json: new Blob(['{"answers":"retained"}']), zip: new Blob(['prepared zip']) });
        const blobs = [], attempts = [], removed = [], cleanup = [];
        let fail = failedIndex;
        t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return `blob:download-${blobs.length}`; });
        t.mock.method(globalThis, 'setTimeout', callback => { cleanup.push(callback); return 1; });
        const revoked = [];
        t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
        Object.defineProperty(globalThis, 'document', { configurable: true, value: {
            body: { appendChild() {} },
            createElement(tag) {
                assert.equal(tag, 'a');
                return { click() {
                    attempts.push(this.download);
                    if (attempts.length - 1 === fail) throw new Error('download failed');
                }, remove() { removed.push(this.download); } };
            }
        } });
        t.after(() => originalDocument ? Object.defineProperty(globalThis, 'document', originalDocument) : delete globalThis.document);
        if (failedIndex === null) downloadParticipantPackage(prepared);
        else assert.throws(() => downloadParticipantPackage(prepared), AggregateError);
        assert.deepEqual(attempts, ['P001_result.json', 'P001_captures.zip']);
        assert.deepEqual(blobs, [prepared.json, prepared.zip]);
        assert.deepEqual(removed, attempts);
        fail = null;
        downloadParticipantPackage(prepared);
        assert.deepEqual(attempts, ['P001_result.json', 'P001_captures.zip', 'P001_result.json', 'P001_captures.zip']);
        assert.deepEqual(blobs, [prepared.json, prepared.zip, prepared.json, prepared.zip]);
        assert.equal(prepared.participantId, 'P001');
        cleanup.forEach(callback => callback());
        assert.deepEqual(revoked, ['blob:download-1','blob:download-2','blob:download-3','blob:download-4']);
    });
}
