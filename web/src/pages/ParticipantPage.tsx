import { useEffect, useRef, useState } from "react";
import { configureEnglishSurveyDefaults } from "../services/SurveyPresentation";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import { Link } from "react-router-dom";
import { participantTheme } from "../styles/participantTheme";
import PageShell from "../components/PageShell";

import { loadStoredTemplate } from "../services/TemplateManager";
import { loadSurveyTemplate } from "../services/SurveyLoader";
import { buildSurvey } from "../services/SurveyTemplateProcessor";
import { clearCurrentSession, getCurrentSession, setCurrentSession } from "../services/SessionManager";
import type { SessionSource } from "../services/SessionManager";
import {
    CaptureDeviceBleError,
    disconnectCaptureDevice,
    loadCaptureDeviceSession
} from "../services/CaptureDeviceBleService";
import { buildStudyResult } from "../services/StudyResultBuilder";
import { downloadParticipantPackage } from "../services/DownloadService";
import type { Session } from "../types/Session";
import { loadCaptureSessionFiles, CaptureFileImportError } from "../services/CaptureFileImportService";
import type { FileImportDiagnostics } from "../services/CaptureFileImportService";

import { prepareStudyExport } from "../services/StudyExportPreparation";
import type { PreparedStudyExport } from "../services/StudyExportPreparation";

interface LoadedSession {
    session: Session;
    source: SessionSource;
    objectUrls: string[];
    device?: BluetoothDevice;
}

function releaseSession(loaded: { objectUrls: string[]; device?: BluetoothDevice }) {
    loaded.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    if (loaded.device) disconnectCaptureDevice(loaded.device);
}

