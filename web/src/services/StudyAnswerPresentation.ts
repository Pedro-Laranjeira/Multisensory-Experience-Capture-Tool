import { authoredTitle } from "./StudyPresentation.ts";
import type { QuestionnaireMetadata } from "../types/StudyResult";

export function questionnaireIdentity(metadata?: QuestionnaireMetadata): string {
    return JSON.stringify([metadata?.name ?? null, metadata?.uploadedAt ?? null]);
}

export function questionnaireElements(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        const q = item !== null && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        return [q, ...questionnaireElements(q.elements), ...questionnaireElements(q.templateElements)];
    });
}

export function choiceOptions(value: unknown, locale: unknown) {
    return (Array.isArray(value) ? value : []).map(item => {
        const entry = item !== null && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        const raw = Object.hasOwn(entry, "value") ? entry.value : item;
        return { value: raw, label: authoredTitle(entry.text, locale) || String(raw) };
    });
}

export function choiceLabel(choices: ReturnType<typeof choiceOptions>, value: unknown): string | undefined {
    return choices.find(choice => String(choice.value) === String(value))?.label;
}
