import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Model } from 'survey-core';
import { validateQuestionnaire } from '../src/services/QuestionnaireValidation.ts';
import { buildSurvey } from '../src/services/SurveyTemplateProcessor.ts';
import { buildStudyResult } from '../src/services/StudyResultBuilder.ts';
import { studyResultsToCsv } from '../src/services/StudyResultCsvExporter.ts';
import { importStudyResults } from '../src/services/StudyResultImportService.ts';
import { buildResultsSummary } from '../src/services/StudyResultSummary.ts';

const bundled = JSON.parse(readFileSync(new URL('../src/survey/template_base.json', import.meta.url), 'utf8'));
const session = { sessionId: 'integrity', captures: [1, 2].map(id => ({ id, mediaType: 'photo', file: `blob:${id}`, sourceFile: `IMG_${id}.JPG`, timestamp: '00:00:01', latitude: null, longitude: null })) };
const capture = elements => ({ pages: [{ name: '__capture_template__', elements }] });

test('actual bundled Other explanations remain independent through StudyResult, JSON, CSV, summary and import', async () => {
    const before = structuredClone(bundled);
    validateQuestionnaire(bundled);
    const generated = buildSurvey(bundled, session), model = new Model(generated);
    try {
        const profile = model.getQuestionByName('p1_genero');
        profile.value = 'other'; profile.comment = 'Profile explanation — João';
        for (const id of [1, 2]) {
            const q = model.getQuestionByName(`capture_${id}_c_sentidos`);
            q.value = ['other']; q.comment = `Distinct explanation for capture ${id}`;
        }
        const result = buildStudyResult(model.data, session, generated, 'P001');
        assert.equal(result.sections[0].responses.p1_genero, 'other');
        assert.equal(result.sections[0].responses['p1_genero-Comment'], profile.comment);
        assert.deepEqual(result.captures.map(c => c.reflection.c_sentidos), [['other'], ['other']]);
        assert.deepEqual(result.captures.map(c => c.reflection['c_sentidos-Comment']), ['Distinct explanation for capture 1', 'Distinct explanation for capture 2']);
        const json = JSON.stringify(result), csv = studyResultsToCsv([result]);
        for (const text of [profile.comment, 'Distinct explanation for capture 1', 'Distinct explanation for capture 2']) {
            assert.ok(json.includes(text)); assert.ok(csv.includes(text));
        }
        assert.ok(csv.includes('sections.participant_information.p1_genero-Comment'));
        assert.ok(csv.includes('reflection.c_sentidos-Comment'));
        const imported = await importStudyResults([new File([json], 'P001_result.json')], []);
        assert.deepEqual(imported.results, [result]);
        assert.ok(JSON.stringify(buildResultsSummary([result])).includes('Distinct explanation for capture 2'));
        const historical = structuredClone(result);
        delete historical.sections[0].responses['p1_genero-Comment'];
        historical.captures.forEach(c => delete c.reflection['c_sentidos-Comment']);
        const old = await importStudyResults([new File([JSON.stringify(historical)], 'historical.json')], []);
        assert.equal(old.imported, 1);
        assert.equal(result.schemaVersion, '2.0');
        assert.deepEqual(bundled, before);
    } finally { model.dispose(); }
});

test('question comments and comment-enabled choices are preserved as separate fields', () => {
    const template = capture([{ type: 'radiogroup', name: 'choice', choices: ['yes'], showCommentArea: true }]);
    validateQuestionnaire(template);
    const generated = buildSurvey(template, session), model = new Model(generated);
    try {
        const q = model.getQuestionByName('capture_1_choice');
        q.value = 'yes'; q.comment = 'Explanation without Other';
        const result = buildStudyResult(model.data, session, generated, 'P001');
        assert.equal(result.captures[0].reflection.choice, 'yes');
        assert.equal(result.captures[0].reflection['choice-Comment'], q.comment);
        assert.equal(result.captures[1].reflection['choice-Comment'], undefined);
    } finally { model.dispose(); }
});

test('canonical pages and instruction-only additional pages remain accepted', () => {
    const template = structuredClone(bundled);
    template.pages.unshift({ name: 'instructions', elements: [{ type: 'panel', name: 'guidance', elements: [{ type: 'html', name: 'intro', html: '<p>Read this first.</p>' }, { type: 'image', name: 'illustration', imageLink: 'local.png' }] }] });
    validateQuestionnaire(template);
    assert.equal(buildSurvey(template, session).pages[0].name, 'instructions');
});

