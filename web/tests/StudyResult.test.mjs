import test from "node:test";
import assert from "node:assert/strict";
import { buildStudyResult } from "../src/services/StudyResultBuilder.ts";
import { validateStudyResult } from "../src/services/StudyResultValidation.ts";
import { importStudyResults } from "../src/services/StudyResultImportService.ts";
const session = { sessionId: "original-session", captures: [{ id: 1, mediaType: "photo", file: "blob:http://localhost/temporary", sourceFile: "IMG_0041.JPG", timestamp: "00:01:23", latitude: null, longitude: null }] };
const definition = { pages: [
    { name: "participant_information", elements: [{ type: "text", name: "code" }] },
    { name: "capture_1", elements: [{ type: "comment", name: "capture_1_memory" }, { type: "text", name: "capture_1_filename" }] },
    { name: "overall_experience", elements: [{ type: "boolean", name: "repeat" }] },
    { name: "final_reflections", elements: [{ type: "text", name: "notes" }] }
] };
const make = () => buildStudyResult({ code: "P01", capture_1_memory: ["Quiet", "Trees"], capture_1_filename: session.captures[0].file, repeat: false, notes: "Done" }, session, definition, "P001", { name: "walk.json", uploadedAt: "2026-09-05T10:00:00.000Z" });
const file = (value, name = "result.json") => new File([JSON.stringify(value)], name);

test("result metadata and durable sources preserve all existing answer mappings", () => {
    const result = make();
    assert.equal(result.schemaVersion, "2.0");
    assert.match(result.resultId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(result.resultId, make().resultId);
    assert.equal(result.sessionId, session.sessionId);
    assert.ok(Number.isFinite(Date.parse(result.completedAt)));
    assert.equal(result.questionnaire.name, "walk.json");
    assert.deepEqual(result.sections[0].responses, { code: "P01" });
    assert.deepEqual(result.captures[0].reflection, { memory: ["Quiet", "Trees"] });
    assert.deepEqual(result.sections[1].responses, { repeat: false });
    assert.deepEqual(result.sections[2].responses, { notes: "Done" });
    assert.equal(result.captures[0].sourceFile, "IMG_0041.JPG");
    assert.equal("file" in result.captures[0], false);
    assert.doesNotMatch(JSON.stringify(result), /blob:/);
    assert.equal(validateStudyResult(result), result);
    assert.match(session.captures[0].file, /^blob:/);
});
test("optional sections may be absent and missing durable identity fails explicitly", () => {
    const result = buildStudyResult({}, session, { pages: [definition.pages[1]] }, "P001");
    assert.deepEqual(result.sections, []);
    const missing = structuredClone(session); delete missing.captures[0].sourceFile;
    assert.throws(() => buildStudyResult({}, missing, definition, "P001"), /durable/);
    missing.captures[0].file = "/synthetic-capture.jpg";
    assert.equal(buildStudyResult({}, missing, definition, "P001").captures[0].sourceFile, "/synthetic-capture.jpg");
});
test("rejects invalid result metadata, captures, and questionnaire metadata", () => {
    for (const change of [
        r => r.schemaVersion = "99.0", r => delete r.resultId, r => r.sessionId = " ", r => r.completedAt = "yesterday",
        r => r.sections = null, r => r.captures = {}, r => r.captures[0] = null,
        r => r.captures[0].id = 1.5, r => r.captures.push(r.captures[0]),
        r => r.captures[0].mediaType = "other", r => r.captures[0].mediaType = ["photo"], r => r.completedAt = "2026-02-30T10:00:00Z", r => r.captures[0].sourceFile = "blob:http://old",
        r => r.captures[0].sourceFile = "data:image/jpeg;base64,abc", r => r.captures[0].timestamp = "00:99:00",
        r => r.captures[0].latitude = "unknown", r => r.captures[0].longitude = Infinity,
        r => r.captures[0].reflection = [], r => r.questionnaire = "walk", r => r.questionnaire.uploadedAt = "bad"
    ]) { const result = make(); change(result); assert.throws(() => validateStudyResult(result)); }
});
test("batch import retains valid files and existing results; deduplicates only by resultId", async () => {
    const first = make(), second = make();
    const batch = await importStudyResults([file(first), file(first, "copy.json"), file(second), file({}, "wrong.json"), new File(["{"], "broken.json")], []);
    assert.equal(batch.imported, 2); assert.equal(batch.duplicates, 1); assert.equal(batch.errors.length, 2);
    assert.deepEqual(batch.results.map(r => r.resultId), [first.resultId, second.resultId]);
    assert.equal(batch.results[0].sessionId, batch.results[1].sessionId);
    const next = await importStudyResults([file(first), file(null)], batch.results);
    assert.equal(next.imported, 0); assert.equal(next.duplicates, 1); assert.equal(next.errors.length, 1);
    assert.deepEqual(next.results, batch.results);
});

test('generic section validation rejects malformed identities/responses and obsolete development formats', () => {
    for(const change of [
        r=>delete r.sections, r=>r.sections={}, r=>r.sections[0]=null,
        r=>r.sections[0].responses=[], r=>r.sections[0].title=42,
        r=>r.sections[0].name='__capture_template__', r=>r.sections[0].name='capture_1',
        r=>r.sections.push(structuredClone(r.sections[0])), r=>r.schemaVersion='1.1',
        r=>r.participant={}
    ]) {const result=make();change(result);assert.throws(()=>validateStudyResult(result));}
});
