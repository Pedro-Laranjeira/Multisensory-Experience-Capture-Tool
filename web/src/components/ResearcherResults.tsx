import { useEffect, useRef, useState } from "react";
import type { StudyResult } from "../types/StudyResult";
import { studyResultsToCsv } from "../services/StudyResultCsvExporter";
import { summarizeStudyResults } from "../services/StudyResultOverview";
import { downloadText } from "../services/DownloadService";
import { importStudyResults } from "../services/StudyResultImportService";
import StudyResultSummary from "./StudyResultSummary";
import { resultLabels, metadataLabels, mediaLabel } from "../services/StudyPresentation";
import type { QuestionnaireDefinition } from "../services/StudyResultSummary";

function displayValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "No response";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
}
function Responses({ values, labels = metadataLabels }: { values: Record<string, unknown>; labels?: Record<string, string> }) {
    if (!Object.keys(values).length) return <p className="participant-help">No responses</p>;
    return <dl className="result-responses">{Object.entries(values).map(([key, value]) => <div key={key}>
        <dt>{labels[key] ?? key}</dt><dd>{displayValue(value)}</dd>
    </div>)}</dl>;
}

export default function ResearcherResults({ definitions }: { definitions: QuestionnaireDefinition[] }) {
    const [confirmClear, setConfirmClear] = useState(false);
    const [actionError, setActionError] = useState("");
    const filesRef = useRef<HTMLInputElement>(null);
    const importButtonRef = useRef<HTMLButtonElement>(null);
    const cancelClearRef = useRef<HTMLButtonElement>(null);
    const clearButtonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => { if (confirmClear) cancelClearRef.current?.focus(); }, [confirmClear]);
    const [results, setResults] = useState<StudyResult[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [summary, setSummary] = useState("");
    const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);
    const busyRef = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const overview = summarizeStudyResults(results);
    function exportCsv() {
        setActionError(""); setSummary("");
        try {
            downloadText(studyResultsToCsv(results, definitions), `multisensory-experience-capture-tool-results-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
            setSummary("CSV download started. Keep the original JSON files as your complete research records.");
        } catch (error) {
            console.error("CSV export failed", error);
            setActionError("The CSV export could not be completed. Your imported results are still here. Please try Export CSV again.");
        }
    }
    const selected = results.find(result => result.resultId === selectedId);
    async function load(files: File[]) {
        if (!files.length || busyRef.current) return;
        busyRef.current = true;
        setBusy(true); setErrors([]); setSummary(""); setActionError(""); setConfirmClear(false);
        try {
            const batch = await importStudyResults(files, results);
            if (!mounted.current) return;
            setResults(batch.results); setErrors(batch.errors);
            setSummary(`${batch.imported} ${batch.imported === 1 ? "result" : "results"} imported. ${batch.duplicates} already imported. ${batch.errors.length} could not be imported.`);
        } catch (error) {
            console.error("Result import could not finish", error);
            setErrors([{ fileName: "Selected results", message: "The import could not finish. Please select the files again." }]);
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    return <section className="participant-panel researcher-results" aria-labelledby="results-title" aria-busy={busy}>
        <h2 id="results-title">Results</h2>
        <p className="participant-intro">Review results collected from completed participant sessions. Import result files to inspect the responses for each session.</p>
        <p className="participant-help">Results stay here until you leave or refresh this page. Keep the original files as your research records.</p>
        <button ref={importButtonRef} className="participant-button" disabled={busy || confirmClear} onClick={() => filesRef.current?.click()}>Import results</button>
        <input ref={filesRef} hidden aria-label="Result files" id="result-files" type="file" accept=".json" multiple disabled={busy || confirmClear} onChange={event => {
            const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void load(files);
        }} />
        <p role="status" aria-live="polite">{busy ? "Importing results..." : summary}</p>
        {errors.length > 0 && <aside className="participant-error" role="alert"><p>Some files could not be imported.</p><ul>
            {errors.map((error, index) => <li key={index}><strong>{error.fileName}</strong>: {error.message}</li>)}
        </ul></aside>}
        {actionError && <p className="participant-error" role="alert">{actionError}</p>}
        {!results.length && <p className="participant-help">No results imported yet. Select completed StudyResult JSON files to begin.</p>}
        {results.length > 0 && <>
            <h3>Results summary</h3>
            <dl className="results-overview">
                <div><dt>Completed responses</dt><dd>{overview.importedResults}</dd></div>
                <div><dt>Captured moments</dt><dd>{overview.capturedMoments}</dd></div>
                <div><dt>Average captures per response</dt><dd>{(overview.capturedMoments / overview.importedResults).toLocaleString("en-GB", { maximumFractionDigits: 1 })}</dd></div>
            </dl>
            <StudyResultSummary results={results} definitions={definitions} />
            {overview.capturedMoments === 0 && <p className="participant-help">These results contain no captured moments to export.</p>}
        </>}
        {results.length > 0 && <h3>Individual results</h3>}
        <div className="researcher-actions">
            <button className="participant-button" disabled={busy || confirmClear || overview.capturedMoments === 0} onClick={exportCsv}>Export CSV</button>
            <button ref={clearButtonRef} className="participant-button participant-button-secondary" disabled={busy || confirmClear || !results.length} onClick={() => setConfirmClear(true)}>Clear imported results</button>
        </div>
        {confirmClear && <section className="results-clear-confirmation" aria-labelledby="clear-results-title">
            <h3 id="clear-results-title">Clear imported results?</h3>
            <p>This clears only this page's imported results and closes the selected result. Your source JSON files and questionnaire configuration will remain unchanged.</p>
            <div className="researcher-actions">
                <button ref={cancelClearRef} className="participant-button participant-button-secondary" onClick={() => { setConfirmClear(false); requestAnimationFrame(() => clearButtonRef.current?.focus()); }}>Cancel</button>
                <button className="participant-button" onClick={() => {
                    setResults([]); setSelectedId(null); setErrors([]); setActionError(""); setConfirmClear(false);
                    setSummary("Imported results cleared from this page. Your source files and questionnaire configuration are unchanged.");
                    requestAnimationFrame(() => importButtonRef.current?.focus());
                }}>Confirm clear</button>
            </div>
        </section>}
        {results.length > 0 && <>
            <ul className="result-list">{results.map(result => <li key={result.resultId}>
                <h3>{result.participantId}</h3>
                <p>{result.captures.length} captured moments &middot; <time dateTime={result.completedAt}>{new Date(result.completedAt).toLocaleString("en-GB")}</time></p>
                {result.questionnaire?.name && <p>{result.questionnaire.name}</p>}
                <p className="participant-help">Result: {result.resultId}</p>
                <button className="participant-button participant-button-secondary" aria-label={`Inspect ${result.participantId} result ${result.resultId} for session ${result.sessionId}`} aria-expanded={selectedId === result.resultId} aria-controls="result-detail" onClick={() => setSelectedId(result.resultId)}>Inspect result</button>
            </li>)}</ul>
        </>}
        {selected && <IndividualResult selected={selected} definitions={definitions} onClose={() => { setSelectedId(null); importButtonRef.current?.focus(); }} />}
    </section>;
}

export function IndividualResult({ selected, definitions, onClose }: { selected: StudyResult; definitions: QuestionnaireDefinition[]; onClose: () => void }) {
    const detailHeading = useRef<HTMLHeadingElement>(null);
    useEffect(() => { detailHeading.current?.focus(); }, [selected.resultId]);
    const labels = resultLabels(selected, definitions);
    return <section id="result-detail" className="result-detail" aria-labelledby="result-detail-title">
            <h3 id="result-detail-title" ref={detailHeading} tabIndex={-1}>Session information</h3>
            <Responses values={{ participantId: selected.participantId, sessionId: selected.sessionId, resultId: selected.resultId, completedAt: new Date(selected.completedAt).toLocaleString("en-GB"), captureCount: selected.captures.length, ...(selected.questionnaire ? { questionnaire: selected.questionnaire } : {}) }} />
            {selected.sections.map(section => <section key={section.name}>
                <h3>{labels.sections[section.name].title}</h3>
                <Responses labels={labels.sections[section.name].questions} values={section.responses} />
            </section>)}
            <h3>Captured moments</h3>
            {selected.captures.map(capture => <article className="result-capture" key={capture.id}>
                <h4>Captured moment {capture.id}</h4>
                <Responses values={{ mediaType: mediaLabel(capture.mediaType), sourceFile: capture.sourceFile, exportFile: capture.exportFile, timestamp: capture.timestamp, ...(capture.latitude !== null ? { latitude: capture.latitude } : {}), ...(capture.longitude !== null ? { longitude: capture.longitude } : {}) }} />
                <h4>Reflection</h4><Responses labels={labels.reflection} values={capture.reflection} />
            </article>)}
            <button className="participant-text-button" onClick={onClose}>Close result</button>
        </section>;
}
