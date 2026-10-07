import test from "node:test";
import assert from "node:assert/strict";
import { studyResultsToCsv, flattenResponses, escapeCsvCell } from "../src/services/StudyResultCsvExporter.ts";
import { summarizeStudyResults } from "../src/services/StudyResultOverview.ts";

const make = (id = "r1") => ({ schemaVersion: "2.0", participantId: "P001", resultId: id, sessionId: "same-session", completedAt: "2026-09-06T10:00:00Z",
    questionnaire: { name: "walk.json", uploadedAt: "2026-09-05T10:00:00Z" }, sections: [{name:"demographics",responses:{code:"P01",consent:false}}],
    captures: [1,2].map(id => ({ id, mediaType: "photo", sourceFile: `IMG_${id}.JPG`, exportFile: `P001_capture_0${id}.jpg`, timestamp: "00:01:02", latitude: null, longitude: null, reflection: { memory: `Moment ${id}` } })) });
// Independent CSV reader for round-trip assertions, including embedded CR/LF.
function parseCsv(csv) {
    const rows = []; let row = [], cell = "", quoted = false;
    const text = csv.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted;
        } else if (!quoted && (char === ';' || char === '\r')) {
            row.push(cell); cell = "";
            if (char === '\r') { assert.equal(text[++i], '\n'); rows.push(row); row = []; }
        } else cell += char;
    }
    assert.equal(quoted, false);
    return rows;
}
function records(csv) {
    const [headers, ...rows] = parseCsv(csv);
    return { headers, rows: rows.map(row => { assert.equal(row.length, headers.length); return Object.fromEntries(headers.map((h,i) => [h,row[i]])); }) };
}
test("one row per capture repeats participant data and retains capture identity", () => {
    const original = make(), copy = structuredClone(original);
    const csv = studyResultsToCsv([original]); const { headers, rows } = records(csv);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.participantId), ["P001", "P001"]);
    assert.deepEqual(rows.map(row => row["capture.exportFile"]), ["P001_capture_01.jpg", "P001_capture_02.jpg"]);
    assert.deepEqual(rows.map(row => row['sections.demographics.code']), ['P01','P01']);
    assert.deepEqual(rows.map(row => row['reflection.memory']), ['Moment 1','Moment 2']);
    assert.deepEqual(rows.map(row => row['capture.id']), ['1','2']);
    assert.equal(rows[0]['sections.demographics.consent'], 'false');
    assert.equal(rows[0]['capture.latitude'], ''); assert.equal(rows[0]['capture.longitude'], '');
    assert.equal(rows[0]['capture.sourceFile'], 'IMG_1.JPG'); assert.doesNotMatch(csv, /blob:/);
    assert.equal(headers.includes('capture.file'), false);
    assert.equal(csv.charCodeAt(0), 0xFEFF); assert.deepEqual(original, copy);
});
test("arrays, nested values, punctuation and Unicode round-trip without loss", () => {
    const result = make();
    const array = ['one,two', '"quoted"', { detail: 'line\nbreak' }];
    result.captures[0].reflection = { array, metrics: { intensity: 5, nested: { comfort: 4 } }, text: 'Ol\u00e1, "a\u00e7\u00e3o"\r\nnext line', missing: undefined, empty: null };
    const { rows } = records(studyResultsToCsv([result]));
    assert.deepEqual(JSON.parse(rows[0]['reflection.array']), array);
    assert.equal(rows[0]['reflection.metrics.intensity'], '5'); assert.equal(rows[0]['reflection.metrics.nested.comfort'], '4');
    assert.equal(rows[0]['reflection.text'], result.captures[0].reflection.text);
    assert.equal(rows[0]['reflection.missing'], ''); assert.equal(rows[0]['reflection.empty'], '');
    assert.equal(escapeCsvCell('a,"b"\nc'), '"a,""b""\nc"');
});
test("mixed questionnaires union columns in deterministic groups and preserve shared session results", () => {
    const first = make(), second = make('r2');
    first.sections[0].responses = { z: 1 }; second.sections[0].responses = { a: 2 };
    first.captures[0].reflection = { onlyFirst: 'yes' }; second.captures[0].reflection = { onlySecond: 'yes' };
    second.sections.push({name:"overall",responses:{score:3}}, {name:"final",responses:{next:true}});
    const { headers, rows } = records(studyResultsToCsv([first,second]));
    assert.equal(rows.length,4); assert.deepEqual(rows.map(row => row.resultId), ['r1','r1','r2','r2']);
    assert.equal(rows[0]['sections.demographics.a'], ''); assert.equal(rows[2]['sections.demographics.z'], '');
    assert.equal(rows[0]['reflection.onlyFirst'], 'yes'); assert.equal(rows[2]['reflection.onlySecond'], 'yes');
    assert.equal(rows[2]['sections.overall.score'], '3'); assert.equal(rows[3]['sections.final.next'], 'true');
    assert.ok(headers.indexOf('sections.demographics.a') < headers.indexOf('sections.demographics.z'));
    assert.ok(headers.indexOf('sections.demographics.z') < headers.indexOf('capture.id'));
    assert.ok(headers.indexOf('capture.longitude') < headers.indexOf('reflection.onlyFirst'));
    assert.ok(headers.indexOf('sections.overall.score') < headers.indexOf('capture.id'));
    assert.ok(headers.indexOf('sections.final.next') < headers.indexOf('sections.overall.score'));
    assert.deepEqual(records(studyResultsToCsv([second, first])).headers, headers);
});
test("literal dots and backslashes do not collide with nested keys", () => {
    const flat = flattenResponses({ 'a.b': 1, a: { b: 2 }, 'a\\b': 3, empty: {} }, 'reflection');
    assert.equal(flat.get('reflection.a\\.b'), 1); assert.equal(flat.get('reflection.a.b'), 2);
    assert.equal(flat.get('reflection.a\\\\b'), 3); assert.equal(flat.get('reflection.empty'), '{}');
});

