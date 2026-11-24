import { useState } from "react";
import { FEEDBACK_REASONS } from "../utils/citations";

/** Shown after a thumbs-down: why, in one click, plus an optional note. Skipping is fine. */
export default function FeedbackPanel({ onSubmit, onClose }) {
  const [reason, setReason] = useState(null);
  const [comment, setComment] = useState("");

  return (
    <div className="feedback-panel" role="group" aria-label="What went wrong?">
      <div>What went wrong?</div>
      <div className="feedback-reasons">
        {FEEDBACK_REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`feedback-reason ${reason === r.id ? "selected" : ""}`}
            aria-pressed={reason === r.id}
            onClick={() => setReason(reason === r.id ? null : r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <textarea
        className="feedback-comment"
        rows={2}
        maxLength={500}
        placeholder="Anything else? (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="feedback-actions">
        <button type="button" onClick={onClose}>
          Skip
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onSubmit({ reason: reason || undefined, comment: comment.trim() || undefined })}
          disabled={!reason && !comment.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
