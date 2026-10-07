import type { Capture, MediaType } from "../types/Capture";
import type { Session } from "../types/Session";

interface FirmwareCapture {
    id: string | number;
    mediaType: string;
    file: string;
    timestampMs: number;
}

export interface FirmwareManifest {
    sessionId: string;
    startedAtMs: number;
    finishedAtMs: number;
    captures: FirmwareCapture[];
}

export function isFirmwareManifest(value: unknown): value is FirmwareManifest {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const manifest = value as Partial<FirmwareManifest>;

    return typeof manifest.sessionId === "string" &&
        Number.isFinite(manifest.startedAtMs) &&
        Number.isFinite(manifest.finishedAtMs) &&
        Array.isArray(manifest.captures) &&
        manifest.captures.every((capture) =>
            typeof capture === "object" &&
            capture !== null &&
            (typeof capture.id === "string" || typeof capture.id === "number") &&
            typeof capture.mediaType === "string" &&
            typeof capture.file === "string" && capture.file.trim().length > 0 &&
            Number.isFinite(capture.timestampMs)
        );
}

function formatTimestamp(timestampMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
}

export function convertManifestToSession(
    manifest: FirmwareManifest,
    mediaUrls: Map<string, string>,
    receivedAtMs: number
): Session {
    if (!manifest.captures.length) throw new Error("No captured moments were found in this session.");
    const ids = manifest.captures.map(capture => Number(capture.id));
    if (manifest.captures.some(capture => !String(capture.id).trim()) || new Set(ids).size !== ids.length) throw new Error("Invalid or duplicate capture IDs.");
    const startedAt = new Date(receivedAtMs - manifest.finishedAtMs).toISOString();
    const finishedAt = new Date(receivedAtMs).toISOString();
    const captures: Capture[] = manifest.captures.map((capture) => {
        const id = Number(capture.id);
        const mediaType = capture.mediaType as MediaType;
        const file = (mediaType === "photo" || mediaType === "audio")
            ? mediaUrls.get(capture.file)
            : undefined;

        if (!Number.isFinite(id) || file === undefined) {
            throw new Error(`Missing downloaded media for ${capture.file}.`);
        }

        return {
            id,
            mediaType,
            file,
            sourceFile: capture.file,
            timestamp: formatTimestamp(capture.timestampMs),
            latitude: null,
            longitude: null
        };
    });

    return {
        sessionId: manifest.sessionId,
        startedAt,
        finishedAt,
        captures
    };
}

