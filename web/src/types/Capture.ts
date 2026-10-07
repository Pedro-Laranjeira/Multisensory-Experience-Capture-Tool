/**
 * ============================================================
 * File: Capture.ts
 * ============================================================
 *
 * Represents ONE capture performed during the field session.
 *
 * A capture corresponds to the participant pressing one of the
 * hardware buttons.
 *
 * At this stage the capture only contains metadata.
 *
 * ============================================================
 */

export type MediaType = "photo" | "audio" | "video";

export interface Capture {

    /**
     * Unique capture identifier.
     */
    id: number;

    /**
     * Type of media captured.
     */
    mediaType: MediaType;

    /**
     * Relative path to the media.
     */
    file: string;

    /** Original device filename when file is represented by an object URL. */
    sourceFile?: string;

    /**
     * Timestamp since the beginning of the walk.
     */
    timestamp: string;

    /**
     * GPS coordinates.
     *
     * They will initially be null because
     * they are assigned after matching the phone's GPS track.
     */
    latitude: number | null;

    longitude: number | null;

}