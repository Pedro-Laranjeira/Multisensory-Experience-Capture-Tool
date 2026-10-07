import type { StudyResult } from "../types/StudyResult";

export function summarizeStudyResults(results: readonly StudyResult[]) {
    const configurations = new Set<string>();
    let unknownQuestionnaires = 0;
    for (const { questionnaire } of results) {
        if (!questionnaire?.name && !questionnaire?.uploadedAt) { unknownQuestionnaires++; continue; }
        configurations.add(JSON.stringify([questionnaire.name ?? null, questionnaire.uploadedAt ?? null]));
    }
    return {
        importedResults: results.length,
        uniqueSessions: new Set(results.map(result => result.sessionId)).size,
        capturedMoments: results.reduce((total, result) => total + result.captures.length, 0),
        questionnaireConfigurations: configurations.size,
        unknownQuestionnaires
    };
}
