import { useState } from "react";
import { supabase } from "../app/supabase";
import { db } from "../app/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
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
      const response = await fetch(
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
    const metadata = fileMetadata[file.name];

    const docData = {
      name: metadata.name,
      department: metadata.department,
      documentType: metadata.documentType,
      fileUrl,
      uploadedAt: serverTimestamp(),
      uploadedBy: "admin@test.com", // TODO: Get from auth
      status: "Processing",
      fileSize: file.size,
      // Enhanced metadata
      academicYear: metadata.academicYear || null,
      programs: metadata.programs || [],
      years: metadata.years || [],
      tags: metadata.tags ? metadata.tags.split(",").map((t) => t.trim()) : [],
      effectiveDate: metadata.effectiveDate || null,
      expiryDate: metadata.expiryDate || null,
      version: metadata.version || null,
      owner: metadata.owner || null,
      accessLevel: metadata.accessLevel || "Public",
    };

    const docRef = await addDoc(collection(db, "documents"), docData);
    return docRef.id;
  };

  const processDocument = async (file) => {
    const fileName = file.name;

    try {
      // Upload to Supabase
      const fileUrl = await uploadToSupabase(file);

      updateProcessingState(fileName, {
        stage: "extracting",
        log: "Creating database record...",
      });

      // Create Firestore document
      const documentId = await createFirestoreDocument(file, fileUrl);

      updateProcessingState(fileName, {
        stage: "extracting",
        log: "Extracting text and images...",
      });

      // Call Python RAG service
      const response = await fetch(`${VITE_API_BASE_URL}/documents/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          fileUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Processing failed");
      }

      updateProcessingState(fileName, {
        stage: "embedding",
        log: "Generating embeddings...",
      });

      // Poll for completion or wait for response
      await new Promise((resolve) => setTimeout(resolve, 1000));

      updateProcessingState(fileName, {
        stage: "storing",
        log: "Storing in database...",
      });

      await new Promise((resolve) => setTimeout(resolve, 800));

      updateProcessingState(fileName, {
        stage: "indexing",
        log: "Creating search index...",
      });

      const processResult = await response.json();

      updateProcessingState(fileName, {
        stage: "complete",
        log: "Processing complete!",
      });

      return {
        status: "success",
        fileName: file.name,
        documentId,
        chunksCreated: processResult.totalChunks || 0,
        textChunks: processResult.textChunks || 0,
        visualChunks: processResult.visualChunks || 0,
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
