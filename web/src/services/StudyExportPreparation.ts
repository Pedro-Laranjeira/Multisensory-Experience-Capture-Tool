import type { Session } from "../types/Session";
import type { StudyResult } from "../types/StudyResult";
import { peekParticipantId, consumeParticipantId } from "./ParticipantIdService.ts";
import { createStudyMediaZip } from "./StudyMediaExporter.ts";

export interface PreparedStudyExport { participantId: string; json: Blob; zip: Blob }

/** A failed preparation leaves the counter untouched and can be retried with the same answers. */
export async function prepareStudyExport(
    session: Session,
    buildResult: (participantId: string) => StudyResult,
    isCurrent: () => boolean = () => true,
    storage: Pick<Storage, "getItem" | "setItem"> = localStorage
): Promise<PreparedStudyExport> {
    const prepare = async () => {
        const participantId = peekParticipantId(storage);
        const result = buildResult(participantId);
        if (result.participantId !== participantId) throw new Error("Result participant ID does not match.");
        const json = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
        const zip = await createStudyMediaZip(session, result);
        if (!isCurrent()) throw new Error("Export preparation was cancelled.");
        consumeParticipantId(participantId, storage);
        return { participantId, json, zip };
    };
    // Keep the legacy lock name to coordinate participant-number allocation
    // with older tabs sharing the same persistent counter.
    return typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request("pic2.participantExport", prepare)
        : prepare();
}
