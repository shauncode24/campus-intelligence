import { useEffect } from "react";
import "../..//styles/Upload/FileCard.css";

const DOCUMENT_TYPES = [
  "Handbook",
  "Policy",
  "Schedule",
  "Form",
  "Guide",
  "Syllabus",
  "Circular",
  "Notice",
  "Other",
];

const DEPARTMENTS = [
  "Computer Engineering",
  "Information Technology",
  "Electronics",
  "Mechanical",
  "Civil",
  "Electrical",
  "Administration",
  "Examination",
  "Academics",
  "Library",
  "Sports",
  "Student Affairs",
];

const PROGRAMS = ["BTech", "MTech", "PhD", "Diploma"];
const YEARS = ["FY", "SY", "TY", "LY"];
const ACCESS_LEVELS = ["Public", "Students Only", "Faculty Only", "Admin Only"];

export default function FileCard({
  file,
  metadata,
  onMetadataChange,
  onRemove,
  disabled,
}) {
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const autoDetectMetadata = (filename) => {
    const name = filename.replace(".pdf", "");
    const lower = name.toLowerCase();

    // Detect department
    let department = "";
    DEPARTMENTS.forEach((dept) => {
      if (lower.includes(dept.toLowerCase())) {
        department = dept;
      }
    });

    // Detect document type
    let docType = "";
    DOCUMENT_TYPES.forEach((type) => {
      if (lower.includes(type.toLowerCase())) {
        docType = type;
      }
    });

    // Detect academic year (e.g., 2024-25)
    const yearMatch = lower.match(/\b(20\d{2})-?(20\d{2})?\b/);
    const academicYear = yearMatch ? yearMatch[0] : "";

    return { name, department, docType, academicYear };
  };

  useEffect(() => {
    if (!metadata.name) {
      const detected = autoDetectMetadata(file.name);
      onMetadataChange({
        ...metadata,
        name: detected.name,
        department: detected.department,
        documentType: detected.docType,
        academicYear: detected.academicYear,
      });
    }
  }, []);

  const handleCheckboxChange = (field, value, checked) => {
    const currentValues = metadata[field] || [];
    const updatedValues = checked
      ? [...currentValues, value]
      : currentValues.filter((v) => v !== value);

    onMetadataChange({ ...metadata, [field]: updatedValues });
  };

  return (
    <div className="file-card">
      <div className="file-card-header">
        <div className="file-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#d32f2f">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
            <path d="M14 2v6h6" fill="none" stroke="white" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="file-info">
          <div className="file-name">{file.name}</div>
          <div className="file-size">{formatFileSize(file.size)}</div>
        </div>
        {!disabled && (
          <button className="remove-btn" onClick={onRemove} title="Remove file">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="file-card-form">
        {/* Row 1: Document Name */}
        <div className="form-row">
          <div className="form-group full-width">
            <label>
              Document Name <span className="required">*</span>
            </label>
            <input
              type="text"
              value={metadata.name || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, name: e.target.value })
              }
              placeholder="Enter document name"
              disabled={disabled}
              required
            />
          </div>
        </div>

        {/* Row 2: Department & Document Type */}
        <div className="form-row">
          <div className="form-group">
            <label>
              Department <span className="required">*</span>
            </label>
            <select
              value={metadata.department || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, department: e.target.value })
              }
              disabled={disabled}
              required
            >
              <option value="">Select department</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>
              Document Type <span className="required">*</span>
            </label>
            <select
              value={metadata.documentType || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, documentType: e.target.value })
              }
              disabled={disabled}
              required
            >
              <option value="">Select type</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 3: Academic Year & Access Level */}
        <div className="form-row">
          <div className="form-group">
            <label>Academic Year</label>
            <input
              type="text"
              value={metadata.academicYear || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, academicYear: e.target.value })
              }
              placeholder="e.g., 2024-25"
              disabled={disabled}
            />
          </div>

          <div className="form-group">
            <label>Access Level</label>
            <select
              value={metadata.accessLevel || "Public"}
              onChange={(e) =>
                onMetadataChange({ ...metadata, accessLevel: e.target.value })
              }
              disabled={disabled}
            >
              {ACCESS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 4: Applicable Programs */}
        <div className="form-row">
          <div className="form-group full-width">
            <label>Applicable Programs</label>
            <div className="checkbox-group">
              {PROGRAMS.map((program) => (
                <label key={program} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={metadata.programs?.includes(program) || false}
                    onChange={(e) =>
                      handleCheckboxChange(
                        "programs",
                        program,
                        e.target.checked
                      )
                    }
                    disabled={disabled}
                  />
                  <span>{program}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Row 5: Applicable Years */}
        <div className="form-row">
          <div className="form-group full-width">
            <label>Applicable Years</label>
            <div className="checkbox-group">
              {YEARS.map((year) => (
                <label key={year} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={metadata.years?.includes(year) || false}
                    onChange={(e) =>
                      handleCheckboxChange("years", year, e.target.checked)
                    }
                    disabled={disabled}
                  />
                  <span>{year}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Row 6: Effective Date & Expiry Date */}
        <div className="form-row">
          <div className="form-group">
            <label>Effective Date</label>
            <input
              type="date"
              value={metadata.effectiveDate || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, effectiveDate: e.target.value })
              }
              disabled={disabled}
            />
          </div>

          <div className="form-group">
            <label>Expiry Date</label>
            <input
              type="date"
              value={metadata.expiryDate || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, expiryDate: e.target.value })
              }
              disabled={disabled}
            />
          </div>
        </div>

        {/* Row 7: Version & Owner */}
        <div className="form-row">
          <div className="form-group">
            <label>Version</label>
            <input
              type="text"
              value={metadata.version || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, version: e.target.value })
              }
              placeholder="e.g., v1.0"
              disabled={disabled}
            />
          </div>

          <div className="form-group">
            <label>Owner/Author</label>
            <input
              type="text"
              value={metadata.owner || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, owner: e.target.value })
              }
              placeholder="Maintaining department"
              disabled={disabled}
            />
          </div>
        </div>

        {/* Row 8: Tags */}
        <div className="form-row">
          <div className="form-group full-width">
            <label>Tags</label>
            <input
              type="text"
              value={metadata.tags || ""}
              onChange={(e) =>
                onMetadataChange({ ...metadata, tags: e.target.value })
              }
              placeholder="comma, separated, tags"
              disabled={disabled}
            />
            <small className="field-hint">
              Separate multiple tags with commas
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
