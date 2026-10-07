// Keep this legacy persistent key to preserve numbering and share the counter
// with older tool versions still open in another tab on the same origin.
const COUNTER_KEY = "pic2.nextParticipantNumber";
type CounterStorage = Pick<Storage, "getItem" | "setItem">;

export function peekParticipantId(storage: CounterStorage = localStorage): string {
    const raw = storage.getItem(COUNTER_KEY);
    const next = raw === null ? 1 : Number(raw);
    if (!Number.isSafeInteger(next) || next < 1 || next >= Number.MAX_SAFE_INTEGER) {
        throw new Error("The participant counter is invalid. Please contact the researcher.");
    }
    return `P${String(next).padStart(3, "0")}`;
}

/** Commit only after both export artifacts have been prepared. */
export function consumeParticipantId(id: string, storage: CounterStorage = localStorage): void {
    if (peekParticipantId(storage) !== id) throw new Error("The participant counter changed. Please retry preparation.");
    storage.setItem(COUNTER_KEY, String(Number(id.slice(1)) + 1));
}
