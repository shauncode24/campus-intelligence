// QuestionCard.jsx
import React from "react";
import {
  Star,
  Trash2,
  RotateCcw,
  Copy,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  FileText,
  Bookmark,
  Share2,
} from "lucide-react";
import "../styles/QuestionCard.css";

export default function QuestionCard({
  item,
  isExpanded,
  isSelected,
  isFavorite,
  docMissing,
  formatDate,
  getIntentColor,
  getConfidenceBadge,
  toggleExpand,
  toggleSelect,
  toggleFavorite,
  handleReask,
  handleCopy,
  deleteQuestion,
  userId,
  viewMode = "timeline",
}) {
  const confidence = getConfidenceBadge(item.confidence);

  if (viewMode === "grid") {
    return (
      <div className={`question-card-grid ${isSelected ? "selected" : ""}`}>
        <div className="card-grid-header">
          <button
            onClick={() => toggleFavorite(item.id)}
            className="favorite-btn-grid"
          >
            <Star
              size={18}
              fill={isFavorite ? "#fbbc04" : "none"}
              color={isFavorite ? "#fbbc04" : "#5f6368"}
            />
          </button>
        </div>

        <div className="card-grid-content">
          <h3 className="question-text-grid">{item.questionText}</h3>

          <div className="card-grid-badges">
            <span
              className="meta-badge"
              style={{
                backgroundColor: getIntentColor(item.intent) + "15",
                color: getIntentColor(item.intent),
              }}
            >
              {item.intent || "general"}
            </span>
            {confidence && (
              <span
                className="meta-badge"
                style={{
                  backgroundColor: confidence.color + "15",
                  color: confidence.color,
                }}
              >
                {confidence.level}
              </span>
            )}
          </div>

          {isExpanded && <p className="answer-text-grid">{item.answer}</p>}
        </div>

        <div className="card-grid-footer">
          <span className="card-grid-date">{formatDate(item.askedAt)}</span>
          <button
            onClick={() => toggleExpand(item.id)}
            className="expand-btn-grid"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {isExpanded && (
          <div className="card-grid-actions">
            <button
              className="action-btn-grid"
              onClick={() => handleReask(item.questionText)}
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="action-btn-grid"
              onClick={() => handleCopy(item.answer)}
            >
              <Copy size={14} />
            </button>
            <button
              onClick={() => deleteQuestion(item.id)}
              className="action-btn-grid delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className={`question-card-list ${isSelected ? "selected" : ""}`}>
        <div className="card-list-main">
          <div className="card-list-top">
            <h3 className="question-text-list">{item.questionText}</h3>
            <button
              onClick={() => toggleFavorite(item.id)}
              className="favorite-btn-list"
            >
              <Star
                size={18}
                fill={isFavorite ? "#fbbc04" : "none"}
                color={isFavorite ? "#fbbc04" : "#5f6368"}
              />
            </button>
          </div>

          <div className="card-list-meta">
            <span>{formatDate(item.askedAt)}</span>
            <span>•</span>
            <span
              className="meta-badge-inline"
              style={{ color: getIntentColor(item.intent) }}
            >
              {item.intent || "general"}
            </span>
            {confidence && (
              <>
                <span>•</span>
                <span
                  className="meta-badge-inline"
                  style={{ color: confidence.color }}
                >
                  {confidence.level}
                </span>
              </>
            )}
          </div>

          {isExpanded && (
            <>
              <p className="answer-text-list">{item.answer}</p>
              <div className="card-list-actions">
                <button
                  className="action-btn-list"
                  onClick={() => handleReask(item.questionText)}
                >
                  <RotateCcw size={14} /> Re-ask
                </button>
                <button
                  className="action-btn-list"
                  onClick={() => handleCopy(item.answer)}
                >
                  <Copy size={14} /> Copy
                </button>
                <button
                  onClick={() => deleteQuestion(item.id)}
                  className="action-btn-list delete"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => toggleExpand(item.id)}
          className="expand-btn-list"
        >
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
    );
  }

  // Timeline view (default) - NEW DESIGN
  return (
    <div className={`question-card-new ${isSelected ? "selected" : ""}`}>
      <div className="question-card-header-row">
        <div className="question-content-wrapper">
          <div className="question-title-row">
            <h3 className="question-text-new">{item.questionText}</h3>
            <button
              onClick={() => toggleFavorite(item.id)}
              className="favorite-btn-new"
            >
              <Star
                size={20}
                fill={isFavorite ? "#fbbf24" : "none"}
                color={isFavorite ? "#fbbf24" : "#9ca3af"}
                strokeWidth={2}
              />
            </button>
          </div>

          <div className="question-meta-new">
            <span>{formatDate(item.askedAt)}</span>
            <span>•</span>
            <span
              className="meta-badge-new"
              style={{
                backgroundColor: getIntentColor(item.intent) + "25",
                color: getIntentColor(item.intent),
              }}
            >
              {item.intent || "general"}
            </span>
            {confidence && (
              <>
                <span>•</span>
                <div className="confidence-badge-new">
                  <div
                    className="confidence-dot"
                    style={{ backgroundColor: confidence.color }}
                  />
                  <span style={{ color: confidence.color }}>
                    {confidence.level} confidence
                  </span>
                </div>
              </>
            )}
            {docMissing && (
              <>
                <span>•</span>
                <span className="missing-doc-badge-new">
                  <AlertCircle size={12} />
                  Document unavailable
                </span>
              </>
            )}
          </div>

          {isExpanded && (
            <div className="answer-section-new">
              <p className="answer-text-new">{item.answer}</p>

              {item.sources && item.sources.length > 0 && (
                <div className="sources-section-new">
                  <FileText size={16} className="sources-icon" />
                  <span className="sources-text">
                    Sources:{" "}
                    {item.sources.map((s) => s.documentName).join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="action-buttons-new">
            <button
              className="action-btn-new"
              onClick={() => handleReask(item.questionText)}
            >
              <RotateCcw size={14} />
              Re-ask
            </button>
            <button
              className="action-btn-new"
              onClick={() => handleCopy(item.answer)}
            >
              <Copy size={14} />
            </button>
            <button className="action-btn-new">
              <Bookmark size={14} />
            </button>
            <button className="action-btn-new">
              <Share2 size={14} />
            </button>
            <button
              onClick={() => deleteQuestion(item.id)}
              className="action-btn-new delete-btn-new"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <button
          onClick={() => toggleExpand(item.id)}
          className="expand-btn-new"
        >
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>
    </div>
  );
}
