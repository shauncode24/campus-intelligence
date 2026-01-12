import { useState } from "react";
import "../../styles/Upload/DragDropZone.css";

export default function DragDropZone({
  onFilesSelected,
  disabled,
  acceptMultiple,
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.type === "application/pdf"
    );

    if (files.length > 0) {
      onFilesSelected(acceptMultiple ? files : [files[0]]);
    }
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  return (
    <div
      className={`drag-drop-zone ${isDragging ? "dragging" : ""} ${
        disabled ? "disabled" : ""
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="drag-drop-icon">
        <svg
          width="80"
          height="80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1" />
          <path d="M9 15l3 -3l3 3" />
          <path d="M12 12l0 9" />
        </svg>
      </div>

      <div className="drag-drop-content">
        <h3 className="drag-drop-title">
          {acceptMultiple
            ? "Drop multiple PDF files here"
            : "Drop PDF file here"}
        </h3>
        <p className="drag-drop-subtitle">
          or click to browse from your computer
        </p>

        <div className="supported-formats">
          <div className="format-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#d32f2f">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
              <path
                d="M14 2v6h6M10 12h4M10 16h4M10 20h4"
                stroke="white"
                strokeWidth="1"
              />
            </svg>
            <span>PDF Documents Only</span>
          </div>
          {acceptMultiple && (
            <div className="format-badge">
              <span>📦 Up to 20 files</span>
            </div>
          )}
        </div>
      </div>

      <input
        type="file"
        accept="application/pdf"
        multiple={acceptMultiple}
        onChange={handleFileInput}
        disabled={disabled}
        style={{ display: "none" }}
        id="file-input"
      />
      <label htmlFor="file-input" className="file-input-label" />
    </div>
  );
}