test('ordinary section identities and answer identities retain collision-safe CSV namespaces', () => {
    const result=make();
    result.sections=[{name:'a.b',responses:{'q.x':'one'}},{name:'a',responses:{b:{q:{x:'two'}}}}];
    const {rows}=records(studyResultsToCsv([result]));
    assert.equal(rows[0]['sections.a\\.b.q\\.x'],'one');
    assert.equal(rows[0]['sections.a.b.q.x'],'two');
});
test("empty selections/zero captures fail clearly; empty optional sections work", () => {
    assert.throws(() => studyResultsToCsv([]), /No captured moments/);
    const result = make(); result.sections[0].responses = {}; delete result.questionnaire;
    assert.equal(records(studyResultsToCsv([result])).rows[0].questionnaireName, '');
    result.captures = []; assert.throws(() => studyResultsToCsv([result]), /No captured moments/);
    const invalid = make(); invalid.captures[0].sourceFile = 'blob:http://temporary';
    assert.throws(() => studyResultsToCsv([invalid]), /durable/);
});
test("overview distinguishes results, sessions, metadata configurations and unknown metadata", () => {
    const a = make(), b = make('r2'), c = make('r3'), d = make('r4'), e = make('r5');
    c.questionnaire.uploadedAt = '2026-09-06T10:00:00Z'; c.sessionId = 'another';
    d.questionnaire = { name: 'Bundled default questionnaire' }; delete e.questionnaire;
    assert.deepEqual(summarizeStudyResults([a,b,c,d,e]), { importedResults:5, uniqueSessions:2, capturedMoments:10, questionnaireConfigurations:3, unknownQuestionnaires:1 });
    assert.equal(summarizeStudyResults([]).capturedMoments, 0);
});


