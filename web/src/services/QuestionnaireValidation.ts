import { configureEnglishSurveyDefaults } from "./SurveyPresentation.ts";
import { Model } from "survey-core";
import { captureQuestionNames, rejectExternalCaptureReferences, transformCaptureBindings } from "./CaptureTemplateContract.ts";

export const CAPTURE_TEMPLATE_NAME = "__capture_template__";

interface SurveyElement extends Record<string, unknown> {
    type: string;
    elements?: SurveyElement[];
    templateElements?: SurveyElement[];
}

interface SurveyPage extends Record<string, unknown> {
    name?: string;
    elements?: SurveyElement[];
}

export interface SurveyTemplate extends Record<string, unknown> {
    pages: SurveyPage[];
}

export interface QuestionnaireSection {
    label: string;
    questionCount: number;
    perCapture: boolean;
}

export class QuestionnaireValidationError extends Error {
    readonly details?: string;

    constructor(message: string, details?: string) {
        super(message);
        this.name = "QuestionnaireValidationError";
        this.details = details;
    }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function isElementList(value: unknown): value is SurveyElement[] {
    return Array.isArray(value) && value.every((element) =>
        isObject(element) && typeof element.type === "string" &&
        (element.elements === undefined || isElementList(element.elements)) &&
        (element.templateElements === undefined || isElementList(element.templateElements))
    );
}

function isSurveyTemplate(value: unknown): value is SurveyTemplate {
    return isObject(value) && Array.isArray(value.pages) && value.pages.length > 0 &&
        value.pages.every((page) => isObject(page) &&
            (page.name === undefined || typeof page.name === "string") &&
            (page.elements === undefined || isElementList(page.elements)));
}

function isAnswerable(element: Record<string, unknown>): boolean {
    return (element.visible !== false || Boolean(element.visibleIf)) &&
        (element.readOnly !== true || Boolean(element.enableIf));
}

function countQuestions(elements: SurveyElement[] = []): number {
    return elements.reduce((count, element) => {
        if (!isAnswerable(element)) return count;
        if (element.type === "panel") return count + countQuestions(element.elements);
        if (["html", "image", "expression"].includes(element.type)) return count;
        if (element.type === "paneldynamic" && countQuestions(element.templateElements) === 0) return count;
        // Composite inputs (matrices/dynamic panels) count once, not once per cell.
        return count + 1;
    }, 0);
}

function pageTitle(page: SurveyPage, locale: unknown): string | undefined {
    if (typeof page.title === "string" && page.title.trim()) return page.title;
    if (isObject(page.title)) {
        const localized = typeof locale === "string" ? page.title[locale] : undefined;
        const title = localized ?? page.title.default ?? Object.values(page.title).find((value) => typeof value === "string" && value.trim());
        if (typeof title === "string" && title.trim()) return title;
    }
    return undefined;
}

export function validateQuestionnaire(value: unknown): { survey: SurveyTemplate; sections: QuestionnaireSection[] } {
    if (!isSurveyTemplate(value)) {
        throw new QuestionnaireValidationError("This file does not contain a valid questionnaire. Choose a SurveyJS questionnaire export with pages and questions.");
    }
    const capturePages = value.pages.filter((page) => page.name === CAPTURE_TEMPLATE_NAME);
    if (capturePages.length === 0) {
        throw new QuestionnaireValidationError(
            "This questionnaire cannot be used because it does not contain a capture reflection section.",
            `The required page name is ${CAPTURE_TEMPLATE_NAME}.`
        );
    }
    if (capturePages.length !== 1) {
        throw new QuestionnaireValidationError("This questionnaire contains more than one capture reflection section. Keep only one capture reflection section.");
    }
    const capturePage = capturePages[0];
    if (!isAnswerable(capturePage) || countQuestions(capturePage.elements) === 0 || value.mode === "display") {
        throw new QuestionnaireValidationError("The capture reflection section must contain at least one question participants can answer. Text, images, and hidden metadata alone are not enough.");
    }

    const pageNames = new Set<string>();
    const names = new Set<string>();
    const suffix = typeof value.commentSuffix === "string" ? value.commentSuffix : "-Comment";
    if (suffix !== "-Comment") throw new QuestionnaireValidationError("Custom comment suffixes are not supported. Keep the SurveyJS default -Comment suffix so explanations can be exported safely.");
    function inspect(elements: SurveyElement[] = [], capture = false): void {
        for (const element of elements) {
            if (element.valueName) throw new QuestionnaireValidationError("Shared valueName bindings are not supported. Remove valueName and use unique question names so answers can be exported safely.");
            if (capture && (element.type === "paneldynamic" || element.type === "matrixdynamic" || element.templateElements)) {
                throw new QuestionnaireValidationError("Dynamic capture templates are not supported safely. Use ordinary questions, static matrices or static panels instead.");
            }
            if (!["html", "image", "panel"].includes(element.type)) {
                const name = element.name;
                if (typeof name !== "string" || !name.trim() || ["__proto__", "constructor", "prototype"].includes(name) || /^capture_\d+_/.test(name)) {
                    throw new QuestionnaireValidationError("Every answer-bearing question needs a non-empty, unique name. Reserved names and capture_<id>_ prefixes are not supported.");
                }
                if (names.has(name)) throw new QuestionnaireValidationError("Question names must be unique, including within the capture template. Rename duplicate questions in SurveyJS Creator.");
                names.add(name);
                if (capture && ["captureId", "mediaType", "filename", "timestamp", "latitude", "longitude"].includes(name) && (element.visible !== false || element.visibleIf)) {
                    throw new QuestionnaireValidationError(`Capture metadata field ${name} must remain hidden. Use a different name for participant-answer questions.`);
                }
            }
            inspect(element.elements, capture);
            if (!capture) inspect(element.templateElements);
        }
    }
    for (const page of value.pages) {
        if (typeof page.name !== "string" || !page.name.trim() || page.name !== page.name.trim() || ["__proto__", "constructor", "prototype"].includes(page.name) || /^capture_/.test(page.name)) throw new QuestionnaireValidationError("Every questionnaire page needs a stable, non-empty name. Reserved names and the generated capture_ prefix cannot be used for ordinary pages.");
        if (pageNames.has(page.name)) throw new QuestionnaireValidationError("Questionnaire page names must be unique. Rename duplicate pages in SurveyJS Creator.");
        pageNames.add(page.name);
        inspect(page.elements, page.name === CAPTURE_TEMPLATE_NAME);
    }
    for (const name of names) {
        if (names.has(name + suffix)) throw new QuestionnaireValidationError(`Question ${name + suffix} conflicts with the comment field for ${name}. Rename that question.`);
    }
    if (value.triggers || value.calculatedValues) {
        if ((Array.isArray(value.triggers) && value.triggers.length) || (Array.isArray(value.calculatedValues) && value.calculatedValues.length)) {
            throw new QuestionnaireValidationError("Survey-wide triggers and calculated values are not supported by the capture duplication/export contract. Remove them before uploading.");
        }
    }
    const localNames = captureQuestionNames(capturePages[0].elements);
    const globalNames = new Set([...names].filter(name => !localNames.has(name)));
    try {
        transformCaptureBindings(structuredClone(capturePages[0]), localNames, globalNames);
        value.pages.filter(page => page !== capturePage).forEach(page => rejectExternalCaptureReferences(page, localNames));
        rejectExternalCaptureReferences(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "pages")), localNames);
    } catch (error) {
        throw new QuestionnaireValidationError(error instanceof Error ? error.message : "Unsupported capture-template binding.");
    }

    let model: Model | undefined;
    try {
        model = new Model(structuredClone(value));
        configureEnglishSurveyDefaults(model);
        if (model.jsonErrors?.length) {
            throw new QuestionnaireValidationError(
                "The questionnaire contains an invalid question or setting. Please correct the SurveyJS export and try again.",
                model.jsonErrors.map((error) => error.message).join("\n")
            );
        }
    } catch (error) {
        if (error instanceof QuestionnaireValidationError) throw error;
        throw new QuestionnaireValidationError("The questionnaire structure could not be read. Please check the SurveyJS export.");
    } finally {
        model?.dispose();
    }

    return {
        survey: value,
        sections: value.pages.map((page, index) => {
            const perCapture = page.name === CAPTURE_TEMPLATE_NAME;
            const title = pageTitle(page, value.locale);
            return {
                label: perCapture
                    ? title && title !== "Captured Moment" ? `${title} (per captured moment)` : "Per captured moment"
                    : title ?? page.name?.replace(/_/g, " ") ?? `Section ${index + 1}`,
                questionCount: isAnswerable(page) ? countQuestions(page.elements) : 0,
                perCapture
            };
        })
    };
}

export function parseQuestionnaire(text: string): SurveyTemplate {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new QuestionnaireValidationError("The file is not valid JSON. Please export the questionnaire again and choose that file.");
    }
    return validateQuestionnaire(value).survey;
}
