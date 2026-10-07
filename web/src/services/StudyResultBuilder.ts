import { captureExportFilename } from "./StudyMediaExporter.ts";
import { validateStudyResult } from "./StudyResultValidation.ts";
import { authoredTitle } from "./StudyPresentation.ts";
import type { Session } from "../types/Session";
import type { StudyResult, StudyCapture, QuestionnaireMetadata } from "../types/StudyResult";

interface SurveyElementDefinition {
    type?: string;
    name?: string;
    elements?: SurveyElementDefinition[];
    templateElements?: SurveyElementDefinition[];
}

interface SurveyPageDefinition {
    name?: string;
    title?: unknown;
    elements?: SurveyElementDefinition[];
}

interface SurveyDefinition {
    pages?: SurveyPageDefinition[];
    commentSuffix?: string;
    locale?: unknown;
}

const CAPTURE_METADATA_FIELDS = new Set([
    "captureId",
    "mediaType",
    "filename",
    "timestamp",
    "latitude",
    "longitude"
]);

function collectAnswerNames(
    elements: SurveyElementDefinition[] = [],
    commentSuffix = "-Comment"
): string[] {
    const names: string[] = [];

    for (const element of elements) {
        if (element.name && element.type !== "html") {
            names.push(element.name);
            // SurveyJS stores Other/question comments separately from selections.
            names.push(element.name + commentSuffix);
        }

        names.push(...collectAnswerNames(element.elements, commentSuffix));
        names.push(...collectAnswerNames(element.templateElements, commentSuffix));
    }

    return names;
}

function collectPageResponses(
    surveyData: Record<string, unknown>,
    surveyDefinition: SurveyDefinition,
    pageName: string
): Record<string, unknown> {
    const page = surveyDefinition.pages?.find(
        (candidate) => candidate.name === pageName
    );
    const responses: Record<string, unknown> = {};

    for (const name of collectAnswerNames(page?.elements, surveyDefinition.commentSuffix)) {
        if (Object.hasOwn(surveyData, name)) {
            responses[name] = surveyData[name];
        }
    }

    return responses;
}

function collectCaptureReflection(
    surveyData: Record<string, unknown>,
    surveyDefinition: SurveyDefinition,
    captureId: number
): Record<string, unknown> {
    const pageName = `capture_${captureId}`;
    const prefix = `${pageName}_`;
    const page = surveyDefinition.pages?.find(
        (candidate) => candidate.name === pageName
    );
    const reflection: Record<string, unknown> = {};

    for (const runtimeName of collectAnswerNames(page?.elements, surveyDefinition.commentSuffix)) {
        if (!runtimeName.startsWith(prefix) || !Object.hasOwn(surveyData, runtimeName)) {
            continue;
        }

        const originalName = runtimeName.slice(prefix.length);

        if (!CAPTURE_METADATA_FIELDS.has(originalName)) {
            reflection[originalName] = surveyData[runtimeName];
        }
    }

    return reflection;
}

/**
 * Builds the final study dataset from:
 *
 * - SurveyJS answers
 * - Capture session
 */
export function buildStudyResult(
    surveyData: Record<string, unknown>,
    session: Session,
    surveyDefinition: SurveyDefinition,
    participantId: string,
    questionnaire?: QuestionnaireMetadata
): StudyResult {

    const knownAnswers = new Set((surveyDefinition.pages ?? []).flatMap(page => collectAnswerNames(page.elements, surveyDefinition.commentSuffix)));
    const unmapped = Object.keys(surveyData).filter(name => !knownAnswers.has(name));
    if (unmapped.length) throw new Error(`Answers cannot be mapped to questionnaire sections: ${unmapped.join(", ")}. Check the questionnaire's answer-storage configuration.`);

    const captures: StudyCapture[] = session.captures.map((capture, index) => {

        return {

            id: capture.id,

            mediaType: capture.mediaType,

            sourceFile: capture.sourceFile ?? capture.file,
            exportFile: captureExportFilename(participantId, index + 1, capture.sourceFile ?? capture.file, capture.mediaType),

            timestamp: capture.timestamp,

            latitude: capture.latitude,

            longitude: capture.longitude,

            reflection: collectCaptureReflection(
                surveyData,
                surveyDefinition,
                capture.id
            )

        };

    });

    const result: StudyResult = {
        schemaVersion: "2.0",
        participantId,
        resultId: crypto.randomUUID(),
        sessionId: session.sessionId,
        completedAt: new Date().toISOString(),
        ...(questionnaire ? { questionnaire } : {}),
        sections: (surveyDefinition.pages ?? []).filter(page => !session.captures.some(capture => page.name === `capture_${capture.id}`)).map(page => {
            if (!page.name) throw new Error("Questionnaire sections require stable page names.");
            const title = authoredTitle(page.title, surveyDefinition.locale);
            return { name: page.name, ...(title ? { title } : {}), responses: collectPageResponses(surveyData, surveyDefinition, page.name) };
        }),
        captures

    };
    return validateStudyResult(result);

}
