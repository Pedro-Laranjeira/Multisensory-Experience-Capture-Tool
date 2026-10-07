import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Model } from "survey-core";
import { parseQuestionnaire, validateQuestionnaire } from "../src/services/QuestionnaireValidation.ts";
import { loadTemplate, saveTemplate } from "../src/services/TemplateManager.ts";
import { buildSurvey } from "../src/services/SurveyTemplateProcessor.ts";
import { buildStudyResult } from "../src/services/StudyResultBuilder.ts";

const captureOnly = () => ({ pages: [{
    name: "__capture_template__",
    elements: [{ type: "html", name: "capture_info" }, { type: "comment", name: "reflection", title: "Your reflection" }]
}] });

test("capture-only questionnaires generate independent reflections and complete without optional sections", () => {
    const template = parseQuestionnaire(JSON.stringify(captureOnly()));
    assert.deepEqual(validateQuestionnaire(template).sections, [{ label: "Per captured moment", questionCount: 1, perCapture: true }]);
    const session = { sessionId: "test", startedAt: "", finishedAt: "", captures: [1, 2, 3].map((id) => ({
        id, mediaType: "photo", file: `blob:photo-${id}`, sourceFile: `IMG_${id}.JPG`, timestamp: "00:00:01", latitude: null, longitude: null
    })) };
    const generated = buildSurvey(template, session);
    assert.deepEqual(generated.pages.map((page) => page.name), ["capture_1", "capture_2", "capture_3"]);
    const model = new Model(generated);
    try {
        model.setValue("capture_1_reflection", "First");
        assert.equal(model.getValue("capture_2_reflection"), undefined);
        assert.equal(model.nextPage(), true);
        model.setValue("capture_2_reflection", "Second");
        assert.equal(model.nextPage(), true);
        model.setValue("capture_3_reflection", "Third");
        model.doComplete();
        assert.equal(model.state, "completed");
        const result = buildStudyResult(model.data, session, generated, "P001");
        assert.deepEqual(result.captures.map((capture) => capture.reflection.reflection), ["First", "Second", "Third"]);
        assert.deepEqual(result.sections, []);
    } finally { model.dispose(); }
});

test("rejects malformed JSON and invalid survey structures", () => {
    assert.throws(() => parseQuestionnaire("{"), /not valid JSON/);
    for (const value of [null, [], {}, { pages: {} }, { pages: [] }, { pages: [null] }, { pages: [{ name: "__capture_template__", elements: {} }] }]) {
        assert.throws(() => validateQuestionnaire(value), /valid questionnaire/);
    }
    const invalid = captureOnly();
    invalid.pages[0].elements[1].type = "not-a-surveyjs-type";
    assert.throws(() => validateQuestionnaire(invalid), /invalid question or setting/);
});

test("rejects missing/duplicate capture sections without requiring specific optional pages", () => {
    assert.throws(() => validateQuestionnaire({ pages: [{ name: "custom", elements: [{ type: "text", name: "q" }] }] }), (error) => {
        assert.match(error.message, /does not contain a capture reflection section/);
        assert.doesNotMatch(error.message, /__capture_template__/);
        assert.match(error.details, /__capture_template__/);
        return true;
    });
    assert.throws(() => validateQuestionnaire({ pages: [captureOnly().pages[0], captureOnly().pages[0]] }), /more than one/);
});

test("capture sections need actual answerable inputs, including through nested panels", () => {
    for (const elements of [[], [{ type: "html", name: "intro" }], [{ type: "expression", name: "calculated", expression: "1" }],
        [{ type: "text", name: "metadata", visible: false }], [{ type: "text", name: "locked", readOnly: true }],
        [{ type: "panel", name: "hiddenPanel", visible: false, elements: [{ type: "text", name: "q" }] }],
        [{ type: "paneldynamic", name: "emptyRepeated", templateElements: [{ type: "html", name: "display" }] }]]) {
        assert.throws(() => validateQuestionnaire({ pages: [{ name: "__capture_template__", elements }] }), /at least one question/);
    }
    const nested = { pages: [{ name: "__capture_template__", elements: [{ type: "panel", name: "panel", elements: [
        { type: "radiogroup", name: "other", choices: ["yes", "no"] },
        { type: "text", name: "answer", visibleIf: "{other} = 'yes'" },
        { type: "html", name: "display" }, { type: "text", name: "metadata", visible: false }
    ] }] }] };
    assert.equal(validateQuestionnaire(nested).sections[0].questionCount, 2);
});

