/**
 * ============================================================
 * File: Session.ts
 * ============================================================
 *
 * Represents one complete research session.
 *
 * Every participant generates exactly one session.
 *
 * A session contains:
 *
 * - participant questionnaire
 * - capture list
 * - GPS track
 * - exported results
 * ============================================================
 */

import type { Capture } from "./Capture";

export interface Session {

    sessionId: string;

    startedAt: string;

    finishedAt: string;

    captures: Capture[];

}