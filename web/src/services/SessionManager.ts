import type { Session } from "../types/Session";

export type SessionSource = "ble" | "files";

export interface ActiveSession {
    session: Session;
    source: SessionSource;
}

// No implicit demo: a real session is available only after a complete load.
let currentSession: ActiveSession | null = null;

export function getCurrentSession(): ActiveSession | null {
    return currentSession;
}

export function setCurrentSession(session: Session, source: SessionSource): void {
    currentSession = { session, source };
}

export function clearCurrentSession(): void {
    currentSession = null;
}