test("summarizes only existing pages, using localized titles and nested question counts", () => {
    const template = captureOnly();
    template.locale = "en";
    template.pages.unshift({ name: "participant_information", title: { en: "Before your walk" }, elements: [{ type: "panel", name: "group", elements: [
        { type: "text", name: "a" }, { type: "radiogroup", name: "b", choices: ["Yes", "No"] }
    ] }] });
    const original = structuredClone(template);
    assert.deepEqual(validateQuestionnaire(template).sections, [
        { label: "Before your walk", questionCount: 2, perCapture: false },
        { label: "Per captured moment", questionCount: 1, perCapture: true }
    ]);
    assert.deepEqual(template, original);
});

test("bundled questionnaire is valid and excludes hidden metadata from the capture count", async () => {
    const template = JSON.parse(await readFile(new URL("../src/survey/template_base.json", import.meta.url), "utf8"));
    assert.deepEqual(validateQuestionnaire(template).sections.map((section) => section.questionCount), [8, 5, 4, 2]);
});

test("invalid replacements never overwrite storage, and invalid legacy templates cannot be loaded", (t) => {
    const entries = new Map();
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
        getItem: (key) => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: (key) => entries.delete(key)
    } });
    t.after(() => {
        if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
        else delete globalThis.localStorage;
    });
    saveTemplate("working.json", captureOnly());
    const before = entries.get("capture-tool.surveyTemplate");
    assert.throws(() => saveTemplate("invalid.json", { pages: [] }));
    assert.equal(entries.get("capture-tool.surveyTemplate"), before);
    assert.deepEqual(loadTemplate(), captureOnly());
    entries.set("capture-tool.surveyTemplate", JSON.stringify({ fileName: "old.json", uploadedAt: "", survey: {} }));
    assert.throws(() => loadTemplate(), /valid questionnaire/);
});

test("default questionnaire download round-trips without replacing the active questionnaire; reset restores the default selection", async t => {
    const { downloadJson } = await import("../src/services/DownloadService.ts");
    const { resetTemplate } = await import("../src/services/TemplateManager.ts");
    const bundled = JSON.parse(await readFile(new URL("../src/survey/template_base.json", import.meta.url), "utf8"));
    const entries = new Map();
    const originals = ["localStorage", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    let downloadedBlob, downloadedName;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
        getItem: key => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: key => entries.delete(key)
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
        body: { appendChild() {} },
        createElement() { return { click() { downloadedName = this.download; }, remove() {} }; }
    } });
    t.after(() => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    t.mock.method(URL, "createObjectURL", blob => { downloadedBlob = blob; return "blob:default-download"; });
    t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(globalThis, "setTimeout", callback => { callback(); return 1; });
    const custom = captureOnly();
    saveTemplate("custom.json", custom);
    downloadJson(bundled, "multisensory-experience-capture-tool-default-questionnaire.json");
    assert.equal(downloadedName, "multisensory-experience-capture-tool-default-questionnaire.json");
    assert.equal(downloadedBlob.type, "application/json");
    const downloaded = parseQuestionnaire(await downloadedBlob.text());
    assert.deepEqual(downloaded, bundled);
    assert.deepEqual(loadTemplate(), custom);
    saveTemplate(downloadedName, downloaded);
    assert.deepEqual(loadTemplate(), bundled);
    resetTemplate();
    assert.equal(loadTemplate(), null); // SurveyLoader uses the bundled default when no upload remains.
});