test('custom answer-bearing pages, including hidden/nested inputs, are accepted and preserved', () => {
    const template = structuredClone(bundled);
    template.pages.unshift({name:'custom_section',elements:[{type:'panel',name:'panel',elements:[{type:'text',name:'custom_answer'}]}]});
    validateQuestionnaire(template);
    const result = buildStudyResult({custom_answer:'Preserved'},session,buildSurvey(template,session),'P001');
    assert.deepEqual(result.sections[0],{name:'custom_section',responses:{custom_answer:'Preserved'}});
});

test('duplicate names and shared valueName reject with actionable messages', () => {
    assert.throws(() => validateQuestionnaire(capture([{ type: 'text', name: 'q' }, { type: 'panel', name: 'p', elements: [{ type: 'text', name: 'q' }] }])), /names must be unique/);
    assert.throws(() => validateQuestionnaire(capture([{ type: 'text', name: 'q', valueName: 'shared' }])), /valueName.*Remove/);
    assert.throws(() => validateQuestionnaire(capture([{ type: 'text', name: 'q' }, { type: 'text', name: 'q-Comment' }])), /conflicts with the comment field/);
});

test('capture-local visibility, enabling and required conditions work independently with global references intact', () => {
    const template = capture([
        { type: 'radiogroup', name: 'choice', choices: ['yes', 'no'] },
        { type: 'text', name: 'detail', visibleIf: "{choice} = 'yes'", enableIf: "{global} = 'ready'", requiredIf: "{choice} = 'yes'" }
    ]);
    template.pages.unshift({ name: 'participant_information', elements: [{ type: 'text', name: 'global' }] });
    const before = structuredClone(template);
    validateQuestionnaire(template);
    const generated = buildSurvey(template, session), model = new Model(generated);
    try {
        model.setValue('global', 'ready'); model.setValue('capture_1_choice', 'yes'); model.setValue('capture_2_choice', 'no');
        const first = model.getQuestionByName('capture_1_detail'), second = model.getQuestionByName('capture_2_detail');
        assert.equal(first.isVisible, true); assert.equal(second.isVisible, false);
        assert.equal(first.isReadOnly, false); assert.equal(first.isRequired, true);
        assert.equal(first.validate(), false);
        model.setValue('capture_1_detail', 'First explanation');
        assert.equal(first.validate(), true);
        model.setValue('global', 'blocked'); assert.equal(first.isReadOnly, true);
        const result = buildStudyResult(model.data, session, generated, 'P001');
        assert.equal(result.captures[0].reflection.detail, 'First explanation');
        assert.equal(result.captures[1].reflection.detail, undefined);
        assert.deepEqual(template, before);
    } finally { model.dispose(); }
});

test('unsafe capture expressions and indirect/scoped bindings reject instead of guessing', () => {
    for (const options of [
        { visibleIf: "sum({q}) > 1" }, { visibleIf: "{row.q} = 'yes'" },
        { visibleIf: "{unknown} = 'yes'" }, { defaultValueExpression: '{q}' },
        { choicesFromQuestion: 'q' }
    ]) assert.throws(() => validateQuestionnaire(capture([{ type: 'text', name: 'q' }, { type: 'text', name: 'detail', ...options }])), /unsupported|support only/);
    assert.throws(() => validateQuestionnaire(capture([{ type: 'paneldynamic', name: 'repeated', templateElements: [{ type: 'text', name: 'q' }] }])), /Dynamic capture templates/);
    assert.throws(() => validateQuestionnaire(capture([{ type: 'text', name: 'q', visibleIf: '{q} =' }])), /invalid syntax/);
    const suffix = capture([{ type: 'text', name: 'q' }]);
    suffix.commentSuffix = '_note';
    assert.throws(() => validateQuestionnaire(suffix), /Custom comment suffixes/);
});

test('quoted brace literals are not mistaken for capture references', () => {
    const template = capture([{ type: 'text', name: 'q' }, { type: 'text', name: 'detail', visibleIf: "{q} = '{q}'" }]);
    validateQuestionnaire(template);
    const generated = buildSurvey(template, session);
    assert.equal(generated.pages[0].elements[1].visibleIf, "{capture_1_q} = '{q}'");
});

test('duplicate canonical pages, editable metadata and external capture conditions reject', () => {
    const duplicate = structuredClone(bundled);
    duplicate.pages.push(structuredClone(duplicate.pages[0]));
    assert.throws(() => validateQuestionnaire(duplicate), /page names must be unique/);
    assert.throws(() => validateQuestionnaire(capture([{ type: 'text', name: 'filename' }])), /metadata field filename must remain hidden/);
    const external = capture([{ type: 'text', name: 'q' }]);
    external.pages.push({ name: 'final_reflections', elements: [{ type: 'text', name: 'final', visibleIf: "{q} = 'yes'" }] });
    assert.throws(() => validateQuestionnaire(external), /outside the capture template/);
});

