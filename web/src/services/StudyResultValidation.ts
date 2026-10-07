import type { StudyResult } from "../types/StudyResult";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function isoDate(value: unknown): boolean {
    if (!text(value) || !/^\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const date = value.slice(0, 10);
    return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
const coordinate = (value: unknown): boolean => value === null || typeof value === "number" && Number.isFinite(value);
export class StudyResultValidationError extends Error {}

export function validateStudyResult(value: unknown): StudyResult {
    const fail = (message: string): never => { throw new StudyResultValidationError(message); };
    if (!record(value)) return fail("Expected a study result object.");
    if (value.schemaVersion !== "2.0") fail("Unsupported or missing result schema version. Expected 2.0 with generic questionnaire sections.");
    for (const key of ["resultId", "sessionId"]) if (!text(value[key])) fail(`Missing or invalid ${key}.`);
    if (!isoDate(value.completedAt)) fail("Invalid completion date; expected an ISO date and time.");
    if (!Array.isArray(value.sections)) return fail("Expected sections to be an ordered array.");
    if (["participant", "overallExperience", "finalReflections", "additionalSections"].some(key => key in value)) fail("Legacy fixed response categories are not part of result schema 2.0.");
    const sectionNames = new Set<string>();
    for (const section of value.sections) {
        if (!record(section) || !text(section.name) || section.name !== section.name.trim() || section.name === "__capture_template__" || /^capture_/.test(section.name) || ["__proto__", "constructor", "prototype"].includes(section.name) || sectionNames.has(section.name)) return fail("Sections require unique, safe ordinary page names.");
        sectionNames.add(section.name);
        if (section.title !== undefined && !text(section.title)) fail("Invalid section title.");
        if (!record(section.responses)) fail("Section responses must be an object.");
    }
    if (!Array.isArray(value.captures)) return fail("Expected captures to be an array.");
    if (!text(value.participantId) || !/^P[0-9]+$/.test(value.participantId)) fail("Missing or invalid participantId; expected P followed by digits.");
    const exportFiles = new Set<string>();
    const ids = new Set<number>();
    for (const [index, capture] of value.captures.entries()) {
        const label = `Capture ${index + 1}`;
        if (!record(capture)) return fail(`${label} is invalid.`);
        if (typeof capture.id !== "number" || !Number.isSafeInteger(capture.id) || capture.id < 0 || ids.has(capture.id)) return fail(`${label} needs a unique non-negative integer ID.`);
        ids.add(capture.id);
        if (typeof capture.mediaType !== "string" || !["photo", "audio", "video"].includes(capture.mediaType)) fail(`${label} has an unsupported media type.`);
        if (!text(capture.sourceFile) || /^(?:blob|data|javascript):/i.test(capture.sourceFile.trim())) fail(`${label} needs a durable source filename/reference; temporary media URLs cannot be saved.`);
        if (!text(capture.exportFile) || !/^P[0-9]+_capture_[0-9]+\.[a-z0-9]+$/.test(capture.exportFile) || !capture.exportFile.startsWith(`${value.participantId}_`) || exportFiles.has(capture.exportFile)) return fail(`${label} needs a unique exportFile matching the participant ID.`);
        exportFiles.add(capture.exportFile);
        if ("file" in capture) fail(`${label} contains a runtime file field. Use sourceFile instead.`);
        if (typeof capture.timestamp !== "string" || !/^\d{2,}:[0-5]\d:[0-5]\d$/.test(capture.timestamp)) fail(`${label} has an invalid timestamp; expected HH:MM:SS.`);
        if (!coordinate(capture.latitude) || !coordinate(capture.longitude)) fail(`${label} has invalid coordinates.`);
        if (!record(capture.reflection)) fail(`${label} reflections must be an object.`);
    }
    if (value.questionnaire !== undefined) {
        if (!record(value.questionnaire)) return fail("Invalid questionnaire metadata.");
        if (value.questionnaire.name !== undefined && !text(value.questionnaire.name)) fail("Invalid questionnaire name.");
        if (value.questionnaire.uploadedAt !== undefined && !isoDate(value.questionnaire.uploadedAt)) fail("Invalid questionnaire upload date.");
    }
    // All required fields have been checked at this untrusted JSON boundary.
    return value as unknown as StudyResult;
}
