import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import ResearcherResults from "../components/ResearcherResults";
import PageShell from "../components/PageShell";
import { saveTemplate, loadStoredTemplate, resetTemplate } from "../services/TemplateManager";
import { parseQuestionnaire, QuestionnaireValidationError, validateQuestionnaire } from "../services/QuestionnaireValidation";
import { downloadJson } from "../services/DownloadService";
import defaultTemplate from "../survey/template_base.json";

function loadActiveQuestionnaire() {
    try {
        const stored = loadStoredTemplate();
        const validated = validateQuestionnaire(stored ? stored.survey : defaultTemplate);
        return { stored, ...validated, error: "", details: "" };
    } catch (error) {
        console.error("Questionnaire loading failed", error);
        return {
            stored: null, survey: null, sections: [],
            error: error instanceof QuestionnaireValidationError ? error.message : "The saved questionnaire could not be loaded. Please check browser storage access and try again.",
            details: error instanceof QuestionnaireValidationError ? error.details ?? "" : ""
        };
    }
}

export default function ResearcherPage() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const readerRef = useRef<FileReader | null>(null);
    useEffect(() => () => {
        const reader = readerRef.current;
        if (reader) { reader.onload = null; reader.onerror = null; reader.abort(); }
    }, []);
    const [active, setActive] = useState(loadActiveQuestionnaire);
    const { stored } = active;
    const [message, setMessage] = useState("");
    const [error, setError] = useState(active.error);
    const [errorDetails, setErrorDetails] = useState(active.details);
    const [isReading, setIsReading] = useState(false);

    function handleFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || readerRef.current?.readyState === FileReader.LOADING) return;

        setIsReading(true);
        setMessage("");
        setError("");
        setErrorDetails("");
        const reader = new FileReader();
        readerRef.current = reader;
        reader.onload = () => {
            try {
                if (typeof reader.result !== "string") throw new Error("Unreadable file");
                const survey = parseQuestionnaire(reader.result);
                saveTemplate(file.name, survey);
                setActive(loadActiveQuestionnaire());
                setMessage("Questionnaire uploaded. It will be used for new participant reflections.");
            } catch (validationError) {
                console.error("Questionnaire upload failed", validationError);
                setError(validationError instanceof QuestionnaireValidationError
                    ? validationError.message : "The questionnaire could not be saved. Please try again.");
                setErrorDetails(validationError instanceof QuestionnaireValidationError ? validationError.details ?? "" : "");
            } finally {
                setIsReading(false);
            }
        };
        reader.onerror = () => {
            console.error("Questionnaire file read failed", reader.error);
            setIsReading(false);
            setError("The file could not be read. Please select it again.");
        };
        try { reader.readAsText(file); } catch (readError) {
            console.error("Questionnaire file read failed", readError);
            setIsReading(false);
            setError("The file could not be read. Please select it again.");
        }
    }

    function handleReset() {
        try {
        resetTemplate();
        setActive(loadActiveQuestionnaire());
        setError("");
        setErrorDetails("");
        setMessage("The bundled default questionnaire is now in use.");
        } catch (resetError) {
            console.error("Questionnaire reset failed", resetError);
            setMessage("");
            setError("The questionnaire could not be reset. Please try again.");
        }
    }

    return (
        <PageShell context="Researcher setup" showHomeLink>
            <section className="participant-panel" aria-labelledby="researcher-title">
                <h2 id="researcher-title">Configure the reflection questionnaire</h2>
                <p className="participant-intro">
                    The questionnaire JSON is a SurveyJS definition of your questions and pages.
                    Create or edit it in SurveyJS Creator, then upload the exported JSON here.
                </p>

                <div className="researcher-actions">
                    <a className="participant-button" href="https://surveyjs.io/create-free-survey" target="_blank" rel="noreferrer">Open SurveyJS Creator</a>
                    <button className="participant-button participant-button-secondary" type="button" onClick={() => {
                        setError(""); setMessage(""); setErrorDetails("");
                        try {
                            downloadJson(defaultTemplate, "multisensory-experience-capture-tool-default-questionnaire.json");
                            setMessage("Default questionnaire download started. Open its JSON in SurveyJS Creator to begin editing.");
                        } catch (downloadError) {
                            console.error("Default questionnaire download failed", downloadError);
                            setError("The default questionnaire download could not start. Please try again.");
                        }
                    }}>Download default questionnaire</button>
                </div>
                <p className="participant-help">Use the default questionnaire as a starting point. Downloading it does not replace your current questionnaire.</p>
                <ul>
                    <li>Capture reflections are required and repeat once per captured moment.</li>
                    <li>Participant/profile questions are optional and answered once.</li>
                    <li>Overall experience and final reflections are optional and answered once after the capture reflections.</li>
                </ul>
                <details>
                    <summary>Technical setup note</summary>
                    <p>Keep exactly one page named <code>__capture_template__</code>, with at least one answerable question. All other pages are optional sections: give each a unique name and arrange them in any order before or after the capture template.</p>
                </details>

                <section className="researcher-current" aria-labelledby="current-title">
                    <h3 id="current-title">Current questionnaire</h3>
                    <p className="questionnaire-state">{active.survey ? "Questionnaire ready" : "Questionnaire unavailable"}</p>
                    {stored ? <dl className="questionnaire-metadata">
                        <dt>File</dt><dd>{stored.fileName}</dd>
                        <dt>Uploaded</dt><dd>{new Date(stored.uploadedAt).toLocaleString("en-GB")}</dd>
                    </dl> : active.survey ? <p className="participant-help">Bundled default questionnaire</p> :
                        <p className="participant-help">Upload a valid questionnaire or reset to default to continue.</p>}
                    {active.survey && <>
                        <h4>Structure</h4>
                        <ul className="questionnaire-structure">
                            {active.sections.map((section, index) => <li key={index}>
                                <span>{section.label}</span>
                                <span>{section.questionCount} {section.questionCount === 1 ? "question" : "questions"} ({section.perCapture ? "Required; repeated per moment" : "Optional; answered once"})</span>
                            </li>)}
                        </ul>
                        <p className="participant-help">Counts include answerable questions, including conditional questions. Hidden metadata and display-only content are excluded; matrices and repeated groups count as one question.</p>
                    </>}
                </section>

                <section className="researcher-upload" aria-labelledby="upload-title">
                    <h3 id="upload-title">Upload or replace questionnaire</h3>
                    <button className="participant-button" disabled={isReading} onClick={() => fileInputRef.current?.click()}>Choose questionnaire file</button>
                    <p id="questionnaire-file-help" className="participant-help">Choose the JSON file exported from SurveyJS Creator to replace the current questionnaire for new participant reflections.</p>
                    <input ref={fileInputRef} hidden aria-label="Questionnaire file" id="questionnaire-file" type="file" accept=".json" onChange={handleFile}
                        disabled={isReading} aria-describedby="questionnaire-file-help" />
                </section>

                <div role="status" aria-live="polite" aria-atomic="true">
                    {(isReading || message) && <p className="researcher-feedback">{isReading ? "Loading questionnaire..." : message}</p>}
                </div>
                {error && <aside className="participant-error">
                    <p role="alert">{error}</p>
                    {errorDetails && <details><summary>Technical details</summary><pre>{errorDetails}</pre></details>}
                </aside>}
                <p className="participant-help">Reset to default restores the bundled questionnaire and replaces your uploaded selection.</p>
                <div className="researcher-actions">
                    <button className="participant-button participant-button-secondary" type="button" disabled={isReading || !active.survey}
                        onClick={() => {
                            setError(""); setMessage(""); setErrorDetails("");
                            try { if (active.survey) downloadJson(active.survey, stored?.fileName ?? "reflection-questionnaire.json"); }
                            catch (downloadError) { console.error("Questionnaire download failed", downloadError); setError("The questionnaire download could not start. Please try again."); }
                        }}>Download current questionnaire</button>
                    <button className="participant-button participant-button-secondary" type="button" onClick={handleReset} disabled={isReading}>
                        Reset to default
                    </button>
                </div>
            </section>
            <ResearcherResults definitions={[
                { metadata: { name: "Bundled default questionnaire" }, survey: defaultTemplate },
                ...(stored && active.survey ? [{ metadata: { name: stored.fileName, uploadedAt: stored.uploadedAt }, survey: active.survey }] : [])
            ]} />
        </PageShell>
    );
}
