import { useState, useEffect, useRef } from "react";
import { db } from "../app/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { documentState } from "../utils/documentState";
import { supabase } from "../app/supabase";
import { apiFetch } from "../utils/api";
import toast from "react-hot-toast";
import {
  fileKey,
  validateSelection,
  sha256Hex,
  debounce,
  MAX_FILES,
} from "../utils/uploadFiles";

// Import sub-components
import DragDropZone from "./Upload/DragDropZone";
import FileCard from "./Upload/FileCard";
import ProcessingView from "./Upload/ProcessingView";
import SuccessSummary from "./Upload/SuccessSummary";
import DuplicateWarning from "./Upload/DuplicateWarning";

const { VITE_API_BASE_URL } = import.meta.env;

export default function UploadDocument() {
  const [files, setFiles] = useState([]);
  const [fileMetadata, setFileMetadata] = useState({});
  const [uploadMode, setUploadMode] = useState("bulk");
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingStates, setProcessingStates] = useState({});
  const [uploadResults, setUploadResults] = useState(null);
  // key -> { exact: [...], similar: [...] }; every per-file map is keyed by fileKey(file), never by name
  const [duplicateWarnings, setDuplicateWarnings] = useState({});
  // Always the newest values, for asynchronous work that must not read a stale render
  const metadataRef = useRef({});
  const hashesRef = useRef({}); // key -> sha256 of the file's bytes
  const checkersRef = useRef({}); // key -> debounced duplicate check
  // What has already been done for a file (so a retry does not upload or register it twice)
  const resumeRef = useRef({}); // key -> { fileUrl, documentId }
  // Current documents an upload can replace (admin-only page, so reading all is allowed)
  const [replaceableDocuments, setReplaceableDocuments] = useState([]);
  metadataRef.current = fileMetadata;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "documents"), where("status", "==", "Processed"))
        );
        if (cancelled) return;
        setReplaceableDocuments(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((d) => documentState(d) === "live")
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        );
      } catch (error) {
        console.error("Could not load documents to replace:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFilesSelected = (selectedFiles) => {
    const { accepted, rejected } = validateSelection(files, selectedFiles, {
      maxFiles: uploadMode === "bulk" ? MAX_FILES : 1,
    });

    if (rejected.length > 0) {
      // say what was left out and why (at most a few lines)
      const lines = rejected.slice(0, 4).map((r) => `${r.name}: ${r.reason}`);
      if (rejected.length > 4) lines.push(`...and ${rejected.length - 4} more`);
      toast.error(lines.join("\n"), { duration: 6000 });
    }
    if (accepted.length === 0) return;

    accepted.forEach((file) => {
      file.key = fileKey(file);
    });

    setFiles((prev) => [...prev, ...accepted]);

    // Initialize metadata for new files
    setFileMetadata((prev) => {
      const next = { ...prev };
      accepted.forEach((file) => {
        next[file.key] = {
          name: "",
          department: "",
          documentType: "",
          academicYear: "",
          programs: [],
          years: [],
          tags: "",
          effectiveDate: "",
          expiryDate: "",
          version: "",
          owner: "",
          accessLevel: "Public",
          supersedes: "",
        };
      });
      metadataRef.current = next;
      return next;
    });

    // Fingerprint each file, then look for the same file already stored
    accepted.forEach(async (file) => {
      try {
        hashesRef.current[file.key] = await sha256Hex(file);
      } catch (error) {
        console.error("Could not fingerprint the file:", error);
      }
      scheduleDuplicateCheck(file.key);
    });
  };

  // Ask the server whether this file (same bytes) or a similarly named document exists.
  // Reads the newest metadata through the ref, so it is never one keystroke behind.
  const checkDuplicate = async (key) => {
    const metadata = metadataRef.current[key] || {};
    const sha256 = hashesRef.current[key];
    const hasNameAndDept = metadata.name && metadata.department;
    if (!sha256 && !hasNameAndDept) return;

    try {
      const response = await apiFetch(
        `${VITE_API_BASE_URL}/documents/check-duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(hasNameAndDept
              ? { name: metadata.name, department: metadata.department }
              : {}),
            ...(sha256 ? { sha256 } : {}),
          }),
        }
      );
      if (!response.ok) return;
      const result = await response.json();

      // The file may have been removed while the request was in flight
      if (!(key in metadataRef.current)) return;

      setDuplicateWarnings((prev) => {
        const next = { ...prev };
        if (result.hasDuplicates) {
          next[key] = {
            exact: result.exactDuplicates || [],
            similar: result.similarDocuments || [],
          };
        } else {
          delete next[key];
        }
        return next;
      });
    } catch (error) {
      console.error("Error checking duplicate:", error);
    }
  };

  // One debounced checker per file: typing a name sends one request after a pause,
  // not one per keystroke.
  const scheduleDuplicateCheck = (key) => {
    if (!checkersRef.current[key]) {
      checkersRef.current[key] = debounce(() => checkDuplicate(key), 600);
    }
    checkersRef.current[key]();
  };

  const handleMetadataChange = (key, metadata) => {
    const previous = metadataRef.current[key] || {};
    const next = { ...metadataRef.current, [key]: metadata };
    metadataRef.current = next;
    setFileMetadata(next);

    // Recheck only when what the check depends on changed
    if (previous.name !== metadata.name || previous.department !== metadata.department) {
      scheduleDuplicateCheck(key);
    }
  };

  const forgetFile = (key) => {
    if (checkersRef.current[key]) checkersRef.current[key].cancel();
    delete checkersRef.current[key];
    delete hashesRef.current[key];
    delete resumeRef.current[key];
  };

  const handleRemoveFile = (key) => {
    forgetFile(key);
    setFiles((prev) => prev.filter((f) => f.key !== key));
    setFileMetadata((prev) => {
      const next = { ...prev };
      delete next[key];
      metadataRef.current = next;
      return next;
    });
    setDuplicateWarnings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateFile = (key) => {
    const metadata = fileMetadata[key];
    return metadata && metadata.name && metadata.department && metadata.documentType;
  };

  const validateAllFiles = () => {
    if (files.length === 0) {
      toast.error("Please select at least one file");
      return false;
    }

    const invalidFiles = files.filter((f) => !validateFile(f.key));
    if (invalidFiles.length > 0) {
      toast.error(
        `Please fill required fields for: ${invalidFiles
          .map((f) => f.name)
          .join(", ")}`
      );
      return false;
    }

    return true;
  };

  const updateProcessingState = (fileName, update) => {
    setProcessingStates((prev) => ({
      ...prev,
      [fileName]: {
        ...(prev[fileName] || {}),
        ...update,
        logs: [
          ...(prev[fileName]?.logs || []),
          ...(update.log
            ? [
                {
                  time: new Date().toLocaleTimeString(),
                  message: update.log,
                },
              ]
            : []),
        ],
      },
    }));
  };

  const uploadToSupabase = async (file) => {
    const fileName = file.key;
    updateProcessingState(fileName, {
      stage: "uploading",
      log: "Uploading file to storage...",
    });

    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    const filePath = `${Date.now()}_${safeName}`;
    const { error } = await supabase.storage
      .from("documents")
      .upload(filePath, file);

    if (error) throw error;

    const { data } = supabase.storage.from("documents").getPublicUrl(filePath);

    return data.publicUrl;
  };

  const createFirestoreDocument = async (file, fileUrl) => {
    const { supersedes, ...metadata } = fileMetadata[file.key];

    // The admin API creates the record; `uploadedBy` and the timestamp are set
    // server-side from the verified admin token.
    const response = await apiFetch(`${VITE_API_BASE_URL}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileUrl,
        fileSize: file.size,
        metadata,
        ...(supersedes ? { supersedes } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.errors?.join(", ") ||
          errorData.message ||
          errorData.error ||
          "Failed to create document record"
      );
    }

    const { documentId } = await response.json();
    return documentId;
  };

  // The server's stage names -> the stages shown in the UI
  const UI_STAGE = {
    queued: "preparing",
    downloading: "preparing",
    reading: "reading",
    storing: "storing",
    done: "storing",
  };
  const POLL_INTERVAL_MS = 2000;
  const MAX_WAIT_MS = 30 * 60 * 1000;

  /**
   * Poll the document until the server says it is Processed (resolves with the
   * status) or Error/Cancelled (throws). Occasional network failures are retried.
   */
  const waitForProcessing = async (documentId, key) => {
    const startedAt = Date.now();
    let failures = 0;
    let lastMessage = "";

    for (;;) {
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        throw new Error(
          "Processing is taking longer than expected. Check the Documents page later."
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      let status;
      try {
        const res = await apiFetch(
          `${VITE_API_BASE_URL}/documents/processing-status/${documentId}`
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        status = await res.json();
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= 5) {
          throw new Error("Lost contact with the server while processing.");
        }
        continue;
      }

      if (status.status === "Processed") return status;
      if (status.status === "Error" || status.status === "Cancelled") {
        throw new Error(
          status.errorMessage ||
            (status.status === "Cancelled"
              ? "Processing was cancelled"
              : "Processing failed")
        );
      }

      const p = status.processing;
      if (p) {
        const update = {
          stage: UI_STAGE[p.stage] || "preparing",
          percent: p.percent,
        };
        if (p.message && p.message !== lastMessage) {
          update.log = p.message;
          lastMessage = p.message;
        }
        updateProcessingState(key, update);
      }
    }
  };

  const processDocument = async (file) => {
    const key = file.key;
    // Steps already completed by an earlier attempt are not repeated
    const done = (resumeRef.current[key] = resumeRef.current[key] || {});

    try {
      if (!done.fileUrl) {
        done.fileUrl = await uploadToSupabase(file);
      }

      if (!done.documentId) {
        updateProcessingState(key, {
          stage: "preparing",
          log: "Creating database record...",
        });
        done.documentId = await createFirestoreDocument(file, done.fileUrl);
      }
      const documentId = done.documentId;

      updateProcessingState(key, {
        stage: "preparing",
        percent: 0,
        log: "Starting processing...",
      });

      // The server starts the job and answers at once (202); it does not wait for it.
      // (/reprocess is the same job for a record that exists already, which is what a
      // retry needs.)
      const response = await apiFetch(
        `${VITE_API_BASE_URL}/documents/${done.started ? "reprocess" : "process"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Only the id: the server reads the file URL from the stored record
          body: JSON.stringify({ documentId }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Processing failed to start");
      }
      done.started = true;

      // Real progress, written by the processing job onto the document
      const finished = await waitForProcessing(documentId, key);

      updateProcessingState(key, {
        stage: "complete",
        percent: 100,
        log: "Processing complete!",
      });

      return {
        status: "success",
        key,
        fileName: file.name,
        documentId,
        chunksCreated: finished.chunksCount || 0,
        textChunks: finished.textChunks || 0,
        visualChunks: finished.visualChunks || 0,
      };
    } catch (error) {
      updateProcessingState(key, {
        stage: "failed",
        error: error.message,
        log: `Error: ${error.message}`,
      });

      return {
        status: "failed",
        key,
        fileName: file.name,
        error: error.message,
      };
    }
  };

  const handleUpload = async () => {
    if (!validateAllFiles()) return;

    setUploading(true);
    setProcessing(true);
    setUploadResults(null);
    setProcessingStates({});
    const startedWith = files;

    toast.loading(`Processing ${startedWith.length} document(s)...`, {
      id: "upload-toast",
    });

    const results = [];

    // Process files sequentially to avoid overwhelming the server
    for (const file of startedWith) {
      const result = await processDocument(file);
      results.push(result);
    }

    const successful = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;

    toast.dismiss("upload-toast");

    if (successful === startedWith.length) {
      toast.success(`All ${successful} documents processed successfully!`);
    } else if (failed === startedWith.length) {
      toast.error(`All ${failed} documents failed to process`);
    } else {
      toast.success(`${successful} successful, ${failed} failed`, {
        duration: 5000,
      });
    }

    setUploadResults(results);
    setUploading(false);
    setProcessing(false);
  };

  const handleReset = () => {
    Object.keys(checkersRef.current).forEach((k) => checkersRef.current[k].cancel());
    checkersRef.current = {};
    hashesRef.current = {};
    resumeRef.current = {};
    setFiles([]);
    setFileMetadata({});
    setProcessingStates({});
    setUploadResults(null);
    setDuplicateWarnings({});
    setUploading(false);
    setProcessing(false);
  };

  // Go back to the form with only the files that failed. Their metadata, and whatever was
  // already uploaded or registered, is kept, so retrying does not duplicate anything.
  const handleRetryFailed = () => {
    const failedKeys = new Set(
      (uploadResults || []).filter((r) => r.status === "failed").map((r) => r.key)
    );
    setFiles((prev) => prev.filter((f) => failedKeys.has(f.key)));
    setProcessingStates({});
    setUploadResults(null);
  };

  const canUpload = () => {
    return (
      files.length > 0 &&
      files.every((f) => validateFile(f.key)) &&
      !uploading &&
      !processing
    );
  };

  // Show success summary
  if (uploadResults) {
    return (
      <SuccessSummary
        results={uploadResults}
        onClose={handleReset}
        onRetryFailed={handleRetryFailed}
      />
    );
  }

  // Show processing view
  if (processing) {
    return (
      <ProcessingView
        files={files}
        processingStates={processingStates}
        fileMetadata={fileMetadata}
      />
    );
  }

  // Main upload UI
  return (
    <div className="upload-document-wrapper">
      <div className="upload-mode-selector">
        <button
          className={`mode-btn ${uploadMode === "single" ? "active" : ""}`}
          onClick={() => setUploadMode("single")}
          disabled={uploading || processing}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
          </svg>
          Single Upload
        </button>
        <button
          className={`mode-btn ${uploadMode === "bulk" ? "active" : ""}`}
          onClick={() => setUploadMode("bulk")}
          disabled={uploading || processing}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M13 2v7h7" />
            <path d="M8 13h8M8 17h8" />
          </svg>
          Bulk Upload (up to 20 files)
        </button>
      </div>

      <DragDropZone
        onFilesSelected={handleFilesSelected}
        disabled={uploading || processing}
        acceptMultiple={uploadMode === "bulk"}
      />

      {files.length > 0 && (
        <div className="files-section">
          <div className="files-header">
            <h3 className="files-title">Selected Files ({files.length})</h3>
            <button
              className="clear-all-btn"
              onClick={handleReset}
              disabled={uploading || processing}
            >
              Clear All
            </button>
          </div>

          <div className="files-list">
            {files.map((file) => (
              <div key={file.key}>
                <FileCard
                  file={file}
                  metadata={fileMetadata[file.key] || {}}
                  onMetadataChange={(metadata) =>
                    handleMetadataChange(file.key, metadata)
                  }
                  onRemove={() => handleRemoveFile(file.key)}
                  disabled={uploading || processing}
                  replaceableDocuments={replaceableDocuments}
                />
                {duplicateWarnings[file.key] && (
                  <DuplicateWarning
                    exact={duplicateWarnings[file.key].exact}
                    duplicates={duplicateWarnings[file.key].similar}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="upload-actions-fixed">
            <div className="upload-summary">
              <span className="file-count">
                {files.length} file{files.length !== 1 ? "s" : ""} ready
              </span>
              {Object.keys(duplicateWarnings).length > 0 && (
                <span className="warning-count">
                  ⚠️ {Object.keys(duplicateWarnings).length} potential duplicate
                  {Object.keys(duplicateWarnings).length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            <button
              className="upload-btn"
              onClick={handleUpload}
              disabled={!canUpload()}
            >
              {uploading || processing ? (
                <>
                  <div className="btn-spinner" />
                  Processing...
                </>
              ) : (
                <>
                  Upload & Process {files.length} Document
                  {files.length !== 1 ? "s" : ""}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
