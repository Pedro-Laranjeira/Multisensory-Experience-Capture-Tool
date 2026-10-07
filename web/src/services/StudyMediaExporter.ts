import JSZip from "jszip";
import type { MediaType } from "../types/Capture";
import type { Session } from "../types/Session";
import type { StudyResult } from "../types/StudyResult";
import { validateStudyResult } from "./StudyResultValidation.ts";

const extensions = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "avif", "wav", "mp3", "ogg", "m4a", "aac", "flac", "webm", "mp4", "mov"]);
export function captureExportFilename(participantId: string, sequence: number, source: string, mediaType: MediaType): string {
    const extension = /\.([a-z0-9]+)$/i.exec(source.trim().split(/[?#]/)[0])?.[1].toLowerCase();
    const fallback = { photo: "jpg", audio: "wav", video: "mp4" };
    return `${participantId}_capture_${String(sequence).padStart(2, "0")}.${extension && extensions.has(extension) ? extension : fallback[mediaType]}`;
}

/** Both current transports expose their File/Blob through Capture.file object URLs. */
export async function createStudyMediaZip(session: Session, result: StudyResult): Promise<Blob> {
    validateStudyResult(result);
    if (session.sessionId !== result.sessionId || session.captures.length !== result.captures.length) {
        throw new Error("Result and media session do not match.");
    }
    const zip = new JSZip();
    for (const [index, capture] of session.captures.entries()) {
        const exported = result.captures[index];
        if (capture.id !== exported.id || (capture.sourceFile ?? capture.file) !== exported.sourceFile) {
            throw new Error("Result and capture media do not match.");
        }
        const response = await fetch(capture.file);
        if (!response.ok) throw new Error(`Unable to load ${exported.sourceFile}.`);
        const blob = await response.blob();
        if (!blob.size) throw new Error(`Media file ${exported.sourceFile} is empty.`);
        // ArrayBuffer works in browsers and in the Node test environment.
        zip.file(exported.exportFile, await blob.arrayBuffer());
    }
    return zip.generateAsync({ type: "blob" });
}
