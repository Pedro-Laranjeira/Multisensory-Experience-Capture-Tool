import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Link } from "react-router-dom";
import PageShell from "./PageShell";

export default class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error: Error, info: ErrorInfo) { console.error("Page rendering failed", error, info); }
    render() {
        if (!this.state.failed) return this.props.children;
        return <PageShell context="Recovery"><section className="participant-panel">
            <h2>Something went wrong</h2>
            <p role="alert">This page could not be displayed. Return home and try again. If you were completing a reflection, please ask the researcher for help.</p>
            <Link className="participant-button" to="/">Return to home</Link>
        </section></PageShell>;
    }
}
