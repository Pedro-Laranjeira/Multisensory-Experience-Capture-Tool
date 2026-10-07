import { questionnaireIdentity, questionnaireElements as elements, choiceOptions as options, choiceLabel } from "./StudyAnswerPresentation.ts";
import { authoredTitle, baseQuestionName, legacyQuestionLabel, responseQuestionLabel } from "./StudyPresentation.ts";
import type { QuestionnaireMetadata, StudyResult } from "../types/StudyResult";

type JsonObject = Record<string, unknown>;
export interface QuestionnaireDefinition { metadata: QuestionnaireMetadata; survey: unknown }
export interface Observation { value: unknown; response: number; moment?: number }
export interface Distribution { label: string; count: number; percent: number }
export interface AnswerSummary {
    title: string; count: number; kind: "bars" | "pie" | "multi" | "text" | "numeric";
    distribution: Distribution[]; observations: Observation[];
    average?: number; min?: number; max?: number;
}
export interface QuestionSummary { key: string; title: string; count: number; answers: AnswerSummary[] }
function object(value: unknown): JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function title(value: unknown, locale?: unknown): string { return authoredTitle(value, locale) ?? ""; }
export function readableKey(key: string): string {
    const legacy = legacyQuestionLabel(key);
    if (legacy) return legacy;
    const clean = key.replace(/^capture_\d+_/, "").replace(/^[a-z]+\d*_/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]+/g, " ");
    return clean.charAt(0).toUpperCase() + clean.slice(1);
}
function present(value: unknown): boolean {
    return value !== null && value !== undefined && !(typeof value === "string" && !value.trim()) &&
        !(Array.isArray(value) && !value.some(present)) && !(typeof value === "object" && !Array.isArray(value) && !Object.keys(object(value)).length);
}
function summarize(titleText: string, all: Observation[], q: JsonObject, locale: unknown): AnswerSummary {
    let observations = all.filter(item => present(item.value));
    const rating = q.type === "rating" || q.type === "matrix";
    if (rating) observations = observations.map(item => ({ ...item, value: typeof item.value === "string" && item.value.trim() && Number.isFinite(Number(item.value)) ? Number(item.value) : item.value }));
    let choices = options(q.type === "matrix" ? q.columns : q.type === "rating" ? q.rateValues : q.choices, locale);
    if (q.type === "rating" && !choices.length) {
        const min = typeof q.rateMin === "number" ? q.rateMin : 1;
        const max = typeof q.rateMax === "number" ? q.rateMax : typeof q.rateCount === "number" ? min + q.rateCount - 1 : 5;
        const step = typeof q.rateStep === "number" ? q.rateStep : 1;
        if (Number.isFinite(min) && Number.isFinite(max) && step > 0 && (max - min) / step <= 100) choices = Array.from({ length: Math.max(0, Math.floor((max - min) / step) + 1) }, (_, i) => ({ value: min + i * step, label: String(min + i * step) }));
    }
    const values = observations.map(item => item.value);
    const numeric = values.length > 0 && values.every(value => typeof value === "number" && Number.isFinite(value));
    const multi = values.length > 0 && values.every(value => Array.isArray(value) && value.every(item => ["string", "number", "boolean"].includes(typeof item)));
    const boolean = values.length > 0 && values.every(value => typeof value === "boolean");
    const explicitText = q.type === "comment" || (q.type === "text" && q.inputType !== "number");
    const category = ["radiogroup", "dropdown", "imagepicker"].includes(String(q.type));
    const smallStrings = !q.type && values.length > 0 && values.every(value => typeof value === "string" && value.length < 60) && new Set(values).size <= 8 && new Set(values).size < values.length;
    const scalar = values.every(value => ["string", "number", "boolean"].includes(typeof value));
    const discrete = numeric && (rating || (new Set(values).size <= 12 && values.every(Number.isInteger)));
    const kind: AnswerSummary["kind"] = explicitText ? "text" : multi ? "multi" : boolean ? "pie" : scalar && category ? "bars" : numeric ? discrete ? "bars" : "numeric" : scalar && smallStrings ? "bars" : "text";
    const counts = new Map<unknown, number>();
    if (kind !== "text" && kind !== "numeric") {
        for (const choice of choices) counts.set(rating && Number.isFinite(Number(choice.value)) ? Number(choice.value) : choice.value, 0);
        for (const value of values) for (const option of new Set(multi ? (value as unknown[]).filter(present) : [value])) counts.set(option, (counts.get(option) ?? 0) + 1);
    }
    let entries = [...counts];
    if (numeric && !choices.length) entries = entries.sort((a, b) => Number(a[0]) - Number(b[0]));
    const distribution = entries.map(([value, count]) => ({ label: choiceLabel(choices, value) ?? (typeof value === "boolean" ? value ? "Yes" : "No" : String(value)), count, percent: observations.length ? count / observations.length * 100 : 0 }));
    const numbers = numeric && !category && !explicitText ? values as number[] : [];
    const average = numbers.length ? numbers.reduce((sum, value) => sum + value / numbers.length, 0) : undefined;
    return { title: titleText, count: observations.length, kind, observations, distribution,
        ...(average !== undefined && Number.isFinite(average) ? { average } : {}),
        ...(numbers.length ? { min: numbers.reduce((a,b) => Math.min(a,b)), max: numbers.reduce((a,b) => Math.max(a,b)) } : {}) };
}

