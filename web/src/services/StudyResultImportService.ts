import type { StudyResult } from "../types/StudyResult";
import { StudyResultValidationError, validateStudyResult } from "./StudyResultValidation.ts";

export async function importStudyResults(files: readonly File[], existing: readonly StudyResult[]) {
    const results = [...existing];
    const ids = new Set(existing.map(result => result.resultId));
    const errors: { fileName: string; message: string }[] = [];
    let imported = 0;
    let duplicates = 0;
    for (const file of files) {
        try {
            let value: unknown;
            const content = await file.text();
            try { value = JSON.parse(content); }
            catch { throw new StudyResultValidationError("This file is not valid JSON."); }
            const result = validateStudyResult(value);
            if (ids.has(result.resultId)) { duplicates++; continue; }
            results.push(result);
            ids.add(result.resultId);
            imported++;
        } catch (error) {
            console.error("Study result import failed", file.name, error);
            errors.push({ fileName: file.name, message: error instanceof StudyResultValidationError ? error.message : "This file could not be read. Please select it again." });
        }
    }
    return { results, imported, duplicates, errors };
}
