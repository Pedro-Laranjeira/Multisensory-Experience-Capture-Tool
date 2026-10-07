import { ConditionRunner } from "survey-core";

// A deliberately limited condition grammar: literal values, direct question
// references, comparisons and boolean operators. No functions or scoped paths.
const conditionTokens = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|\{[^{}]+\}|\b(?:and|or|not|true|false|empty|notempty|contains)\b|-?\d+(?:\.\d+)?|[()=<>!]+|\s+/gi;
const references = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|\{([^{}]+)\}/g;

export function transformCaptureCondition(
    condition: string,
    localNames: ReadonlySet<string>,
    globalNames: ReadonlySet<string>,
    prefix = ""
): string {
    if (condition.replace(conditionTokens, "").trim()) {
        throw new Error("Capture conditions support only direct {questionName} references, literal comparisons and boolean operators. Remove functions, scoped paths or other unsupported expressions.");
    }
    if (!new ConditionRunner(condition).canRun()) {
        throw new Error("The capture condition has invalid syntax. Correct its comparison or boolean expression in SurveyJS Creator.");
    }
    return condition.replace(references, (token, name: string | undefined) => {
        if (name === undefined) return token; // Quoted literals are never rewritten.
        if (!localNames.has(name) && !globalNames.has(name)) {
            throw new Error(`Capture condition reference {${name}} is unsupported. Use an existing capture or ordinary-section question name; scoped paths are not supported.`);
        }
        return localNames.has(name) ? `{${prefix}${name}}` : token;
    });
}

export function captureQuestionNames(elements: Record<string, unknown>[] = []): Set<string> {
    const names = new Set<string>();
    for (const element of elements) {
        if (typeof element.name === "string" && !["html", "image", "panel"].includes(String(element.type))) names.add(element.name);
        for (const name of captureQuestionNames(element.elements as Record<string, unknown>[] | undefined)) names.add(name);
    }
    return names;
}

export function transformCaptureBindings(
    value: unknown,
    localNames: ReadonlySet<string>,
    globalNames: ReadonlySet<string>,
    prefix = ""
): void {
    if (Array.isArray(value)) { value.forEach(item => transformCaptureBindings(item, localNames, globalNames, prefix)); return; }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
        if (child && (key === "valueName" || /FromQuestion$/.test(key))) {
            throw new Error(`The capture template uses unsupported ${key}. Remove shared/indirect question bindings and use unique question names.`);
        }
        if (typeof child === "string" && child && (/If$/.test(key) || /Expression$/.test(key) || key === "expression")) {
            if (!["visibleIf", "enableIf", "requiredIf"].includes(key)) {
                throw new Error(`The capture template uses unsupported ${key}. Use simple visibleIf, enableIf or requiredIf conditions instead.`);
            }
            object[key] = transformCaptureCondition(child, localNames, globalNames, prefix);
        } else transformCaptureBindings(child, localNames, globalNames, prefix);
    }
}

export function rejectExternalCaptureReferences(value: unknown, localNames: ReadonlySet<string>): void {
    if (Array.isArray(value)) { value.forEach(item => rejectExternalCaptureReferences(item, localNames)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string" && (/If$/.test(key) || /Expression$/.test(key) || key === "expression")) {
            child.replace(references, (token, name: string | undefined) => {
                if (name && localNames.has(name.split(/[.[]/)[0])) throw new Error("Conditions outside the capture template cannot reference capture-template questions. Move capture-local logic into the capture template.");
                return token;
            });
        } else rejectExternalCaptureReferences(child, localNames);
    }
}
