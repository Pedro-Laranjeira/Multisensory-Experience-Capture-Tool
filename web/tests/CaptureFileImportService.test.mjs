import JSZip from "jszip";
import { createStudyMediaZip } from "../src/services/StudyMediaExporter.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Model } from "survey-core";
import { loadCaptureSessionFiles, CaptureFileImportError } from "../src/services/CaptureFileImportService.ts";
import { convertManifestToSession } from "../src/services/CaptureSessionManifest.ts";
import { buildSurvey } from "../src/services/SurveyTemplateProcessor.ts";
import { buildStudyResult } from "../src/services/StudyResultBuilder.ts";
import { createSyntheticJpeg, createSilentWav } from "./fixtures/syntheticMedia.mjs";

const jpeg = createSyntheticJpeg();
const manifest = {
    sessionId: "wired-test",
    startedAtMs: 0,
    finishedAtMs: 30000,
    captures: [
        { id: "1", mediaType: "photo", file: "IMG_0030.JPG", timestampMs: 12345 },
        { id: "2", mediaType: "photo", file: "IMG_0031.JPEG", timestampMs: 23456 }
    ]
};
const manifestFile = (value = manifest) => new File([JSON.stringify(value)], "session.json");
const photos = () => manifest.captures.map(({ file }) => new File([jpeg], file, { type: "image/jpeg" }));

test("keeps researcher capture titles and guidance without adding a duplicate prompt", () => {
    const template = { pages: [{
        name: "__capture_template__",
        title: "A moment you noticed",
        description: "Revisit what drew your attention.",
        elements: [{ type: "html", name: "capture_info" }, { type: "text", name: "note" }]
    }] };
    const original = structuredClone(template);
    const session = convertManifestToSession(manifest, new Map([
        ["IMG_0030.JPG", "blob:first"], ["IMG_0031.JPEG", "blob:second"]
    ]), 30000);
    const survey = buildSurvey(template, session);
    assert.deepEqual(template, original);
    for (const page of survey.pages) {
        assert.equal(page.title, "A moment you noticed");
        assert.equal(page.description, "Revisit what drew your attention.");
        assert.doesNotMatch(page.elements[0].html, /Think back to this moment/);
    }
    assert.equal(survey.pages[0].elements[1].name, "capture_1_note");
    assert.equal(survey.pages[1].elements[1].name, "capture_2_note");
});

test("imports unordered JPEG files through the shared adapter and existing survey/export pipeline", async () => {
    const statuses = [];
    const files = photos().reverse();
    const result = await loadCaptureSessionFiles([...files, manifestFile()], (s) => statuses.push(s));
    try {
        assert.deepEqual(statuses, ["Loading session...", "Preparing questionnaire..."]);
        const urls = new Map(result.session.captures.map((c) => [c.sourceFile, c.file]));
        assert.deepEqual(result.session, convertManifestToSession(
            manifest, urls, Date.parse(result.session.finishedAt)
        ));
        for (const capture of result.session.captures) {
            const response = await fetch(capture.file);
            assert.equal(response.headers.get("content-type"), "image/jpeg");
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
            assert.equal(capture.latitude, null);
            assert.equal(capture.longitude, null);
        }
        const template = JSON.parse(await readFile(new URL("../src/survey/template_base.json", import.meta.url), "utf8"));
        const original = structuredClone(template);
        const generated = buildSurvey(template, result.session);
        assert.deepEqual(template, original);
        assert.ok(generated.pages.some((p) => p.name === "capture_1"));
        assert.ok(generated.pages.some((p) => p.name === "capture_2"));
        for (const capture of result.session.captures) {
            const page = generated.pages.find((p) => p.name === `capture_${capture.id}`);
            assert.ok(JSON.stringify(page).includes(capture.file));
            for (const other of result.session.captures.filter(c => c.id !== capture.id)) {
                assert.ok(!page.elements[0].html.includes(other.file));
            }
        }
        const survey = new Model(generated);
        assert.equal(survey.getValue("capture_1_filename"), "IMG_0030.JPG");
        assert.equal(survey.getValue("capture_2_filename"), "IMG_0031.JPEG");
        assert.ok(survey.getQuestionByName("capture_1_c_sentidos"));
        assert.ok(survey.getQuestionByName("capture_2_c_sentidos"));
        const [firstChoice, secondChoice] = survey.getQuestionByName("capture_1_c_sentidos").choices.map((choice) => choice.value);
        survey.setValue("capture_1_c_sentidos", [firstChoice]);
        assert.equal(survey.getValue("capture_2_c_sentidos"), undefined);
        survey.setValue("capture_2_c_sentidos", [secondChoice]);
        assert.deepEqual(survey.getValue("capture_1_c_sentidos"), [firstChoice]);
        const exported = buildStudyResult(survey.data, result.session, generated, "P001");
        const zip = await JSZip.loadAsync(await (await createStudyMediaZip(result.session, exported)).arrayBuffer());
        assert.deepEqual(Object.keys(zip.files), ["P001_capture_01.jpg", "P001_capture_02.jpeg"]);
        for (const entry of Object.values(zip.files)) assert.deepEqual(await entry.async("nodebuffer"), jpeg);
        assert.deepEqual(exported.captures.map((c) => c.sourceFile), ["IMG_0030.JPG", "IMG_0031.JPEG"]);
        assert.deepEqual(exported.captures.map((c) => c.reflection.c_sentidos), [[firstChoice], [secondChoice]]);
    } finally {
        result.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }
});

