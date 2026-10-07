import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Model, surveyLocalization } from 'survey-core';
import { configureEnglishSurveyDefaults } from '../src/services/SurveyPresentation.ts';
import { resultLabels } from '../src/services/StudyPresentation.ts';
import { buildResultsSummary } from '../src/services/StudyResultSummary.ts';

// Compile TSX for server rendering using the project's existing TypeScript.
registerHooks({
    resolve(specifier, context, next) {
        if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
            for (const suffix of ['.ts', '.tsx']) {
                const url = new URL(specifier + suffix, context.parentURL);
                if (existsSync(fileURLToPath(url))) return next(url.href, context);
            }
        }
        return next(specifier, context);
    },
    load(url, context, next) {
        if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText };
        return next(url, context);
    }
});
const { IndividualResult } = await import('../src/components/ResearcherResults.tsx');
const { default: PageShell } = await import('../src/components/PageShell.tsx');
test('page shell presents the official public project name', () => {
    const html = renderToStaticMarkup(React.createElement(PageShell, { context: 'Research study' }));
    assert.ok(html.includes('<h1>Multisensory Experience Capture Tool</h1>'));
    assert.ok(html.includes('Multisensory Experience Capture Tool · Research study'));
});
const metadata = { name: 'questionário.json', uploadedAt: '2026-09-16T10:00:00Z' };
const make = () => ({ participantId: 'P001', sessionId: 'sessão-original', resultId: 'r1', completedAt: '2026-09-16T10:00:00Z', questionnaire: metadata, sections: [{name:'participant_information',title:'Participant profile',responses:{ p1_idade: '25-34', custom: 'Espaço tranquilo' }},{name:'final_reflections',responses:{f_nao_capturado:'Nenhum'}}], captures: ['photo', 'audio'].map((mediaType, i) => ({ id: i + 1, mediaType, sourceFile: 'fotografia.JPG', exportFile: 'P001_capture_1.JPG', timestamp: '00:01:00', latitude: null, longitude: null, reflection: { c_sentidos: ['Visão'], c_nota_aberta: 'Não ouvi nada' } })) });
const render = (result, definitions = []) => renderToStaticMarkup(React.createElement(IndividualResult, { selected: result, definitions, onClose() {} }));
test('ordinary and capture Other labels resolve base titles consistently without changing stored answers', () => {
    const result = make();
    result.sections[0].responses = {p1_genero:'other','p1_genero-Comment':'Unchanged ordinary answer',custom_question:'other','custom_question-Comment':'Custom explanation'};
    result.captures[0].reflection = {c_sentidos:['other'],'c_sentidos-Comment':'Unchanged capture answer'};
    const before = structuredClone(result);
    const definitions = [{metadata,survey:{pages:[
        {name:'participant_information',elements:[{name:'p1_genero',title:'Gender'},{name:'custom_question',title:'Researcher-authored question'}]},
        {name:'__capture_template__',elements:[{name:'c_sentidos',title:'Sensory dimensions'}]}
    ]}}];
    for (const defs of [definitions, []]) {
        const labels = resultLabels(result,defs);
        assert.equal(labels.sections.participant_information.questions.p1_genero,'Gender');
        assert.equal(labels.sections.participant_information.questions['p1_genero-Comment'],'Gender — Other');
        const custom = defs.length ? 'Researcher-authored question' : 'custom_question';
        assert.equal(labels.sections.participant_information.questions['custom_question-Comment'],`${custom} — Other`);
        const capture = defs.length ? 'Sensory dimensions' : 'Relevant senses or dimensions';
        assert.equal(labels.reflection['c_sentidos-Comment'],`${capture} — Other`);
        const html = render(result,defs);
        for (const text of ['Gender — Other',`${custom} — Other`,`${capture} — Other`,'Unchanged ordinary answer','Custom explanation','Unchanged capture answer']) assert.ok(html.includes(text),text);
        assert.ok(!html.includes('<dt>p1_genero-Comment</dt>'));
        const summary = buildResultsSummary([result],defs)[0];
        for (const section of summary.sections) for (const q of section.questions) {
            const expected = section.key === '__capture_template__' ? labels.reflection[q.key] : labels.sections[section.key].questions[q.key];
            assert.equal(q.title,expected);
            if(q.key.endsWith('-Comment')) assert.equal(q.answers[0].kind,'text');
        }
    }
    assert.deepEqual(result,before);
    assert.equal(result.sections[0].responses['p1_genero-Comment'],'Unchanged ordinary answer');
});
test('individual result renders English labels and media names while preserving imported data', () => {
    const result = make(), before = structuredClone(result), html = render(result);
    for (const text of ['Participant profile', 'Participant ID', 'Session ID', 'Age range', 'Relevant senses or dimensions', 'Photo', 'Audio', 'Source file', 'Captured at']) assert.ok(html.includes(text), text);
    for (const label of ['Age range', 'Relevant senses or dimensions', 'Captured moment reflection', 'Sensations that could not be captured']) assert.ok(html.includes(`<dt>${label}</dt>`));
    for (const text of ['Espaço tranquilo', 'Não ouvi nada', 'Nenhum', 'Visão', 'fotografia.JPG', 'sessão-original']) assert.ok(html.includes(text), text);
    assert.deepEqual(result, before);
});
test('matching authored Portuguese question titles take precedence; unrelated definitions do not', () => {
    const result = make();
    const survey = { locale: 'pt', pages: [{ name: 'participant_information', elements: [{ type: 'text', name: 'p1_idade', title: { pt: 'Idade do participante', en: 'Participant age' } }, { type: 'text', name: 'custom', title: 'Descrição livre' }] }] };
    const before = structuredClone(survey), definitions = [{ metadata, survey }];
    assert.ok(render(result, definitions).includes('Idade do participante'));
    assert.equal(resultLabels(result, [{ metadata: { name: 'other.json' }, survey }]).sections.participant_information.questions.p1_idade, 'Age range');
    assert.equal(buildResultsSummary([result], definitions)[0].sections[0].questions[0].title, 'Idade do participante');
    assert.deepEqual(survey, before);
});

