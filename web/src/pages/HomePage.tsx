import { Link } from "react-router-dom";
import PageShell from "../components/PageShell";

export default function HomePage() {
    return (
        <PageShell context="Capture and reflection">
            <section className="participant-panel" aria-label="Choose how to continue">
                <p className="participant-intro home-intro">
                    Capture meaningful moments without a screen during a public-space
                    experience, then use those moments as prompts for structured reflection.
                </p>
                <div className="participant-methods home-roles">
                    <section className="participant-method home-role" aria-labelledby="participant-role">
                        <h2 id="participant-role">Participant</h2>
                        <p>Load a completed capture session and reflect on the moments you recorded.</p>
                        <Link className="participant-button" to="/participant">Continue as participant</Link>
                    </section>
                    <section className="participant-method home-role" aria-labelledby="researcher-role">
                        <h2 id="researcher-role">Researcher</h2>
                        <p>Configure the reflection questionnaire used after the capture experience.</p>
                        <Link className="participant-button" to="/researcher">Continue as researcher</Link>
                    </section>
                </div>
            </section>
        </PageShell>
    );
}