test("rejects a missing manifest", async () => {
    await assert.rejects(loadCaptureSessionFiles(photos()), /session.json is missing/);
});

test("rejects malformed JSON", async () => {
    await assert.rejects(loadCaptureSessionFiles([new File(["{"], "session.json")]), /malformed JSON/);
});

test("rejects invalid minimum manifest fields", async () => {
    for (const invalid of [null, {}, { ...manifest, finishedAtMs: "30000" }, { ...manifest, captures: [null] }]) {
        await assert.rejects(loadCaptureSessionFiles([manifestFile(invalid)]), /Invalid session.json/);
    }
});

test("lists missing photos and actual selected filenames with unmatched Windows suffixes", async (t) => {
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    let urlsCreated = 0;
    t.mock.method(URL, "createObjectURL", () => { urlsCreated++; });
    const files = [manifestFile(), new File([jpeg], "IMG_0030 (1).JPG")];
    await assert.rejects(
        loadCaptureSessionFiles(files),
        (error) => {
            assert.ok(error instanceof CaptureFileImportError);
            assert.deepEqual(error.diagnostics.required, manifest.captures.map((c) => c.file));
            assert.deepEqual(error.diagnostics.selected, files.map((f) => f.name));
            assert.deepEqual(error.diagnostics.unmatched, ["IMG_0030 (1).JPG"]);
            assert.match(error.message, /IMG_0030.JPG/);
            assert.match(error.message, /IMG_0031.JPEG/);
            return true;
        }
    );
    assert.equal(urlsCreated, 0);
    assert.equal(logs.length, 1);
});

test("matches local names case-insensitively and trims only manifest whitespace, preserving metadata", async () => {
    const value = structuredClone(manifest);
    value.captures[0].file = " IMG_0030.JPG \t";
    const selected = [new File([jpeg], "img_0030.jpg"), new File([jpeg], "img_0031.jpeg")];
    const result = await loadCaptureSessionFiles([manifestFile(value), ...selected]);
    try {
        assert.equal(result.session.captures.length, 2);
        assert.equal(result.session.captures[0].sourceFile, " IMG_0030.JPG \t");
        assert.deepEqual(Buffer.from(await (await fetch(result.session.captures[0].file)).arrayBuffer()), jpeg);
    } finally {
        result.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }
});

