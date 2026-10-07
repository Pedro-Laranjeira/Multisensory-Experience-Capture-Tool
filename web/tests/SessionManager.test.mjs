import assert from "node:assert/strict";
import { test } from "node:test";
import { clearCurrentSession, getCurrentSession, setCurrentSession } from "../src/services/SessionManager.ts";

test("starts empty, records explicit real sources, and clears without a demo fallback", () => {
    assert.equal(getCurrentSession(), null);
    const session = { sessionId: "test", captures: [], startedAt: "", finishedAt: "" };
    for (const source of ["files", "ble"]) {
        setCurrentSession(session, source);
        assert.equal(getCurrentSession().session, session);
        assert.equal(getCurrentSession().source, source);
        clearCurrentSession();
        assert.equal(getCurrentSession(), null);
    }
});
