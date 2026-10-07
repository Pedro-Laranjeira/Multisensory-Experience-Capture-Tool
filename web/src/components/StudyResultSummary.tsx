import { useMemo } from "react";
import type { StudyResult } from "../types/StudyResult";
import { buildResultsSummary } from "../services/StudyResultSummary";
import type { AnswerSummary, QuestionnaireDefinition } from "../services/StudyResultSummary";

const colors = ["#46685c", "#b7c9c1"];
function number(value: number) { return value.toLocaleString("en-GB", { maximumFractionDigits: 1 }); }
function text(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
}
function Answers({ answer }: { answer: AnswerSummary }) {
    const first = answer.distribution[0]?.percent ?? 0;
    return <>
        <p className="participant-help">{answer.count} {answer.count === 1 ? "response" : "responses"}</p>
        {answer.count === 0 ? <p className="participant-help">No responses</p> : answer.kind === "text" ? <ul className="summary-text">{answer.observations.map((item, index) => <li key={index}>
            <small>Response {item.response}{item.moment !== undefined && <> &middot; Moment {item.moment}</>}</small>
            <p>{text(item.value)}</p>
        </li>)}</ul> : answer.kind === "numeric" ? <p>Average: {answer.average === undefined ? "Unavailable" : number(answer.average)} &middot; Min: {number(answer.min!)} &middot; Max: {number(answer.max!)}</p> : <div className={answer.kind === "pie" ? "summary-pie-layout" : undefined}>
            {answer.kind === "pie" && <div className="summary-pie" aria-hidden="true" style={{ background: `conic-gradient(${colors[0]} 0% ${first}%, ${colors[1]} ${first}% 100%)` }} />}
            <ul className="summary-bars">{answer.distribution.map((option, index) => <li key={index}>
                <div className="summary-option"><span>{answer.kind === "pie" && <span className="summary-swatch" style={{ background: colors[index % colors.length] }} aria-hidden="true" />}{option.label}</span><span>{option.count} ({number(option.percent)}%)</span></div>
                {answer.kind !== "pie" && <div className="summary-track" aria-hidden="true"><span style={{ width: `${option.percent}%` }} /></div>}
            </li>)}</ul>
        </div>}
        {answer.kind === "multi" && <p className="participant-help">Multiple options could be selected.</p>}
        {answer.kind === "bars" && answer.average !== undefined && <p className="participant-help">Average: {number(answer.average)}</p>}
    </>;
}
export default function StudyResultSummary({ results, definitions }: { results: StudyResult[]; definitions: QuestionnaireDefinition[] }) {
    const groups = useMemo(() => buildResultsSummary(results, definitions), [results, definitions]);
    return <div className="automatic-summary">{groups.map((group, index) => <section key={group.key} aria-label={`Questionnaire summary ${index + 1}`}>
        {groups.length > 1 && <header className="summary-configuration"><h3>{group.label}</h3>
            {group.uploadedAt && <p className="participant-help">Uploaded {new Date(group.uploadedAt).toLocaleString("en-GB")}</p>}
            {group.separate && <p className="participant-help">Questionnaire identity is incomplete; this response is summarized separately.</p>}
        </header>}
        {group.sections.map(section => <section className="summary-section" key={section.key}>
            <h3>{section.label}</h3>
            {section.questions.map(question => <article className="summary-question" key={question.key}>
                <h4>{question.title}</h4>
                {question.answers.some(answer => answer.title !== question.title) && <p className="participant-help">{question.count} {question.count === 1 ? "response" : "responses"}</p>}
                {question.answers.map((answer, index) => <div className="summary-answer" key={index}>
                    {answer.title !== question.title && <h5>{answer.title}</h5>}
                    <Answers answer={answer} />
                </div>)}
            </article>)}
        </section>)}
        {!group.sections.length && <p className="participant-help">No question responses are available to summarize.</p>}
    </section>)}</div>;
}