test("rejects case-only ambiguity and does not substitute JPEG for JPG", async () => {
    await assert.rejects(loadCaptureSessionFiles([
        manifestFile(), ...photos(), new File([jpeg], "img_0030.jpg")
    ]), /case-insensitive ambiguity/);
    await assert.rejects(loadCaptureSessionFiles([
        manifestFile(), new File([jpeg], "IMG_0030.JPEG"), photos()[1]
    ]), /Missing referenced media files/);
});

test("three-capture imports are atomic when only two matching photos were selected", async (t) => {
    const value = structuredClone(manifest);
    value.captures.push({ id: "3", file: "IMG_0041.JPG", mediaType: "photo", timestampMs: 29000 });
    const create = t.mock.method(URL, "createObjectURL");
    await assert.rejects(loadCaptureSessionFiles([manifestFile(value), ...photos()]), /IMG_0041.JPG/);
    assert.equal(create.mock.callCount(), 0);
});

test("creates URLs from the selected Files themselves", async (t) => {
    const selected = photos();
    const create = t.mock.method(URL, "createObjectURL");
    const result = await loadCaptureSessionFiles([manifestFile(), ...selected]);
    try {
        assert.equal(create.mock.calls[0].arguments[0], selected[0]);
        assert.equal(create.mock.calls[1].arguments[0], selected[1]);
    } finally {
        result.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }
});

test("rejects ambiguous duplicate filenames, including manifests", async () => {
    for (const files of [[manifestFile(), manifestFile()], [manifestFile(), ...photos(), photos()[0]]]) {
        await assert.rejects(loadCaptureSessionFiles(files), /Duplicate filename/);
    }
});

test("rejects unsupported capture types and photo extensions", async () => {
    for (const capture of [
        { ...manifest.captures[0], mediaType: "audio" },
        { ...manifest.captures[0], file: "image.png" }
    ]) {
        await assert.rejects(loadCaptureSessionFiles([manifestFile({ ...manifest, captures: [capture] })]), /Unsupported/);
    }
});

test("rejects invalid or duplicate numeric capture IDs", async () => {
    for (const id of ["", "abc", "01"]) {
        const captures = [manifest.captures[0], { ...manifest.captures[1], id }];
        await assert.rejects(loadCaptureSessionFiles([manifestFile({ ...manifest, captures }), ...photos()]), /must be numeric and unique/);
    }
});

test("revokes already-created URLs when import fails partway through", async (t) => {
    const revoked = [];
    let created = 0;
    t.mock.method(URL, "createObjectURL", () => {
        if (created++) throw new Error("URL allocation failed");
        return "blob:test-first";
    });
    t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
    await assert.rejects(loadCaptureSessionFiles([manifestFile(), ...photos()]), /URL allocation failed/);
    assert.deepEqual(revoked, ["blob:test-first"]);
});

const wav = createSilentWav();
const audioCapture = { id: "2", mediaType: "audio", file: "AUD_0032.WAV", timestampMs: 15000 };