export default function ParticipantPage() {
    const [prepared, setPrepared] = useState<PreparedStudyExport | null>(null);
    const [isPreparing, setIsPreparing] = useState(false);
    const [loaded, setLoaded] = useState<LoadedSession | null>(null);
    const session = loaded?.session;
    const [stage, setStage] = useState<"ready" | "reflection" | "saving" | "complete">("ready");
    const [survey, setSurvey] = useState<Model | null>(null);
    const [pageName, setPageName] = useState("");
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    const [errorDetail, setErrorDetail] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [diagnostics, setDiagnostics] = useState<FileImportDiagnostics | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const deviceRef = useRef<BluetoothDevice | undefined>(undefined);
    const mountedRef = useRef(false);
    const loadIdRef = useRef(0);
    const busyRef = useRef(false);
    const saveRef = useRef<(() => void) | null>(null);
    const ownedSessionRef = useRef<Session | null>(null);

    useEffect(() => {
        clearCurrentSession();
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // Do not leave SessionManager pointing to revoked media on return.
            if (getCurrentSession()?.session === ownedSessionRef.current) {
                clearCurrentSession();
            }
            if (deviceRef.current) disconnectCaptureDevice(deviceRef.current);
        };
    }, []);

    useEffect(() => {
        const previousDevice = deviceRef.current;
        deviceRef.current = loaded?.device;
        if (previousDevice && previousDevice !== loaded?.device) {
            disconnectCaptureDevice(previousDevice);
        }
        // Cleanup runs after React replaces the old questionnaire, or on unmount.
        return () => loaded?.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }, [loaded]);

    useEffect(() => {
        headingRef.current?.focus();
    }, [loaded, stage]);

    useEffect(() => () => survey?.dispose(), [survey]);

    async function loadSession(files?: File[]) {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;
        const loadId = ++loadIdRef.current;
        const isCurrent = () => mountedRef.current && loadId === loadIdRef.current;
        setIsLoading(true);
        setError(null);
        setDiagnostics(null);
        setErrorDetail("");
        setSurvey(null);
        setStage("ready");
        clearCurrentSession();
        setLoaded(null);
        setStatus(files ? "Loading your session..." : "Connecting to capture device...");

        let transferred = false;
        try {
            const onStatus = (message: string) => {
                if (!isCurrent()) return;
                const captureProgress = /Downloading capture (\d+) of (\d+)/.exec(message);
                setStatus(captureProgress
                    ? `Loading your captured moments: ${captureProgress[1]} of ${captureProgress[2]}...`
                    : message.includes("Preparing") ? "Preparing your reflections..." : "Loading your session...");
            };
            const result = files
                ? await loadCaptureSessionFiles(files, onStatus)
                : await loadCaptureDeviceSession({
                    onDisconnected: () => {
                        if (!isCurrent() || transferred) return;
                        setError("The connection was interrupted. Please try again.");
                    },
                    onStatus
                });

            if (!isCurrent()) {
                releaseSession(result);
                return;
            }
            if (!result.session.captures.length) {
                releaseSession(result);
                throw new Error("No captured moments were found in this session.");
            }
            transferred = true;
            setStatus("");
            ownedSessionRef.current = result.session;
            const source: SessionSource = files ? "files" : "ble";
            setCurrentSession(result.session, source);
            setLoaded({ ...result, source });

        } catch (loadError) {
            if (!isCurrent()) return;
            const message = loadError instanceof Error
                ? loadError.message
                : "Unable to load the session.";
            console.error("Session loading failed", loadError);
            setError(message.includes("No captured moments")
                ? "No captured moments were found in this session. Please load another session."
                : files ? message.includes("Missing referenced image")
                    ? "Some captured moments are missing from the selected files. Please choose the session file and all its photos again."
                    : "The selected capture session could not be read. Please check the selected files and try again."
                : loadError instanceof CaptureDeviceBleError && loadError.kind === "cancelled"
                    ? "Connection cancelled. You can try connecting again or import from SD card instead."
                    : "We could not connect to the capture device or finish loading your session. Make sure the device is nearby and available, then try again.");
            if (files) setErrorDetail(message);
            if (loadError instanceof CaptureFileImportError) {
                setDiagnostics(loadError.diagnostics);
            }
            setStatus("");
        } finally {
            if (isCurrent()) { busyRef.current = false; setIsLoading(false); }
        }
    }

    function beginReflection() {
        if (!session || survey || busyRef.current) return;
        setError(null);
        setErrorDetail("");
        setDiagnostics(null);
        try {
            const storedQuestionnaire = loadStoredTemplate();
            const questionnaire = storedQuestionnaire
                ? { name: storedQuestionnaire.fileName, uploadedAt: storedQuestionnaire.uploadedAt }
                : { name: "Bundled default questionnaire" };
            const generatedSurvey = buildSurvey(loadSurveyTemplate(), session);
            const model = new Model(generatedSurvey);
            configureEnglishSurveyDefaults(model);
            if (!model.visiblePages.length) { model.dispose(); throw new Error("Generated questionnaire is not usable."); }
            model.applyTheme(participantTheme);
            model.widthMode = "responsive";
            model.pagePrevText = "Previous";
            model.pageNextText = "Continue";
            model.completeText = "Complete reflection";
            model.showCompletedPage = false;
            model.showProgressBar = true;
            model.progressBarLocation = "top";
            model.progressBarType = "pages";
            model.onAfterRenderQuestion.add((_sender, options) => {
                options.htmlElement.querySelectorAll<HTMLImageElement | HTMLMediaElement>("img, audio, video").forEach(media => {
                    const showError = () => {
                        media.hidden = true;
                        if (media.nextElementSibling?.classList.contains("capture-media-error")) return;
                        const message = document.createElement("p");
                        message.className = "capture-media-error";
                        message.setAttribute("role", "status");
                        message.textContent = "This captured moment could not be displayed. Please let the researcher know; you can still continue the questionnaire.";
                        media.after(message);
                        console.error("Capture media preview failed", media.tagName);
                    };
                    media.addEventListener("error", showError, { once: true });
                    if (media instanceof HTMLImageElement ? media.complete && media.naturalWidth === 0 : media.error) showError();
                });
            });
            model.onCurrentPageChanged.add(() => setPageName(model.currentPage?.name ?? ""));
            let preparing = false;
            const save = async () => {
                if (preparing) return;
                preparing = true;
                setIsPreparing(true);
                setError(null);
                try {
                    const files = await prepareStudyExport(
                        session,
                        participantId => buildStudyResult(model.data, session, generatedSurvey, participantId, questionnaire),
                        () => mountedRef.current
                    );
                    setPrepared(files);
                    setStage("complete");
                } catch (saveError) {
                    console.error("Study export preparation failed", saveError);
                    if (mountedRef.current) {
                        setError("We could not prepare your export files. Your completed answers are still available here. Please retry preparation.");
                        setErrorDetail(saveError instanceof Error ? saveError.message : "Export preparation failed.");
                    }
                } finally {
                    preparing = false;
                    if (mountedRef.current) setIsPreparing(false);
                }
            };
            saveRef.current = () => { void save(); };
            model.onComplete.add(() => { setStage("saving"); void save(); });
            setPageName(model.currentPage?.name ?? "");
            setSurvey(model);
            setError(null);
            setStage("reflection");
        } catch (preparationError) {
            console.error("Reflection preparation failed", preparationError);
            setError("We could not prepare the reflection questionnaire for this session. Try Begin reflection again, or load a different session.");
        }
    }

    function downloadPrepared() {
        if (!prepared) return;
        setError(null);
        try {
            downloadParticipantPackage(prepared);
        } catch (downloadError) {
            console.error("Download failed", downloadError);
            setError("Some files could not be downloaded. Your participant package is still ready. Please try downloading it again.");
        }
    }

    const captureIndex = session?.captures.findIndex((capture) => pageName === `capture_${capture.id}`) ?? -1;
    const isCapturePage = captureIndex >= 0;
    const captureProgress = `Captured Moment ${captureIndex + 1} of ${session?.captures.length}`;

    return (
        <PageShell context="Participant reflection">

                {!loaded && <section className="participant-panel" aria-labelledby="loading-title" aria-busy={isLoading}>
                    <h2 id="loading-title" ref={headingRef} tabIndex={-1}>Load your capture session</h2>
                    <p className="participant-intro">Complete your capture experience before continuing. Once your session is loaded, your captured moments will guide you through a reflection questionnaire.</p>
                    <div className="participant-methods">
                        <section className="participant-method" aria-labelledby="wireless-title">
                            <h3 id="wireless-title">Wireless / Bluetooth</h3>
                            <p>Wireless transfer may take a little while, especially for sessions with several captures. Keep the capture device nearby and powered until the transfer finishes.</p>
                            <button className="participant-button" type="button" onClick={() => void loadSession()} disabled={isLoading}>
                                Connect wirelessly
                            </button>
                        </section>
                        <section className="participant-method" aria-labelledby="sd-import-title">
                            <h3 id="sd-import-title">Import from SD card</h3>
                            <p>After ending the session, power off the capture device and remove its microSD card. Connect the card to the computer using a card reader or adapter.</p>
                            <p id="file-help" className="participant-help">Select <code>session.json</code> together with all the photo files listed in that session.</p>
                            <button className="participant-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} aria-describedby="file-help">
                                Import from SD card
                            </button>
                        </section>
                    </div>
                    <input ref={fileInputRef} type="file" accept=".json,.jpg,.jpeg,.wav" multiple hidden aria-label="Session file and captured photos or audio"
                        onChange={(event) => {
                            const files = Array.from(event.currentTarget.files ?? []);
                            event.currentTarget.value = "";
                            if (files.length) void loadSession(files);
                        }} />
                </section>}

                {loaded && stage === "ready" && <section className="participant-panel participant-confirmation" aria-labelledby="ready-title">
                    <p className="participant-eyebrow">Ready to reflect</p>
                    <h2 id="ready-title" ref={headingRef} tabIndex={-1}>Your session is ready</h2>
                    <p className="participant-intro">{session?.captures.length} captured {session?.captures.length === 1 ? "moment was" : "moments were"} loaded successfully.</p>
                    <p>Take your time as you revisit each moment and reflect on your experience.</p>
                    <button className="participant-button" type="button" onClick={beginReflection}>Begin reflection</button>
                    <button className="participant-text-button" type="button" onClick={() => {
                        ++loadIdRef.current;
                        clearCurrentSession();
                        setLoaded(null);
                        setError(null);
                    }}>Load a different session</button>
                </section>}

                <div role="status" aria-live="polite" aria-atomic="true">
                    {isLoading && <div className="participant-status"><span className="participant-status-dot" aria-hidden="true" /><p>{status}</p></div>}
                </div>
                {error && <aside className="participant-error">
                    <p role="alert">{error}</p>
                    {(errorDetail || diagnostics) && <details>
                        <summary>Details for the researcher</summary>
                        {errorDetail && <p>{errorDetail}</p>}
                        {diagnostics && <>
                            <p>Required by session:</p>
                            <ul>{diagnostics.required.map((name, index) => <li key={index}><code>{JSON.stringify(name)}</code></li>)}</ul>
                            <p>Files actually selected:</p>
                            <ul>{diagnostics.selected.map((name, index) => <li key={index}><code>{JSON.stringify(name)}</code></li>)}</ul>
                            {diagnostics.unmatched.length > 0 && <>
                                <p>Selected files not referenced by the session:</p>
                                <ul>{diagnostics.unmatched.map((name, index) => <li key={index}><code>{JSON.stringify(name)}</code></li>)}</ul>
                            </>}
                            <p>Matching ignores capitalization and surrounding whitespace in manifest filenames. Extensions and suffixes must match.</p>
                        </>}
                    </details>}
                </aside>}

                {survey && stage === "reflection" && <section className="participant-reflection" aria-label="Experience questionnaire" data-section={isCapturePage ? "capture" : "general"}>
                    <p className="participant-section-label" aria-live="polite">{isCapturePage
                        ? survey.currentPage?.title === captureProgress ? "Revisit a captured moment" : captureProgress
                        : "Reflect on your experience"}</p>
                    <Survey model={survey} />
                </section>}

                {stage === "saving" && <section className="participant-panel" aria-label="Save reflection">
                    <h2>Save your reflection</h2>
                    <p>Keep this page open so your completed answers remain available.</p>
                    <button className="participant-button" disabled={isPreparing} onClick={() => saveRef.current?.()}>{isPreparing ? "Preparing export files..." : "Retry preparation"}</button>
                </section>}

                {stage === "complete" && <section className="participant-panel participant-confirmation" aria-labelledby="complete-title">
                    <p className="participant-eyebrow">Reflection complete</p>
                    <h2 id="complete-title" ref={headingRef} tabIndex={-1}>Thank you</h2>
                    <p className="participant-intro">Your reflection has been completed successfully.</p>
                    <p>Thank you for sharing your experience. Please let the researcher know you have finished.</p>
                    <p>Participant ID: <strong>{prepared?.participantId}</strong>. Download both files before leaving this page.</p>
                    <button className="participant-button" onClick={downloadPrepared}>Download participant package</button>
                    <p className="participant-help">This downloads two files: your responses and your captures. If your browser asks, allow both downloads.</p>
                    <Link className="participant-button" to="/">Return to home</Link>
                </section>}
        </PageShell>
    );
}
