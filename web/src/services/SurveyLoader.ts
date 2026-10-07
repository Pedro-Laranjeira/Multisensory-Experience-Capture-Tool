import defaultTemplate from "../survey/template_base.json";

import { loadTemplate } from "./TemplateManager";

export function loadSurveyTemplate() {

    const stored = loadTemplate();

    if (stored)
        return stored;

    return defaultTemplate;

}