import { convertManifestToSession, isFirmwareManifest } from "./CaptureSessionManifest.ts";
import type { Session } from "../types/Session";

export interface CaptureFileImportResult {
    session: Session;
    objectUrls: string[];
}

export interface FileImportDiagnostics {
    required: string[];
    selected: string[];
    unmatched: string[];
}

export class CaptureFileImportError extends Error {
    readonly diagnostics: FileImportDiagnostics;

    constructor(message: string, diagnostics: FileImportDiagnostics) {
        super(message);
        this.name = "CaptureFileImportError";
        this.diagnostics = diagnostics;
    }
}

// Local import tolerates ASCII case differences, but never strips suffixes,
// changes extensions, or trims the actual File.name supplied by the browser.
const filenameKey = (name: string) => name.replace(/[A-Z]/g, (char) => char.toLowerCase());

export async function loadCaptureSessionFiles(
    files: readonly File[],
    onStatus?: (status: string) => void
): Promise<CaptureFileImportResult> {
    onStatus?.("Loading session...");
    const diagnostics: FileImportDiagnostics = {
        required: [],
        selected: files.map((file) => file.name),
        unmatched: []
    };
    const fail = (message: string): never => {
        console.error("Capture file import failed", message, diagnostics);
        throw new CaptureFileImportError(message, diagnostics);
    };
    const selectedFiles = new Map<string, File>();
    const duplicates: string[] = [];
    for (const file of files) {
        const key = filenameKey(file.name);
        const existing = selectedFiles.get(key);
        if (existing) {
            duplicates.push(`${JSON.stringify(existing.name)} / ${JSON.stringify(file.name)}`);
        } else {
            selectedFiles.set(key, file);
        }
    }

    const manifestFile = selectedFiles.get("session.json");
    if (!manifestFile) {
        return fail("session.json is missing. Select it together with its JPEG photo and WAV audio files.");
    }
    if (files.filter((file) => filenameKey(file.name) === "session.json").length > 1) {
        fail("Duplicate filename: multiple session.json files selected. Select only one manifest.");
    }

    const text = await manifestFile.text();
    let manifest: unknown;
    try {
        manifest = JSON.parse(text);
    } catch {
        fail("session.json contains malformed JSON.");
    }
    if (!isFirmwareManifest(manifest)) {
        return fail("Invalid session.json: expected sessionId, startedAtMs, finishedAtMs, and captures with id, mediaType, file, and timestampMs.");
    }

    diagnostics.required = manifest.captures.map((capture) => capture.file);
    const requiredKeys = new Set(diagnostics.required.map((name) => filenameKey(name.trim())));
    diagnostics.unmatched = files.filter((file) =>
        filenameKey(file.name) !== "session.json" && !requiredKeys.has(filenameKey(file.name))
    ).map((file) => file.name);
    console.debug("Capture file import filenames", diagnostics);
    if (duplicates.length) {
        fail(`Duplicate filename (case-insensitive ambiguity): ${duplicates.join(", ")}. Select only one of each.`);
    }

    const captureIds = new Set<number>();
    const missingFiles = new Set<string>();
    for (const capture of manifest.captures) {
        if (capture.mediaType !== "photo" && capture.mediaType !== "audio") {
            fail(`Unsupported capture type ${capture.mediaType} for ${capture.file}. File import currently supports JPEG photos and WAV audio.`);
        }
        const id = Number(capture.id);
        if (!String(capture.id).trim() || !Number.isFinite(id) || captureIds.has(id)) {
            fail(`Invalid session.json: capture ID ${capture.id} must be numeric and unique.`);
        }
        captureIds.add(id);
        if (capture.mediaType === "photo" && !/\.jpe?g$/i.test(capture.file.trim())) {
            fail(`Unsupported photo file: ${capture.file}. Expected a .JPG or .JPEG filename.`);
        }
        if (capture.mediaType === "audio" && !/\.wav$/i.test(capture.file.trim())) {
            fail(`Unsupported audio file: ${capture.file}. Expected a .WAV filename.`);
        }
        if (!selectedFiles.has(filenameKey(capture.file.trim()))) {
            missingFiles.add(capture.file);
        }
    }
    if (missingFiles.size) {
        fail(`Missing referenced media files: ${[...missingFiles].map((name) => JSON.stringify(name)).join(", ")}. Case is ignored; extensions, suffixes, and other characters must match.`);
    }

    const objectUrls: string[] = [];
    try {
        const mediaUrls = new Map<string, string>();
        for (const capture of manifest.captures) {
            if (mediaUrls.has(capture.file)) continue;
            const file = selectedFiles.get(filenameKey(capture.file.trim()));
            if (!file) return fail(`Missing referenced media file: ${capture.file}.`);
            const url = URL.createObjectURL(file);
            objectUrls.push(url);
            mediaUrls.set(capture.file, url);
        }
        onStatus?.("Preparing questionnaire...");
        return {
            session: convertManifestToSession(manifest, mediaUrls, Date.now()),
            objectUrls
        };
    } catch (error) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return fail(error instanceof DOMException ? `Unable to import session files (${error.name}). Please select the files again.` : error instanceof Error ? error.message : "Unable to import session files.");
    }
}
