import type { StudyResult } from "../types/StudyResult";
import type { QuestionnaireDefinition } from "./StudyResultSummary";

export const metadataLabels: Record<string, string> = {
    participantId: "Participant ID", sessionId: "Session ID", resultId: "Result ID",
    completedAt: "Completed at", captureCount: "Captured moments", questionnaire: "Questionnaire",
    mediaType: "Media type", sourceFile: "Source file", exportFile: "Export file",
    timestamp: "Captured at", latitude: "Latitude", longitude: "Longitude"
};
// Only known bundled identifiers have application-owned fallback labels.
const legacyLabels: Record<string, string> = {
    p1_idade: "Age range", p1_genero: "Gender", p1_nacionalidade: "Nationality",
    p1_relacao_espaco: "Relationship with this place", p1_familiaridade: "Familiarity with this place",
    p1_sensibilidade: "Sensory sensitivities or accessibility needs", p1_tecnologia: "Comfort using digital technologies",
    p1_natureza: "Frequency of engaging with natural environments", c_sentidos: "Relevant senses or dimensions",
    c_tipo_estimulo: "Primary source of sensation", c_metricas: "Moment evaluation",
    c_representatividade: "How accurately the media represents the experience", c_nota_aberta: "Captured moment reflection",
    g_engajamento: "Engagement", g_percecao_mudanca: "Noticing overlooked aspects of the space",
    g_impacto_ferramenta: "Impact of capturing moments", g_carga_cognitiva: "Overstimulation, fatigue or distraction",
    f_exclusao: "Exclusion from the space", f_nao_capturado: "Sensations that could not be captured"
};
export function legacyQuestionLabel(key: string): string | undefined {
    return legacyLabels[key.replace(/^capture_\d+_/, "")];
}
export function baseQuestionName(key: string): string {
    return key.replace(/^capture_\d+_/, "").replace(/-Comment$/, "");
}
export function responseQuestionLabel(key: string, questionTitle?: string): string {
    const base = baseQuestionName(key);
    const label = questionTitle || legacyQuestionLabel(base) || base;
    return key.endsWith("-Comment") ? `${label} \u2014 Other` : label;
}
export function mediaLabel(type: string): string {
    return ({ photo: "Photo", audio: "Audio", video: "Video" } as Record<string, string>)[type] ?? type;
}
function object(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function authoredTitle(value: unknown, locale: unknown): string | undefined {
    if (typeof value === "string") return value;
    const texts = object(value);
    const text = texts[typeof locale === "string" ? locale : "default"] ?? texts.default ?? texts.en ?? Object.values(texts).find(v => typeof v === "string");
    return typeof text === "string" ? text : undefined;
}
export function resultLabels(result: StudyResult, definitions: readonly QuestionnaireDefinition[]) {
    const identity = (metadata: unknown) => { const m = object(metadata); return JSON.stringify([m.name ?? null, m.uploadedAt ?? null]); };
    const survey = object(definitions.find(d => identity(d.metadata) === identity(result.questionnaire))?.survey);
    const pages = (Array.isArray(survey.pages) ? survey.pages : []).map(object);
    function labels(pageName: string, values: Record<string, unknown>[]) {
        const page = pages.find(p => p.name === pageName);
        const titles: Record<string, string> = {};
        function visit(items: unknown) {
            if (!Array.isArray(items)) return;
            for (const item of items) {
                const q = object(item);
                if (typeof q.name === "string") {
                    const title = authoredTitle(q.title, survey.locale);
                    if (title) titles[q.name] = title;
                }
                visit(q.elements); visit(q.templateElements);
            }
        }
        visit(page?.elements);
        return Object.fromEntries(values.flatMap(v => Object.keys(v)).map(key => [key, responseQuestionLabel(key, titles[baseQuestionName(key)])]));
    }
    return {
        sections: Object.fromEntries(result.sections.map(section => [section.name, {
            title: authoredTitle(pages.find(p => p.name === section.name)?.title, survey.locale) || section.title || section.name,
            questions: labels(section.name, [section.responses])
        }])),
        reflection: labels("__capture_template__", result.captures.map(c => c.reflection))
    };
}
