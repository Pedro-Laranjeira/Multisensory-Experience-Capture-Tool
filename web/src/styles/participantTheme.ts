import type { ITheme } from "survey-core";

// SurveyJS 2.x design tokens; leave question behavior and validation intact.
export const participantTheme: ITheme = {
    themeName: "default",
    colorPalette: "light",
    isPanelless: false,
    cssVariables: {
        "--sjs-font-family": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "--sjs-font-size": "16px",
        "--sjs-font-surveytitle-size": "22px",
        "--sjs-font-surveytitle-weight": "600",
        "--sjs-font-surveytitle-color": "#23312d",
        "--sjs-general-backcolor": "#ffffff",
        "--sjs-general-backcolor-dark": "#f1f4f3",
        "--sjs-general-backcolor-dim": "#f5f6f4",
        "--sjs-general-backcolor-dim-light": "#ffffff",
        "--sjs-general-backcolor-dim-dark": "#e8eeeb",
        "--sjs-general-forecolor": "#23312d",
        "--sjs-general-forecolor-light": "#58645f",
        "--sjs-general-dim-forecolor": "#23312d",
        "--sjs-general-dim-forecolor-light": "#58645f",
        "--sjs-primary-backcolor": "#315c4e",
        "--sjs-primary-backcolor-dark": "#234638",
        "--sjs-primary-backcolor-light": "#e7efeb",
        "--sjs-primary-forecolor": "#ffffff",
        "--sjs-border-default": "#81918a",
        "--sjs-border-light": "#d8e0db",
        "--sjs-special-red": "#a52d32",
        "--sjs-special-red-light": "#fff0f0",
        "--sjs-corner-radius": "8px",
        "--sjs-base-unit": "8px",
        "--sjs-shadow-small": "0 0 0 1px #d8e0db",
        "--sjs-shadow-inner": "inset 0 0 0 1px #81918a"
    }
};