test("semicolon-delimited columns preserve commas, escaping, Unicode, BOM and CRLF", () => {
    const values = [
        ['sound, smell, temperature', 'sound, smell, temperature'],
        ['sound; smell', '"sound; smell"'],
        ['say "hello"', '"say ""hello"""'],
        ['line\nnext', '"line\nnext"'],
        ['line\rnext', '"line\rnext"'],
        ['line\r\nnext', '"line\r\nnext"'],
        ['Ol\u00e1, a\u00e7\u00e3o', 'Ol\u00e1, a\u00e7\u00e3o']
    ];
    const result = make();
    result.captures[0].reflection = Object.fromEntries(values.map(([value], i) => [`answer${i}`, value]));
    const csv = studyResultsToCsv([result]);
    assert.ok(csv.startsWith('\uFEFFparticipantId;schemaVersion;resultId;sessionId;'));
    assert.deepEqual([...new TextEncoder().encode(csv).slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(csv.endsWith('\r\n'));
    const { rows } = records(csv);
    assert.equal(rows.length, 2);
    values.forEach(([value, escaped], i) => {
        assert.equal(escapeCsvCell(value), escaped);
        assert.equal(rows[0][`reflection.answer${i}`], value);
    });
    const plainCsv = studyResultsToCsv([make()]);
    assert.equal(plainCsv.split('\r\n').length, 4);
    assert.doesNotMatch(plainCsv.replace(/\r\n/g, ''), /[\r\n]/);
});

function choiceDefinition(result, captureQuestions, sectionQuestions = []) {
    return { metadata: { ...result.questionnaire }, survey: { pages: [
        { name: "demographics", elements: sectionQuestions },
        { name: "__capture_template__", elements: [{ type: "panel", name: "nested", elements: captureQuestions }] }
    ] } };
}

test("CSV resolves custom single and multiple choices in sections and independent captures without mutation", () => {
    const result = make();
    result.sections[0].responses.mood = "custom-positive";
    result.captures[0].reflection = { pleasant: "item1", sounds: ["bird-code", "wind-code"] };
    result.captures[1].reflection = { pleasant: "item2", sounds: ["wind-code"] };
    const definition = choiceDefinition(result, [
        { name: "pleasant", type: "radiogroup", choices: [{ value: "item1", text: "Very pleasant" }, { value: "item2", text: "Unpleasant" }] },
        { name: "sounds", type: "checkbox", choices: [{ value: "bird-code", text: "Birdsong" }, { value: "wind-code", text: "Wind in the trees" }] }
    ], [{ name: "mood", type: "dropdown", choices: [{ value: "custom-positive", text: "Feeling good" }] }]);
    const before = structuredClone({ result, definition });
    const { rows } = records(studyResultsToCsv([result], [definition]));
    assert.deepEqual(rows.map(row => row["reflection.pleasant"]), ["Very pleasant", "Unpleasant"]);
    assert.deepEqual(rows.map(row => row["reflection.sounds"]), ["Birdsong; Wind in the trees", "Wind in the trees"]);
    assert.deepEqual(rows.map(row => row["sections.demographics.mood"]), ["Feeling good", "Feeling good"]);
    assert.deepEqual({ result, definition }, before);
});

test("CSV preserves text, comments, Other input, ordinary values and unmatched choices", () => {
    const result = make();
    result.captures[0].reflection = {
        text: "item1", comment: "item1", count: 0, consent: false, date: "2026-09-23",
        choice: "unknown", multi: ["item1", "unknown", "other"], "multi-Comment": "A passing tram",
        other: "User-entered choice", "other-customComment": "item1", empty: null
    };
    const choices = [{ value: "item1", text: "Birdsong" }];
    const definition = choiceDefinition(result, [
        { name: "text", type: "text", choices }, { name: "comment", type: "comment", choices },
        { name: "choice", type: "dropdown", choices }, { name: "multi", type: "checkbox", choices, showOtherItem: true },
        { name: "other", type: "radiogroup", choices, showOtherItem: true, storeOthersAsComment: false }
    ]);
    const row = records(studyResultsToCsv([result], [definition])).rows[0];
    for (const key of ["text", "comment", "date", "choice", "multi-Comment", "other", "other-customComment"]) {
        assert.equal(row[`reflection.${key}`], result.captures[0].reflection[key]);
    }
    assert.equal(row["reflection.multi"], "Birdsong; unknown; other");
    assert.equal(row["reflection.count"], "0");
    assert.equal(row["reflection.consent"], "false");
    assert.equal(row["reflection.empty"], "");
});

test("CSV choice labels round-trip commas, quotes, semicolons, newlines and Unicode", () => {
    const result = make();
    const labels = ['Birds, nearby', 'A "quiet" spot', 'Wind; trees', 'Line\r\nnext', 'Ol\u00e1'];
    const choices = labels.map((text, value) => ({ value, text }));
    result.captures[0].reflection = { multi: choices.map(c => c.value), single: 1 };
    const definition = choiceDefinition(result, [{ name: "multi", type: "checkbox", choices }, { name: "single", type: "dropdown", choices }]);
    const csv = studyResultsToCsv([result], [definition]);
    const row = records(csv).rows[0];
    assert.equal(row["reflection.multi"], labels.join("; "));
    assert.equal(row["reflection.single"], labels[1]);
    assert.ok(csv.includes('"A ""quiet"" spot"'));
});

test("CSV selects definitions by questionnaire identity and keeps raw values when unavailable", () => {
    const first = make(), second = make("r2");
    second.questionnaire.uploadedAt = "2026-09-07T10:00:00Z";
    for (const result of [first, second]) result.captures[0].reflection = { q: "item1", multi: ["item1"] };
    const definition = (result, text) => choiceDefinition(result, [
        { name: "q", type: "dropdown", choices: [{ value: "item1", text }] },
        { name: "multi", type: "checkbox", choices: [{ value: "item1", text }] }
    ]);
    const firstDefinition = definition(first, "First label"), secondDefinition = definition(second, "Second label");
    const { rows } = records(studyResultsToCsv([first, second], [secondDefinition, firstDefinition]));
    assert.equal(rows[0]["reflection.q"], "First label");
    assert.equal(rows[2]["reflection.q"], "Second label");
    const missing = records(studyResultsToCsv([second], [firstDefinition])).rows[0];
    assert.equal(missing["reflection.q"], "item1");
    assert.deepEqual(JSON.parse(missing["reflection.multi"]), ["item1"]);
});

test("CSV shares Summary locale and primitive choice-label resolution", () => {
    const result = make();
    result.captures[0].reflection = { q: "custom", multi: ["plain", 42, false] };
    const definition = choiceDefinition(result, [
        { name: "q", type: "dropdown", choices: [{ value: "custom", text: { default: "Default", en: "English label" } }] },
        { name: "multi", type: "checkbox", choices: ["plain", { value: 42, text: "Forty-two" }, { value: false, text: "No selection" }] }
    ]);
    definition.survey.locale = "en";
    const row = records(studyResultsToCsv([result], [definition])).rows[0];
    assert.equal(row["reflection.q"], "English label");
    assert.equal(row["reflection.multi"], "plain; Forty-two; No selection");
});


test("default question headers remain stable in an extended researcher questionnaire", () => {
    const result = make();
    result.sections = [{ name: "participant_information", responses: { p1_idade: "25-34" } }];
    result.captures[0].reflection = { c_sentidos: ["sound"], "c_sentidos-Comment": "A tram" };
    const definition = choiceDefinition(result, [{ name: "c_sentidos", type: "checkbox", title: "Edited senses title", choices: [{ value: "sound", text: "Sound" }] }]);
    definition.survey.pages.push({ name: "participant_information", elements: [{ name: "p1_idade", type: "dropdown", title: "Edited age title" }] });
    const { headers, rows } = records(studyResultsToCsv([result], [definition]));
    assert.ok(headers.includes("sections.participant_information.p1_idade"));
    assert.ok(headers.includes("reflection.c_sentidos"));
    assert.ok(headers.includes("reflection.c_sentidos-Comment"));
    assert.equal(rows[0]["reflection.c_sentidos"], "Sound");
});

test("custom question titles label CSV headers regardless of their names and retain formatted answers", () => {
    const result = make();
    result.sections[0].responses = { personal_comfort: "item1" };
    result.captures[0].reflection = { question1: ["item1", "item2"], "question1-Comment": "Passing tram" };
    const choices = [{ value: "item1", text: "Birdsong" }, { value: "item2", text: "Wind" }];
    const definition = choiceDefinition(result,
        [{ name: "question1", type: "checkbox", title: "What did you hear?", choices }],
        [{ name: "personal_comfort", type: "dropdown", title: "How comfortable did you feel in this space?", choices }]);
    const before = structuredClone(result);
    const { headers, rows } = records(studyResultsToCsv([result], [definition]));
    assert.ok(headers.includes("What did you hear?"));
    assert.ok(headers.includes("How comfortable did you feel in this space?"));
    assert.equal(rows[0]["What did you hear?"], "Birdsong; Wind");
    assert.equal(rows[0]["How comfortable did you feel in this space?"], "Birdsong");
    assert.equal(rows[0]["What did you hear?-Comment"], "Passing tram");
    assert.deepEqual(result, before);
});

test("custom missing, blank and unusable titles fall back to existing name-based headers", () => {
    const result = make();
    result.captures[0].reflection = { missing: "a", blank: "b", invalid: "c" };
    const definition = choiceDefinition(result, [
        { name: "missing", type: "text" }, { name: "blank", type: "text", title: "   " },
        { name: "invalid", type: "text", title: 42 }
    ]);
    const { headers, rows } = records(studyResultsToCsv([result], [definition]));
    for (const [name, value] of Object.entries(result.captures[0].reflection)) {
        assert.ok(headers.includes(`reflection.${name}`));
        assert.equal(rows[0][`reflection.${name}`], value);
    }
    assert.ok(headers.every(header => header.trim()));
});

test("custom localized title headers round-trip CSV punctuation and nested answer suffixes", () => {
    const result = make();
    const title = 'Comfort, "quiet"; why?\r\nTell us';
    result.captures[0].reflection = { question1: "Unchanged free text", metrics: { score: 3 } };
    const definition = choiceDefinition(result, [
        { name: "question1", type: "text", title: { default: "Fallback", en: title } },
        { name: "metrics", type: "matrix", title: "Custom evaluation" }
    ]);
    definition.survey.locale = "en";
    const csv = studyResultsToCsv([result], [definition]);
    const { headers, rows } = records(csv);
    assert.ok(headers.includes(title));
    assert.ok(csv.includes('"Comfort, ""quiet""; why?\r\nTell us"'));
    assert.equal(rows[0][title], "Unchanged free text");
    assert.equal(rows[0]["Custom evaluation.score"], "3");
});

test("duplicate, reserved and conflicting questionnaire titles retain unambiguous column identities", () => {
    const result = make();
    result.captures[0].reflection = { a: "A", b: "B", c: "C" };
    const definition = choiceDefinition(result, [
        { name: "a", title: "Same" }, { name: "b", title: "Same" }, { name: "c", title: "participantId" }
    ]);
    const { headers, rows } = records(studyResultsToCsv([result], [definition]));
    assert.equal(new Set(headers).size, headers.length);
    assert.equal(rows[0]["reflection.a"], "A");
    assert.equal(rows[0]["reflection.b"], "B");
    assert.equal(rows[0]["reflection.c"], "C");
    const second = structuredClone(result);
    second.resultId = "r2";
    second.questionnaire.uploadedAt = "2026-09-07T10:00:00Z";
    const otherDefinition = choiceDefinition(second, [{ name: "a", title: "Different title" }]);
    const combined = records(studyResultsToCsv([result, second], [definition, otherDefinition]));
    assert.equal(combined.rows[2]["reflection.a"], "A");
    assert.deepEqual(combined.headers, records(studyResultsToCsv([second, result], [definition, otherDefinition])).headers);
});
