import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

// Exercise the real component callbacks with hook/service doubles; no DOM dependency.
function mount(file, services, globals = {}, props = {}) {
    const module = { exports: {} };
    const react = {
        useRef: value => ({ current: value }),
        useEffect() {},
        useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}]
    };
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
    }).outputText;
    runInNewContext(compiled, {
        module, exports: module.exports, console, ...globals,
        require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? jsxRuntime : services
    });
    return module.exports.default(props);
}

function elements(node) {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== 'object' || !node.props) return [];
    return [node, ...elements(node.props.children)];
}

function checkControl(tree, label, multiple) {
    const nodes = elements(tree);
    const buttons = nodes.filter(node => node.type === 'button' && node.props.children === label);
    assert.equal(buttons.length, 1);
    const button = buttons[0];
    assert.equal(button.props.disabled, false);
    assert.equal(button.props.tabIndex, undefined); // Native keyboard-accessible button.
    const inputs = nodes.filter(node => node.type === 'input' && node.props.type === 'file');
    assert.equal(inputs.length, 1);
    const input = inputs[0];
    assert.equal(input.props.accept, '.json');
    assert.equal(Boolean(input.props.multiple), multiple);
    assert.equal(input.props.hidden, true);
    assert.equal(input.props.tabIndex, undefined);
    assert.equal(input.props.disabled, false);
    let clicks = 0;
    input.props.ref.current = { click() { clicks++; } };
    button.props.onClick();
    assert.equal(clicks, 1);
    return input;
}

test('questionnaire button opens hidden JSON input and selection reaches existing upload handler', () => {
    const survey = { pages: [] }, saved = [];
    class Reader {
        static LOADING = 1;
        readAsText(file) { this.result = file.content; this.onload(); }
    }
    const tree = mount('pages/ResearcherPage.tsx', {
        loadStoredTemplate: () => null,
        validateQuestionnaire: () => ({ survey, sections: [] }),
        parseQuestionnaire: text => { assert.equal(text, '{"pages":[]}'); return survey; },
        saveTemplate: (name, value) => saved.push({ name, value })
    }, { FileReader: Reader });
    const input = checkControl(tree, 'Choose questionnaire file', false);
    const target = { files: [{ name: 'questionnaire.json', content: '{"pages":[]}' }], value: 'selected' };
    input.props.onChange({ target });
    assert.deepEqual(saved, [{ name: 'questionnaire.json', value: survey }]);
    assert.equal(target.value, '');
});

test('results button opens hidden multi-file JSON input and selection reaches existing import handler', async () => {
    const files = [{ name: 'one.json' }, { name: 'two.json' }], calls = [];
    const tree = mount('components/ResearcherResults.tsx', {
        summarizeStudyResults: () => ({ importedResults: 0, capturedMoments: 0 }),
        importStudyResults: async (selected, existing) => {
            calls.push({ selected, existing });
            return { results: [], errors: [], imported: 2, duplicates: 0 };
        }
    }, {}, { definitions: [] });
    const input = checkControl(tree, 'Import results', true);
    const currentTarget = { files, value: 'selected' };
    input.props.onChange({ currentTarget });
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.deepEqual(Array.from(calls[0].selected), files);
    assert.equal(calls[0].existing.length, 0);
    assert.equal(currentTarget.value, '');
});

test('researcher input display rules exclude hidden controls so browser hiding is preserved', () => {
    const css = readFileSync(new URL('../src/styles/participant.css', import.meta.url), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selector, body]) => /researcher-(upload|results).*input/.test(selector) && /display\s*:/.test(body));
    assert.equal(rules.length, 2);
    for (const [, selector] of rules) assert.ok(selector.includes(':not([hidden])'), selector);
});