for (const mixed of [false, true]) {
    test(`${mixed ? "mixed photo/audio" : "audio-only"} import preserves order, timestamps, playable anchors and WAV export bytes`, async (t) => {
        const captures = mixed ? [manifest.captures[0], audioCapture,
            { ...manifest.captures[1], id: "3" },
            { ...audioCapture, id: "4", file: "aud_0033.wav", timestampMs: 25000 }] : [audioCapture];
        const value = { ...manifest, captures };
        const selected = captures.map(c => new File([c.mediaType === "audio" ? wav : jpeg],
            c.file.toLowerCase(), { type: c.mediaType === "audio" ? "audio/wav" : "image/jpeg" }));
        const create = t.mock.method(URL, "createObjectURL");
        const loaded = await loadCaptureSessionFiles([manifestFile(value), ...selected.toReversed()]);
        t.after(() => loaded.objectUrls.forEach(url => URL.revokeObjectURL(url)));
        assert.deepEqual(loaded.session.captures.map(c => c.mediaType), captures.map(c => c.mediaType));
        assert.deepEqual(loaded.session.captures.map(c => c.id), captures.map(c => Number(c.id)));
        assert.deepEqual(loaded.session.captures.map(c => c.sourceFile), captures.map(c => c.file));
        assert.equal(loaded.session.captures.find(c => c.mediaType === "audio").timestamp, "00:00:15");
        selected.forEach((file, i) => assert.equal(create.mock.calls[i].arguments[0], file));
        const template = { pages: [{ name: "__capture_template__", elements: [
            { type: "html", name: "capture_info" }, { type: "text", name: "note" }
        ] }] };
        const definition = buildSurvey(template, loaded.session);
        const survey = new Model(definition);
        for (const c of loaded.session.captures) {
            const page = definition.pages.find(p => p.name === `capture_${c.id}`);
            assert.match(page.elements[0].html, c.mediaType === "audio" ? /<audio\s+controls/ : /<img/);
            assert.ok(JSON.stringify(page).includes(c.file));
            survey.setValue(`capture_${c.id}_note`, `Reflection ${c.id}`);
        }
        const result = buildStudyResult(survey.data, loaded.session, definition, "P001");
        assert.equal(result.schemaVersion, "2.0");
        assert.doesNotMatch(JSON.stringify(result), /blob:/);
        const zip = await JSZip.loadAsync(await (await createStudyMediaZip(loaded.session, result)).arrayBuffer());
        for (const [i, c] of result.captures.entries()) {
            assert.equal(c.sourceFile, captures[i].file);
            assert.equal(c.reflection.note, `Reflection ${c.id}`);
            const expected = c.mediaType === "audio" ? wav : jpeg;
            if (c.mediaType === "audio") assert.match(c.exportFile, /\.wav$/);
            assert.deepEqual(await zip.file(c.exportFile).async("nodebuffer"), expected);
            assert.deepEqual(Buffer.from(await (await fetch(loaded.session.captures[i].file)).arrayBuffer()), expected);
        }
    });
}

for (const [mediaType, file, expected] of [
    ["audio", "sound.jpg", /Unsupported audio file.*WAV/],
    ["photo", "photo.wav", /Unsupported photo file.*JPG/],
    ["audio", "sound.mp3", /Unsupported audio file.*WAV/],
    ["audio", "sound.wav.bak", /Unsupported audio file.*WAV/],
    ["video", "movie.mp4", /supports JPEG photos and WAV audio/]
]) {
    test(`rejects ${mediaType} with ${file}`, async () => {
        await assert.rejects(loadCaptureSessionFiles([
            manifestFile({ ...manifest, captures: [{ ...audioCapture, mediaType, file }] }),
            new File([wav], file)
        ]), expected);
    });
}

test("audio matching trims manifest whitespace, preserves source and rejects duplicate WAV selections", async (t) => {
    const value = { ...manifest, captures: [{ ...audioCapture, file: " AUD_0032.WAV \t" }] };
    const selected = new File([wav], "aud_0032.wav");
    const loaded = await loadCaptureSessionFiles([manifestFile(value), selected]);
    t.after(() => loaded.objectUrls.forEach(url => URL.revokeObjectURL(url)));
    assert.equal(loaded.session.captures[0].sourceFile, value.captures[0].file);
    await assert.rejects(loadCaptureSessionFiles([manifestFile(value), selected, new File([wav], "AUD_0032.WAV")]), /case-insensitive ambiguity/);
});

test("missing WAV retains required/selected diagnostics and does not accept a suffixed filename", async () => {
    await assert.rejects(loadCaptureSessionFiles([
        manifestFile({ ...manifest, captures: [audioCapture] }), new File([wav], "AUD_0032 (1).WAV")
    ]), error => {
        assert.match(error.message, /Missing referenced media files.*AUD_0032.WAV/);
        assert.deepEqual(error.diagnostics.required, ["AUD_0032.WAV"]);
        assert.deepEqual(error.diagnostics.selected, ["session.json", "AUD_0032 (1).WAV"]);
        return true;
    });
});