test('individual result shows arbitrary sections in stored order with authored labels and safe identifier fallbacks', () => {
    const result = {...make(),sections:[
        {name:'pre_walk',title:'Before the walk',responses:{background:'Distinct background', 'background-Comment':'Typed explanation'}},
        {name:'accessibility',title:'Accessibility reflection',responses:{notes:'Uneven paths'}}
    ]};
    const fallback = render(result);
    assert.ok(fallback.indexOf('Before the walk') < fallback.indexOf('Accessibility reflection'));
    for(const text of ['Distinct background','Typed explanation','Uneven paths','background — Other']) assert.ok(fallback.includes(text));
    const definitions = [{metadata,survey:{pages:[
        {name:'pre_walk',title:'Authored before section',elements:[{name:'background',title:'Previous experience'}]},
        {name:'accessibility',title:'Authored accessibility section',elements:[{name:'notes',title:'Access observations'}]}
    ]}}];
    const matched = render(result,definitions);
    for(const text of ['Authored before section','Previous experience','Access observations','Typed explanation']) assert.ok(matched.includes(text));
    assert.ok(!matched.includes('<h3>Participant profile</h3>'));
});
test('SurveyJS defaults become English while authored localized content, choices and answers remain intact', () => {
    const template = { locale: 'pt', title: { pt: 'Questionário', en: 'Questionnaire' }, pages: [{ name: 'page', title: { pt: 'Reflexão', en: 'Reflection' }, elements: [{ type: 'radiogroup', name: 'question', isRequired: true, title: { pt: 'O que sentiu?', en: 'What did you feel?' }, choices: [{ value: 'visao', text: { pt: 'Visão', en: 'Sight' } }] }] }] };
    const before = structuredClone(template), model = new Model(structuredClone(template));
    try {
        configureEnglishSurveyDefaults(model);
        assert.equal(model.locale || surveyLocalization.defaultLocale, 'en');
        assert.equal(model.title, 'Questionário');
        assert.equal(model.pages[0].title, 'Reflexão');
        const q = model.getQuestionByName('question');
        assert.equal(q.title, 'O que sentiu?'); assert.equal(q.choices[0].text, 'Visão'); assert.equal(q.choices[0].value, 'visao');
        assert.equal(model.pageNextText, 'Next');
        q.validate(); assert.equal(q.errors[0].getText(), "Response required.");
        model.setValue('question', 'visao'); assert.equal(model.data.question, 'visao');
        assert.deepEqual(template, before);
    } finally { model.dispose(); }
});
test('all application locale formatters explicitly use English', () => {
    for (const file of ['components/ResearcherResults.tsx', 'components/StudyResultSummary.tsx', 'pages/ResearcherPage.tsx']) {
        const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
        assert.ok(!/toLocale(?:Date|Time)?String\(\)/.test(source));
        assert.ok(source.includes('toLocaleString("en-GB"'));
    }
    assert.ok(render(make()).includes(new Date(make().completedAt).toLocaleString('en-GB')));
});

test('dynamic photo and audio anchors have English accessible labels and independent capture questions', async () => {
    const { buildSurvey } = await import('../src/services/SurveyTemplateProcessor.ts');
    const template = { pages: [{ name: '__capture_template__', elements: [{ type: 'html', name: 'capture_info' }, { type: 'comment', name: 'reflection', title: 'Reflex?o livre' }] }] };
    const before = structuredClone(template), result = make();
    const generated = buildSurvey(template, { sessionId: result.sessionId, captures: result.captures.map(c => ({ ...c, file: c.sourceFile })) });
    assert.ok(generated.pages[0].elements[0].html.includes('alt="Captured photo"'));
    assert.ok(generated.pages[1].elements[0].html.includes('aria-label="Captured audio"'));
    assert.notEqual(generated.pages[0].elements[1].name, generated.pages[1].elements[1].name);
    assert.equal(generated.pages[1].elements[1].title, 'Reflex?o livre');
    assert.deepEqual(template, before);
});
test('localized browser Bluetooth errors surface an English application message', async t => {
    const { loadCaptureDeviceSession } = await import('../src/services/CaptureDeviceBleService.ts');
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => { throw new DOMException('N?o foi poss?vel ligar', 'NetworkError'); } } });
    t.after(() => delete navigator.bluetooth);
    await assert.rejects(loadCaptureDeviceSession(), error => error.message.includes('Bluetooth operation failed (NetworkError)') && !error.message.includes('N?o foi'));
});
