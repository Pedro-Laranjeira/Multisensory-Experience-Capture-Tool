import { Base, LocalizableString, Model, Serializer, surveyLocalization } from "survey-core";

// Preserve authored text before changing defaults on the runtime model only.
export function configureEnglishSurveyDefaults(model: Model): void {
    const seen = new Set<Base>();
    const texts: { string: LocalizableString; text: string }[] = [];
    function visit(value: unknown): void {
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (!(value instanceof Base) || seen.has(value)) return;
        seen.add(value);
        const properties = value as unknown as Record<string, unknown>;
        for (const property of Serializer.getProperties(value.getType())) {
            const localized = properties[property.serializationProperty];
            if (property.isLocalizable && localized instanceof LocalizableString && !localized.isEmpty) {
                texts.push({ string: localized, text: localized.text });
            }
            visit(properties[property.name]);
        }
    }
    visit(model);
    surveyLocalization.defaultLocale = "en";
    surveyLocalization.currentLocale = "en";
    // SurveyJS normalizes its default English locale to an empty string.
    model.locale = "en";
    texts.forEach(({ string, text }) => string.setLocaleText("en", text));
}
