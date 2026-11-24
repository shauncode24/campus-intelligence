import { useState, useEffect } from "react";
import { db } from "../app/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { documentState } from "../utils/documentState";
import { supabase } from "../app/supabase";
import { apiFetch } from "../utils/api";
import toast from "react-hot-toast";
import { handleError } from "../utils/errors";

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
  const [duplicateWarnings, setDuplicateWarnings] = useState({});
  // Current documents an upload can replace (admin-only page, so reading all is allowed)
  const [replaceableDocuments, setReplaceableDocuments] = useState([]);

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
    const newFiles = selectedFiles.filter(
      (file) => !files.some((f) => f.name === file.name)
    );

    if (newFiles.length === 0) {
      toast.error("Files already selected");
      return;
    }

    setFiles([...files, ...newFiles]);

    // Initialize metadata for new files
    const newMetadata = {};
    newFiles.forEach((file) => {
      newMetadata[file.name] = {
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

    setFileMetadata({ ...fileMetadata, ...newMetadata });

    // Check for duplicates
    newFiles.forEach((file) => {
      checkDuplicate(file.name);
    });
  };

  const checkDuplicate = async (fileName) => {
    const metadata = fileMetadata[fileName];
    if (!metadata || !metadata.name || !metadata.department) return;

    try {
      const response = await apiFetch(
        `${VITE_API_BASE_URL}/documents/check-duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: metadata.name,
            department: metadata.department,
          }),
        }
      );

      const result = await response.json();

      if (result.hasDuplicates) {
        setDuplicateWarnings({
          ...duplicateWarnings,
          [fileName]: result.similarDocuments,
        });
      } else {
        const newWarnings = { ...duplicateWarnings };
        delete newWarnings[fileName];
        setDuplicateWarnings(newWarnings);
      }
    } catch (error) {
      console.error("Error checking duplicate:", error);
    }
  };

  const handleMetadataChange = (fileName, metadata) => {
    setFileMetadata({
      ...fileMetadata,
      [fileName]: metadata,
    });

    // Recheck duplicates when name or department changes
    if (metadata.name && metadata.department) {
      checkDuplicate(fileName);
    }
  };

  const handleRemoveFile = (fileName) => {
    setFiles(files.filter((f) => f.name !== fileName));

    const newMetadata = { ...fileMetadata };
    delete newMetadata[fileName];
    setFileMetadata(newMetadata);

    const newWarnings = { ...duplicateWarnings };
    delete newWarnings[fileName];
    setDuplicateWarnings(newWarnings);
  };

  const validateFile = (fileName) => {
    const metadata = fileMetadata[fileName];
    return metadata.name && metadata.department && metadata.documentType;
  };

  const validateAllFiles = () => {
    if (files.length === 0) {
      toast.error("Please select at least one file");
      return false;
    }

    const invalidFiles = files.filter((f) => !validateFile(f.name));
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
    const fileName = file.name;
    updateProcessingState(fileName, {
      stage: "uploading",
      log: "Uploading file to storage...",
    });

    const filePath = `${Date.now()}_${file.name}`;
    const { error } = await supabase.storage
      .from("documents")
      .upload(filePath, file);

    if (error) throw error;

    const { data } = supabase.storage.from("documents").getPublicUrl(filePath);

    return data.publicUrl;
  };

  const createFirestoreDocument = async (file, fileUrl) => {
    const { supersedes, ...metadata } = fileMetadata[file.name];

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
  const waitForProcessing = async (documentId, fileName) => {
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
        updateProcessingState(fileName, update);
      }
    }
  };

  const processDocument = async (file) => {
    const fileName = file.name;

    try {
      // Upload to Supabase
      const fileUrl = await uploadToSupabase(file);

      updateProcessingState(fileName, {
        stage: "preparing",
        log: "Creating database record...",
      });

      // Create Firestore document
      const documentId = await createFirestoreDocument(file, fileUrl);

      updateProcessingState(fileName, {
        stage: "preparing",
        log: "Starting processing...",
      });

      // The server starts the job and answers at once (202); it does not wait for it
      const response = await apiFetch(`${VITE_API_BASE_URL}/documents/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the id: the server reads the file URL from the stored record
        body: JSON.stringify({ documentId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Processing failed to start");
      }

      // Real progress, written by the processing job onto the document
      const finished = await waitForProcessing(documentId, fileName);

      updateProcessingState(fileName, {
        stage: "complete",
        percent: 100,
        log: "Processing complete!",
      });

      return {
        status: "success",
        fileName: file.name,
        documentId,
        chunksCreated: finished.chunksCount || 0,
        textChunks: finished.textChunks || 0,
        visualChunks: finished.visualChunks || 0,
      };
    } catch (error) {
      updateProcessingState(fileName, {
        stage: "failed",
        error: error.message,
        log: `Error: ${error.message}`,
      });

      return {
        status: "failed",
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

    toast.loading(`Processing ${files.length} document(s)...`, {
      id: "upload-toast",
    });

    const results = [];

    // Process files sequentially to avoid overwhelming the server
    for (const file of files) {
      const result = await processDocument(file);
      results.push(result);
    }

    const successful = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "failed").length;

    toast.dismiss("upload-toast");

    if (successful === files.length) {
      toast.success(`All ${successful} documents processed successfully!`);
    } else if (failed === files.length) {
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
    setFiles([]);
    setFileMetadata({});
    setProcessingStates({});
    setUploadResults(null);
    setDuplicateWarnings({});
    setUploading(false);
    setProcessing(false);
  };

  const canUpload = () => {
    return (
      files.length > 0 &&
      files.every((f) => validateFile(f.name)) &&
      !uploading &&
      !processing
    );
  };

  // Show success summary
  if (uploadResults) {
    return <SuccessSummary results={uploadResults} onClose={handleReset} />;
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
          Bulk Upload (10-20 files)
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
              <div key={file.name}>
                <FileCard
                  file={file}
                  metadata={fileMetadata[file.name] || {}}
                  onMetadataChange={(metadata) =>
                    handleMetadataChange(file.name, metadata)
                  }
                  onRemove={() => handleRemoveFile(file.name)}
                  disabled={uploading || processing}
                  replaceableDocuments={replaceableDocuments}
                />
                {duplicateWarnings[file.name] && (
                  <DuplicateWarning duplicates={duplicateWarnings[file.name]} />
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
