import type { PreparedStudyExport } from "./StudyExportPreparation";

/** Initiate both separate downloads synchronously from the same user action. */
export function downloadParticipantPackage(prepared: PreparedStudyExport): void {
    const errors: unknown[] = [];
    for (const [blob, filename] of [
        [prepared.json, `${prepared.participantId}_result.json`],
        [prepared.zip, `${prepared.participantId}_captures.zip`]
    ] as const) {
        try {
            downloadBlob(blob, filename);
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length) throw new AggregateError(errors, "Some participant files could not be downloaded.");
}

/** Starts a browser download; the browser does not report whether it was saved. */
export function downloadJson(data: object, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, filename);
}

export function downloadText(text: string, filename: string, mimeType: string) {
    downloadBlob(new Blob([text], { type: mimeType }), filename);
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    try {
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
    } finally {
        link.remove();
        // Let the browser consume the download URL before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
