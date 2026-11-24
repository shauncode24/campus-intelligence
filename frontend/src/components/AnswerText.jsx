import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linkCitations } from "../utils/citations";

// Safe by construction: react-markdown does not render raw HTML (an answer containing "<script>"
// or "<img onerror=...>" is shown as text), and it drops javascript: and similar link targets.
const components = {
  // Links open in a new tab (citations jump to the cited page of the PDF)
  a: ({ node, ...props }) => {
    void node;
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
  // Wide tables scroll instead of breaking the layout
  table: ({ node, ...props }) => {
    void node;
    return (
      <div className="answer-table-wrapper">
        <table {...props} />
      </div>
    );
  },
};

/**
 * An answer as formatted text (bold, lists, tables, code) with its [Document, p. N] citations
 * turned into links to the cited page when they match one of the answer's sources.
 */
export default function AnswerText({ text, sources }) {
  return (
    <div className="answer-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkCitations(text, sources)}
      </ReactMarkdown>
    </div>
  );
}
