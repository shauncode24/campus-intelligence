import { useState } from "react";
import "../../styles/Upload/ProcessingView.css";

export default function ProcessingView({
  files,
  processingStates,
  fileMetadata,
}) {
  const stages = [
    // These are the server's real stages (the job reports them), not timers
    { id: "uploading", label: "Uploading", icon: "📤" },
    { id: "preparing", label: "Preparing", icon: "📥" },
    { id: "reading", label: "Reading pages", icon: "📄" },
    { id: "storing", label: "Saving", icon: "💾" },
  ];

  const ProcessingCard = ({ file }) => {
    const [showLogs, setShowLogs] = useState(false);
    const state = processingStates[file.name] || {};
    const metadata = fileMetadata[file.name] || {};

    const currentStageIndex = stages.findIndex((s) => s.id === state.stage);
    const isComplete = state.stage === "complete";
    const isFailed = state.stage === "failed";

    return (
      <div
        className={`processing-card ${isComplete ? "complete" : ""} ${
          isFailed ? "failed" : ""
        }`}
      >
        <div className="processing-header">
          <div className="processing-file-info">
            <span className="processing-filename">
              {metadata.name || file.name}
            </span>
            {typeof state.percent === "number" && !isComplete && !isFailed && (
              <span className="processing-progress">{state.percent}%</span>
            )}
          </div>

          <div className="processing-status-icon">
            {!isComplete && !isFailed && (
              <div className="spinner">
                <svg
                  className="spinner-icon"
                  viewBox="0 0 24 24"
                  width="28"
                  height="28"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    opacity="0.25"
                  />
                  <path
                    d="M12 2a10 10 0 0 1 10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            )}

            {isComplete && (
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            )}

            {isFailed && (
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" />
              </svg>
            )}
          </div>
        </div>

        {state.error && (
          <div className="processing-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            {state.error}
          </div>
        )}

        <div className="processing-stages">
          {stages.map((stage, idx) => (
            <div
              key={stage.id}
              className={`stage-item ${
                idx < currentStageIndex
                  ? "completed"
                  : idx === currentStageIndex
                  ? "active"
                  : "pending"
              }`}
            >
              <div className="stage-icon">{stage.icon}</div>
              <div className="stage-label">{stage.label}</div>
              {idx < currentStageIndex && <div className="stage-check">✓</div>}
            </div>
          ))}
        </div>

        {state.logs && state.logs.length > 0 && (
          <div className="processing-logs">
            <button
              className="logs-toggle"
              onClick={() => setShowLogs(!showLogs)}
            >
              <span>{showLogs ? "Hide" : "Show"} details</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: showLogs ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showLogs && (
              <div className="logs-content">
                {state.logs.map((log, idx) => (
                  <div key={idx} className="log-entry">
                    <span className="log-time">{log.time}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const completedCount = files.filter(
    (f) => processingStates[f.name]?.stage === "complete"
  ).length;

  const failedCount = files.filter(
    (f) => processingStates[f.name]?.stage === "failed"
  ).length;

  return (
    <div className="processing-view">
      <div className="processing-view-header">
        <div>
          <h2 className="processing-view-title">Processing Documents...</h2>
          <p className="processing-view-subtitle">
            {completedCount} of {files.length} completed
            {failedCount > 0 && ` • ${failedCount} failed`}
          </p>
        </div>

        <div className="overall-progress">
          <div className="progress-ring">
            <svg width="60" height="60" viewBox="0 0 60 60">
              <circle
                cx="30"
                cy="30"
                r="26"
                stroke="#e0e0e0"
                strokeWidth="4"
                fill="none"
              />
              <circle
                cx="30"
                cy="30"
                r="26"
                stroke="#4285f4"
                strokeWidth="4"
                fill="none"
                strokeDasharray={`${
                  (completedCount / files.length) * 163.4
                } 163.4`}
                strokeLinecap="round"
                transform="rotate(-90 30 30)"
              />
            </svg>
            <div className="progress-text">
              {Math.round((completedCount / files.length) * 100)}%
            </div>
          </div>
        </div>
      </div>

      <div className="processing-list">
        {files.map((file) => (
          <ProcessingCard key={file.name} file={file} />
        ))}
      </div>
    </div>
  );
}
