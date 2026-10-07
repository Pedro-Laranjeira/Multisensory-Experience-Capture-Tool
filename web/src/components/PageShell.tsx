import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
    context: string;
    children: ReactNode;
    showHomeLink?: boolean;
}

export default function PageShell({ context, children, showHomeLink = false }: Props) {
    return (
        <main className="participant-shell">
            <div className="participant-container">
                <header className="participant-brand">
                    <p className="participant-eyebrow">{context}</p>
                    <h1>Multisensory Experience Capture Tool</h1>
                    {showHomeLink && <Link className="page-home-link" to="/">Return to home</Link>}
                </header>
                {children}
                <footer className="participant-footer">Multisensory Experience Capture Tool &middot; Research study</footer>
            </div>
        </main>
    );
}