test('one-question capture-only template yields five independent reflections and zero ordinary sections', () => {
    const template = capture([{type:'comment',name:'one_question'}]);
    validateQuestionnaire(template);
    const five = {...session,captures:Array.from({length:5},(_,i)=>({...session.captures[0],id:i+1,sourceFile:`IMG_${i+1}.JPG`}))};
    const generated = buildSurvey(template,five), model = new Model(generated);
    try {
        for (let id=1;id<=5;id++) model.setValue(`capture_${id}_one_question`,`Answer ${id}`);
        const result = buildStudyResult(model.data,five,generated,'P001');
        assert.deepEqual(result.sections,[]);
        assert.deepEqual(result.captures.map(c=>c.reflection.one_question),['Answer 1','Answer 2','Answer 3','Answer 4','Answer 5']);
    } finally {model.dispose();}
});

test('seven ordinary sections retain identity, order, comments and values through JSON/import/summary/CSV without matching definitions', async () => {
    const names=['demographics','pre_walk','accessibility','environment','post_walk','researcher_notes','extra'];
    const pages=names.map((name,index)=>({name,title:index<2?'Same authored title':`Section ${index}`,elements:[{type:'radiogroup',name:`q${index}`,choices:['yes'],showOtherItem:true}]}));
    pages.splice(2,0,capture([{type:'comment',name:'memory'}]).pages[0]);
    const template={pages};validateQuestionnaire(template);
    const generated=buildSurvey(template,session),model=new Model(generated);
    try {
        names.forEach((_,i)=>{const q=model.getQuestionByName(`q${i}`);q.value='other';q.comment=`Explanation ${i} — café`;});
        const result=buildStudyResult(model.data,session,generated,'P001');
        assert.deepEqual(result.sections.map(s=>s.name),names);
        assert.equal(result.sections.length,7);
        assert.equal('participant' in result,false);
        const imported=await importStudyResults([new File([JSON.stringify(result)],'generic.json')],[]);
        assert.deepEqual(imported.results,[result]);
        const summary=buildResultsSummary(imported.results)[0];
        assert.deepEqual(summary.sections.map(s=>s.key),names);
        for(const s of summary.sections) assert.equal(s.questions.find(q=>!q.key.endsWith('-Comment')).count,1);
        const csv=studyResultsToCsv(imported.results);
        names.forEach((name,i)=>{assert.ok(csv.includes(`sections.${name}.q${i}-Comment`));assert.ok(csv.includes(`Explanation ${i} — café`));});
        assert.equal(summary.sections[0].label,'Same authored title');
        assert.notEqual(summary.sections[0].key,summary.sections[1].key);
    } finally {model.dispose();}
});

test('ordinary page names and order may replace all default ordinary sections, including before-only and after-only', () => {
    const ordinary={name:'my_section',elements:[{type:'text',name:'my_answer'}]};
    const special=capture([{type:'text',name:'capture_answer'}]).pages[0];
    for(const pages of [[ordinary,special],[special,ordinary]]) {
        const template={pages};validateQuestionnaire(template);
        const result=buildStudyResult({my_answer:'Kept'},session,buildSurvey(template,session),'P001');
        assert.deepEqual(result.sections,[{name:'my_section',responses:{my_answer:'Kept'}}]);
    }
    const renamed=structuredClone(bundled);
    renamed.pages.filter(p=>p.name!=='__capture_template__').forEach((p,i)=>p.name=`renamed_${i}`);
    validateQuestionnaire(renamed);
    assert.deepEqual(buildStudyResult({},session,buildSurvey(renamed,session),'P001').sections.map(s=>s.name),['renamed_0','renamed_1','renamed_2']);
});

test('ordinary page identity collisions and ambiguous names reject; unmapped answers never silently export', () => {
    for(const name of ['', ' spaced ', 'capture_1', '__proto__']) {
        const t=capture([{type:'text',name:'q'}]);t.pages.push({name,elements:[]});
        assert.throws(()=>validateQuestionnaire(t),/stable.*name|Reserved/);
    }
    const t=capture([{type:'text',name:'q'}]);t.pages.push({name:'ordinary',elements:[]},{name:'ordinary',elements:[]});
    assert.throws(()=>validateQuestionnaire(t),/page names must be unique/);
    assert.throws(()=>buildStudyResult({unexpected:'Do not lose me'},session,buildSurvey(capture([{type:'text',name:'q'}]),session),'P001'),/cannot be mapped/);
});
