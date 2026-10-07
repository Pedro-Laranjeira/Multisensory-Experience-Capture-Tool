/**
 * ============================================================
 * SurveyTemplateProcessor
 * ============================================================
 *
 * Receives:
 *
 *  - SurveyJS template
 *  - Session
 *
 * Produces:
 *
 *  - Final SurveyJS JSON
 *
 * The original template is never modified.
 * ============================================================
 */

import type { Session } from "../types/Session";
import { captureQuestionNames, transformCaptureBindings } from "./CaptureTemplateContract.ts";

export function buildSurvey(template: any, session: Session) {

    /*
     * Deep copy.
     *
     * Modify the researcher's template.
     */
    const survey = structuredClone(template);

    /*
     * Find the capture template page.
     */
    const templateIndex = survey.pages.findIndex(
        (page: any) => page.name === "__capture_template__"
    );

    if (templateIndex === -1) {
        throw new Error("Capture template page not found.");
    }

    /*
     * Save the page.
     */
    const captureTemplate = survey.pages[templateIndex];
    const localNames = captureQuestionNames(captureTemplate.elements);
    const globalNames = new Set<string>();
    survey.pages.forEach((page: any) => {
        if (page !== captureTemplate) captureQuestionNames(page.elements).forEach(name => globalNames.add(name));
    });

    /*
     * Remove it from the survey.
     */
    survey.pages.splice(templateIndex, 1);

    /*
     * Duplicate once per capture.
     */
    session.captures.forEach((capture, index) => {

        const page = structuredClone(captureTemplate);
        transformCaptureBindings(page, localNames, globalNames, `capture_${capture.id}_`);

        page.name = `capture_${capture.id}`;

        // Keep researcher-supplied titles; the participant shell supplies progress
        // separately when the capture page has a custom title.
        if (!page.title || page.title === "Captured Moment") {
            page.title = `Captured Moment ${index + 1} of ${session.captures.length}`;
        }

        const processElements = (elements: any[] = []) => {

            elements.forEach((element: any) => {

                const originalName = element.name;

                if (
                    element.name &&
                    element.type !== "html" &&
                    element.type !== "panel"
                ) {

                    element.name = `capture_${capture.id}_${element.name}`;

                }
                switch (originalName) {

                case "captureId":
                    element.defaultValue = capture.id;
                    break;

                case "mediaType":
                    element.defaultValue = capture.mediaType;
                    break;

                case "filename":
                    element.defaultValue = capture.sourceFile ?? capture.file;
                    break;

                case "timestamp":
                    element.defaultValue = capture.timestamp;
                    break;

                case "latitude":
                    element.defaultValue = capture.latitude;
                    break;

                case "longitude":
                    element.defaultValue = capture.longitude;
                    break;

                case "capture_info": {

                    let mediaHtml = "";

                    if (capture.mediaType === "photo") {

                        mediaHtml = `
                            <img
                                src="${capture.file}"
                                alt="Captured photo"
                                class="capture-media-image"
                            />
                        `;

                    }

                    else if (capture.mediaType === "audio") {

                        mediaHtml = `
                            <audio
                                controls
                                aria-label="Captured audio"
                                style="width:100%;margin-bottom:15px;"
                            >
                                <source src="${capture.file}">
                            </audio>
                        `;

                    }

                    else if (capture.mediaType === "video") {

                        mediaHtml = `
                            <video
                                controls
                                aria-label="Captured video"
                                style="
                                    width:100%;
                                    border-radius:8px;
                                    margin-bottom:15px;
                                "
                            >
                                <source src="${capture.file}">
                            </video>
                        `;

                    }

                    element.html = `
                        <div class="capture-memory">

                            ${mediaHtml}

                            ${page.description ? "" : '<p class="capture-memory-prompt">Think back to this moment during your experience.</p>'}
                            <p class="capture-memory-time">

                                <strong>Captured at:</strong>

                                ${capture.timestamp}

                            </p>

                        </div>
                    `;

                    break;

                }
            }

                processElements(element.elements);

                processElements(element.templateElements);

            });

        };

        processElements(page.elements);

        survey.pages.splice(templateIndex + index, 0, page);

    });

    return survey;

}