// Metadata identifies configurations; absent/partial identities stay separate rather than implying equivalence.
export function buildResultsSummary(results: readonly StudyResult[], definitions: readonly QuestionnaireDefinition[] = []) {
    const groups = new Map<string, { results: StudyResult[]; definition?: QuestionnaireDefinition; label: string }>();
    for (const result of results) {
        const metadata = result.questionnaire;
        const identity = questionnaireIdentity(metadata);
        const definition = definitions.find(item => questionnaireIdentity(item.metadata) === identity);
        const reliable = Boolean(metadata?.name && metadata?.uploadedAt) || Boolean(definition && metadata?.name === "Bundled default questionnaire");
        const key = reliable ? identity : result.resultId;
        const group = groups.get(key) ?? { results: [], definition, label: metadata?.name || "Questionnaire unavailable" };
        group.results.push(result); groups.set(key, group);
    }
    return [...groups].map(([key, group]) => ({ key, label: group.label, uploadedAt: group.results[0].questionnaire?.uploadedAt,
        separate: group.results.length === 1 && !group.definition && !group.results[0].questionnaire?.uploadedAt,
        sections: [...new Set(group.results.flatMap(result => result.sections.map(section => section.name)))].concat("__capture_template__").map(pageName => {
            const captureSection = pageName === "__capture_template__";
            const stored = group.results.flatMap(result => result.sections).find(section => section.name === pageName);
            const locale = object(group.definition?.survey).locale;
            const page = list(object(group.definition?.survey).pages).map(object).find(page => page.name === pageName);
            const label = title(page?.title, locale) || stored?.title || (captureSection ? "Captured moments" : pageName);
            const questions = elements(page?.elements).filter(q => typeof q.name === "string" && !["html", "panel", "image"].includes(String(q.type)) && q.visible !== false);
            const rows = group.results.flatMap<{ values: JsonObject; response: number; moment?: number }>(result => {
                const response = results.indexOf(result) + 1;
                return captureSection ? result.captures.map(capture => ({ values: capture.reflection, response, moment: capture.id })) : [{ values: result.sections.find(section => section.name === pageName)?.responses ?? {}, response, moment: undefined }];
            });
            const keys = [...new Set([...questions.map(q => String(q.name)), ...rows.flatMap(row => Object.keys(row.values))])];
            return { key: pageName, label, questions: keys.flatMap(key => {
                const base = questions.find(q => q.name === baseQuestionName(key)) ?? {};
                const q = key.endsWith("-Comment") ? { ...base, type: "comment" } : base;
                const observations = rows.map(row => ({ value: row.values[key], response: row.response, moment: row.moment }));
                if (!observations.some(item => present(item.value)) && !q.name) return [];
                const questionTitle = responseQuestionLabel(key, title(base.title, locale));
                const answers: AnswerSummary[] = [];
                function visit(items: Observation[], definition: JsonObject, label: string) {
                    if (items.some(item => present(item.value)) && items.filter(item => present(item.value)).every(item => Object.keys(object(item.value)).length)) {
                        const subdefinitions = [...list(definition.rows), ...list(definition.items), ...list(definition.columns)].map(item => typeof item === "string" ? { value: item } : object(item));
                        const keys = [...new Set([...subdefinitions.map(item => String(item.value ?? item.name ?? "")), ...items.flatMap(item => Object.keys(object(item.value)))])].filter(Boolean);
                        for (const subkey of keys) {
                            const sub = subdefinitions.find(item => (item.value ?? item.name) === subkey);
                            const children = items.map(item => ({ ...item, value: object(item.value)[subkey] }));
                            if (children.some(item => present(item.value))) visit(children, { ...definition, ...sub, type: sub?.cellType ?? sub?.type ?? definition.type, rows: undefined, items: undefined }, title(sub?.text, locale) || title(sub?.title, locale) || readableKey(subkey));
                        }
                    } else answers.push(summarize(label, items, definition, locale));
                }
                visit(observations, q, questionTitle);
                return [{ key, title: questionTitle, count: observations.filter(item => present(item.value)).length, answers }];
            }) };
        }).filter(section => section.questions.length > 0)
    }));
}
