/**
 * ============================================================
 * TemplateManager
 * ============================================================
 *
 * Stores and retrieves the current SurveyJS template.
 * Currently uses browser localStorage.
 * ============================================================
 */

import { QuestionnaireValidationError, validateQuestionnaire } from "./QuestionnaireValidation.ts";

const STORAGE_KEY = "capture-tool.surveyTemplate";
// Legacy key remains readable so existing researcher questionnaires survive.
const LEGACY_STORAGE_KEY = "pic2-survey-template";

export interface StoredTemplate {
    fileName: string;
    uploadedAt: string;
    survey: unknown;
}

/**
 * Save template.
 */
export function saveTemplate(
    fileName: string,
    survey: unknown
) {

    const validated = validateQuestionnaire(survey);
    const stored: StoredTemplate = {

        fileName,

        uploadedAt: new Date().toISOString(),

        survey: validated.survey

    };

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(stored)
    );

}

/**
 * Load template metadata.
 */
export function loadStoredTemplate(): StoredTemplate | null {

    const current = localStorage.getItem(STORAGE_KEY);
    const json = current ?? localStorage.getItem(LEGACY_STORAGE_KEY);

    if (!json)
        return null;

    let stored: unknown;
    try {
        stored = JSON.parse(json);
    } catch {
        throw new QuestionnaireValidationError("The saved questionnaire could not be read. Upload another questionnaire or reset to default.");
    }
    if (typeof stored !== "object" || stored === null ||
        !("fileName" in stored) || typeof stored.fileName !== "string" ||
        !("uploadedAt" in stored) || typeof stored.uploadedAt !== "string" ||
        !("survey" in stored)) {
        throw new QuestionnaireValidationError("The saved questionnaire is incomplete. Upload another questionnaire or reset to default.");
    }
    if (current === null) {
        // Validate before copying; preserve the exact stored JSON and the legacy
        // copy. A quota/write restriction must not prevent reading valid data.
        validateQuestionnaire(stored.survey);
        try { localStorage.setItem(STORAGE_KEY, json); } catch {
            // Continue using the untouched legacy questionnaire for this load.
        }
    }
    return { fileName: stored.fileName, uploadedAt: stored.uploadedAt, survey: stored.survey };

}

/**
 * Returns only the survey JSON.
 */
export function loadTemplate() {

    const stored = loadStoredTemplate();

    return stored ? validateQuestionnaire(stored.survey).survey : null;

}

/**
 * Delete stored template.
 */
export function resetTemplate() {

    // An explicit reset clears both selections so fallback cannot resurrect an
    // old upload. Remove the legacy copy first, retaining current on failure.
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);

}
