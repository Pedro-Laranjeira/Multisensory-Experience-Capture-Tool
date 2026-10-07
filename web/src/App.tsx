/**
 * ============================================================
 * File: App.tsx
 * ============================================================
 *
 * Root component of the application.
 *
 * ============================================================
 */

import {
    BrowserRouter,
    Routes,
    Route
} from "react-router-dom";

import PageErrorBoundary from "./components/PageErrorBoundary";
import HomePage from "./pages/HomePage";
import ResearcherPage from "./pages/ResearcherPage";
import ParticipantPage from "./pages/ParticipantPage";

export default function App() {

    return (

        <BrowserRouter>

            <Routes>

                <Route
                    path="/"
                    element={<HomePage />}
                />

                <Route
                    path="/researcher"
                    element={<PageErrorBoundary key="researcher"><ResearcherPage /></PageErrorBoundary>}
                />

                <Route
                    path="/participant"
                    element={<PageErrorBoundary key="participant"><ParticipantPage /></PageErrorBoundary>}
                />

            </Routes>

        </BrowserRouter>

    );

}