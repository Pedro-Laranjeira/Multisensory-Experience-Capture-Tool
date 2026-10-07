/**
 * ============================================================
 * StudyResult
 * ============================================================
 *
 * This is the final output of the platform.
 * It combines:
 *
 * - Participant answers
 * - Capture metadata
 * - Reflection answers
 *
 * This object is what the researcher will analyse.
 * ============================================================
 */

import type { MediaType } from "./Capture";

export type CaptureReflection = Record<string, unknown>;

export interface StudyCapture {

    id: number;

    mediaType: MediaType;

    sourceFile: string;

    exportFile: string;

    timestamp: string;

    latitude: number | null;

    longitude: number | null;

    reflection: CaptureReflection;

}

export interface QuestionnaireMetadata {
    name?: string;
    uploadedAt?: string;
}

export interface StudyResult {
    schemaVersion: "2.0";
    participantId: string;
    resultId: string;
    sessionId: string;
    completedAt: string;
    questionnaire?: QuestionnaireMetadata;

    sections: StudySection[];

    captures: StudyCapture[];

}

export interface StudySection {
    name: string;
    title?: string;
    responses: Record<string, unknown>;
}
