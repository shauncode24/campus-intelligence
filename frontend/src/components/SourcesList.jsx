import { useState } from "react";
import "../styles/SourcesList.css";
import { getDisplayPage } from "../utils/validation";
import { pageLink, uniqueSources } from "../utils/citations";

/** Every passage the answer was built from, each with a link to the cited page of the PDF. */
export default function SourcesList({ sources }) {
  const [isOpen, setIsOpen] = useState(false);

  const items = uniqueSources(sources);
  if (items.length === 0) return null;

  return (
    <div className="sources-main">
      <button
        type="button"
        className="sources-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          fill="currentColor"
          viewBox="0 0 16 16"
          stroke="currentColor"
          strokeWidth="0.8"
        >
          <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783" />
        </svg>
        Sources ({items.length})
        <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
      </button>

      <div className={`sources-container ${isOpen ? "open" : "closed"}`}>
        {items.map((source, index) => {
          const page = getDisplayPage(source);
          const link = pageLink(source);
          return (
            <div className="sources-item" key={`${source.documentId}-${page}-${source.type}-${index}`}>
              <div className="sources-top">
                <div className="sources-left">
                  {source.documentName}
                  <div className="default">
                    {page !== null && <span>Page {page}</span>}
                    {source.version && <span>Version {source.version}</span>}
                    {source.effectiveDate && (
                      <span>In effect from {source.effectiveDate}</span>
                    )}
                    {source.type === "image" && (
                      <span className="visual-badge">Figure</span>
                    )}
                  </div>
                </div>
                <div className="sources-right">
                  {link && (
                    <a
                      className="download-link"
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {page !== null ? `Open page ${page}` : "Open PDF"}
                    </a>
                  )}
                </div>
              </div>
              {source.excerpt && (
                <div className="sources-bottom">&ldquo;{source.excerpt}&rdquo;</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
