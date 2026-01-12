export default function DuplicateWarning({ duplicates }) {
  if (!duplicates || duplicates.length === 0) return null;

  return (
    <div className="duplicate-warning">
      <div className="duplicate-warning-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#f59e0b">
          <path d="M12 2L1 21h22L12 2zm0 3.83L19.53 19H4.47L12 5.83zM11 16h2v2h-2v-2zm0-6h2v4h-2v-4z" />
        </svg>
        <span className="duplicate-warning-title">
          Potential duplicate detected
        </span>
      </div>

      <p className="duplicate-warning-text">
        Similar documents already exist in the system:
      </p>

      <div className="duplicate-list">
        {duplicates.map((doc, idx) => (
          <div key={idx} className="duplicate-item">
            <div className="duplicate-info">
              <span className="duplicate-name">{doc.name}</span>
              {doc.version && (
                <span className="duplicate-version">{doc.version}</span>
              )}
            </div>
            <span className="duplicate-date">
              {doc.uploadedAt
                ? new Date(doc.uploadedAt.seconds * 1000).toLocaleDateString()
                : "Unknown date"}
            </span>
          </div>
        ))}
      </div>

      <p className="duplicate-warning-footer">
        You can still upload this document. Consider updating the version number
        to differentiate it.
      </p>

      <style>{`
        .duplicate-warning {
          background: #fffbeb;
          border: 1px solid #fde047;
          border-radius: 10px;
          padding: 16px;
          margin-top: 12px;
          margin-bottom: 12px;
        }

        .duplicate-warning-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }

        .duplicate-warning-title {
          font-size: 14px;
          font-weight: 600;
          color: #92400e;
        }

        .duplicate-warning-text {
          font-size: 13px;
          color: #78350f;
          margin: 0 0 12px 0;
        }

        .duplicate-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 12px;
        }

        .duplicate-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          background: white;
          border: 1px solid #fde047;
          border-radius: 6px;
        }

        .duplicate-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .duplicate-name {
          font-size: 13px;
          font-weight: 600;
          color: #1a1a1a;
        }

        .duplicate-version {
          font-size: 11px;
          padding: 2px 8px;
          background: #fed7aa;
          color: #92400e;
          border-radius: 4px;
          font-weight: 600;
        }

        .duplicate-date {
          font-size: 12px;
          color: #78350f;
        }

        .duplicate-warning-footer {
          font-size: 12px;
          color: #78350f;
          margin: 0;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
