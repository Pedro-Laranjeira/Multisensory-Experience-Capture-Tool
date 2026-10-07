import type { StudyResult } from "../types/StudyResult";
import { validateStudyResult } from "./StudyResultValidation.ts";
import type { QuestionnaireDefinition } from "./StudyResultSummary";
import { questionnaireIdentity, questionnaireElements, choiceOptions, choiceLabel } from "./StudyAnswerPresentation.ts";
import { authoredTitle } from "./StudyPresentation.ts";
import defaultQuestionnaire from "../survey/template_base.json" with { type: "json" };

type CsvValue = string | number | boolean | null | undefined;
const resultColumns = ["participantId", "schemaVersion", "resultId", "sessionId", "completedAt", "questionnaireName", "questionnaireUploadedAt"];
const captureColumns = ["capture.id", "capture.mediaType", "capture.sourceFile", "capture.exportFile", "capture.timestamp", "capture.latitude", "capture.longitude"];
const defaultQuestionNames = new Set(defaultQuestionnaire.pages.flatMap(page => questionnaireElements(page.elements).map(question => question.name)));
// Escape literal dots/backslashes so { "a.b": 1 } and { a: { b: 2 } }
// remain separate columns. Ordinary question names are unchanged.
const segment = (key: string) => key.replace(/\\/g, "\\\\").replace(/\./g, "\\.");

export function flattenResponses(values: Record<string, unknown>, prefix: string): Map<string, CsvValue> {
    const cells = new Map<string, CsvValue>();
    function visit(value: unknown, path: string) {
        if (value !== null && typeof value === "object" && !Array.isArray(value) &&
            (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
            const entries = Object.entries(value);
            if (!entries.length) cells.set(path, "{}");
            for (const [key, child] of entries) visit(child, `${path}.${segment(key)}`);
        } else if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            cells.set(path, value);
        } else {
            cells.set(path, JSON.stringify(value) ?? "");
        }
    }
    for (const [key, value] of Object.entries(values)) visit(value, `${prefix}.${segment(key)}`);
    return cells;
}

export function escapeCsvCell(value: CsvValue): string {
    const text = value === null || value === undefined ? "" : String(value);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readableResponses(values: Record<string, unknown>, survey: unknown, pageName: string): Record<string, unknown> {
    if (!survey || typeof survey !== "object" || !("pages" in survey) || !Array.isArray(survey.pages)) return values;
    const page = survey.pages.find(page => page?.name === pageName);
    const questions = questionnaireElements(page?.elements);
    const locale = "locale" in survey ? survey.locale : undefined;
    return Object.fromEntries(Object.entries(values).map(([key, value]) => {
        // Match exact answer names: separate Other/comment fields remain verbatim.
        const question = questions.find(q => q.name === key);
        if (!question || !["radiogroup", "dropdown", "checkbox", "tagbox", "imagepicker"].includes(String(question.type))) return [key, value];
        const choices = choiceOptions(question.choices, locale);
        const scalar = (item: unknown) => ["string", "number", "boolean"].includes(typeof item);
        if (Array.isArray(value) && value.every(scalar)) {
            return [key, value.map(item => choiceLabel(choices, item) ?? String(item)).join("; ")];
        }
        return [key, scalar(value) ? choiceLabel(choices, value) ?? value : value];
    }));
}

// Header presentation is separate from the collision-safe column keys and values.
function responseHeaders(values: Record<string, unknown>, survey: unknown, pageName: string, prefix: string, labels: Map<string, Set<string>>) {
    const definition = survey && typeof survey === "object" && "pages" in survey && Array.isArray(survey.pages) ? survey : undefined;
    const pages = definition && Array.isArray(definition.pages) ? definition.pages : [];
    const questions = questionnaireElements(pages.find(page => page?.name === pageName)?.elements);
    const locale = definition && "locale" in definition ? definition.locale : undefined;
    const commentSuffix = definition && "commentSuffix" in definition && typeof definition.commentSuffix === "string" ? definition.commentSuffix : "-Comment";
    for (const [name, value] of Object.entries(values)) {
        const question = questions.find(q => q.name === name) ?? questions.find(q => `${q.name}${commentSuffix}` === name);
        const title = question && !defaultQuestionNames.has(question.name) ? authoredTitle(question.title, locale)?.trim() : undefined;
        const root = `${prefix}.${segment(name)}`;
        for (const key of flattenResponses({ [name]: value }, prefix).keys()) {
            const label = title ? title + (name === question?.name ? "" : commentSuffix) + key.slice(root.length) : key;
            const candidates = labels.get(key) ?? new Set<string>();
            candidates.add(label);
            labels.set(key, candidates);
        }
    }
}

/** One observation per capture. JSON remains the full-fidelity source record. */
export function studyResultsToCsv(results: readonly StudyResult[], definitions: readonly QuestionnaireDefinition[] = []): string {
    const rows: Map<string, CsvValue>[] = [];
    const labels = new Map<string, Set<string>>();
    const groups = { sections: new Set<string>(), reflection: new Set<string>() };
    for (const result of results) {
        validateStudyResult(result);
        const survey = definitions.find(definition => questionnaireIdentity(definition.metadata) === questionnaireIdentity(result.questionnaire))?.survey;
        const shared = new Map<string, CsvValue>([
            ["participantId", result.participantId], ["schemaVersion", result.schemaVersion], ["resultId", result.resultId],
            ["sessionId", result.sessionId], ["completedAt", result.completedAt],
            ["questionnaireName", result.questionnaire?.name], ["questionnaireUploadedAt", result.questionnaire?.uploadedAt]
        ]);
        for (const section of result.sections) {
            responseHeaders(section.responses, survey, section.name, `sections.${segment(section.name)}`, labels);
            for (const [key, value] of flattenResponses(readableResponses(section.responses, survey, section.name), `sections.${segment(section.name)}`)) {
                shared.set(key, value); groups.sections.add(key);
            }
        }
        for (const capture of result.captures) {
            responseHeaders(capture.reflection, survey, "__capture_template__", "reflection", labels);
            const row = new Map(shared);
            row.set("capture.id", capture.id); row.set("capture.mediaType", capture.mediaType);
            row.set("capture.sourceFile", capture.sourceFile); row.set("capture.exportFile", capture.exportFile); row.set("capture.timestamp", capture.timestamp);
            row.set("capture.latitude", capture.latitude); row.set("capture.longitude", capture.longitude);
            for (const [key, value] of flattenResponses(readableResponses(capture.reflection, survey, "__capture_template__"), "reflection")) {
                row.set(key, value); groups.reflection.add(key);
            }
            rows.push(row);
        }
    }
    if (!rows.length) throw new Error("No captured moments are available to export.");
    const columns = [...resultColumns, ...[...groups.sections].sort(), ...captureColumns,
        ...[...groups.reflection].sort()];
    const proposedHeaders = columns.map(key => {
        const candidates = labels.get(key);
        return candidates?.size === 1 ? [...candidates][0] : key;
    });
    // Duplicate titles or titles that resemble another column must not obscure identity.
    const headers = proposedHeaders.map((label, index) =>
        proposedHeaders.indexOf(label) !== proposedHeaders.lastIndexOf(label) || (columns.includes(label) && label !== columns[index])
            ? columns[index] : label);
    // UTF-8 BOM helps Excel recognize non-English text. CRLF is standard CSV.
    return "\uFEFF" + [headers.map(escapeCsvCell).join(";"), ...rows.map(row => columns.map(key => escapeCsvCell(row.get(key))).join(";"))].join("\r\n") + "\r\n";
}
