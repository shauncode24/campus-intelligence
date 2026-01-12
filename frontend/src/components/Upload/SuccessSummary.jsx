import "../../styles/Upload/SuccessSummary.css";

export default function SuccessSummary({ results, onClose }) {
  const totalFiles = results.length;
  const successful = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const totalChunks = results
    .filter((r) => r.status === "success")
    .reduce((sum, r) => sum + (r.chunksCreated || 0), 0);

  return (
    <div className="success-summary">
      <div className="summary-icon">
        <svg
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>

      <h2 className="summary-title">Upload Complete!</h2>
      <p className="summary-subtitle">
        {successful} of {totalFiles} documents processed successfully
      </p>

      <div className="summary-stats">
        <div className="stat-card success">
          <div className="stat-number">{successful}</div>
          <div className="stat-label">Successful</div>
        </div>

        <div className="stat-card info">
          <div className="stat-number">{totalChunks}</div>
          <div className="stat-label">Chunks Created</div>
        </div>

        {failed > 0 && (
          <div className="stat-card failed">
            <div className="stat-number">{failed}</div>
            <div className="stat-label">Failed</div>
          </div>
        )}
      </div>

      <div className="summary-details">
        <h3 className="details-title">Processing Results</h3>
        {results.map((result, idx) => (
          <div key={idx} className={`detail-item ${result.status}`}>
            <div className="detail-icon">
              {result.status === "success" ? "✓" : "✗"}
            </div>
            <div className="detail-info">
              <div className="detail-name">{result.fileName}</div>
              {result.status === "success" ? (
                <div className="detail-stats">
                  {result.chunksCreated} chunks • {result.textChunks} text •{" "}
                  {result.visualChunks} images
                </div>
              ) : (
                <div className="detail-error">{result.error}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="summary-actions">
        <button className="summary-close-btn" onClick={onClose}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Upload More Documents
        </button>
      </div>
    </div>
  );
}
