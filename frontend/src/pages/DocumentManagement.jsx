import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../app/firebase";
import { collection, getDocs } from "firebase/firestore";
import { apiFetch } from "../utils/api";
import "./DocumentManagement.css";
import Header from "../components/Header";
import toast from "react-hot-toast";
import { usePageTitle } from "../components/usePageTitle";
import ConfirmModal from "../components/ConfirmModal";
import { handleError } from "../utils/errors";
import { documentState, STATE_LABEL } from "../utils/documentState";

const { VITE_API_BASE_URL } = import.meta.env;

const PAGE_SIZE = 25;
const STATUS_FILTERS = [
  "All",
  "Processed",
  "Processing",
  "Error",
  "Cancelled",
  "Deleting",
  "Not in use",
];
const REFRESH_WHILE_PROCESSING_MS = 5000;

// What each confirmation asks (and does)
const CONFIRMATIONS = {
  delete: {
    title: "Delete this document?",
    message:
      "It is removed from the knowledge base, its stored file and its cached answers are deleted. This cannot be undone.",
  },
  reprocess: {
    title: "Reprocess this document?",
    message:
      "Its existing chunks and embeddings will be replaced, and it will not be used to answer questions until processing finishes.",
  },
  cancel: {
    title: "Cancel processing?",
    message:
      "Processing stops and anything it already saved is removed. You can reprocess the document later.",
  },
};

function statusClass(status) {
  return `status-${String(status || "processed").toLowerCase()}`;
}

function sortKey(doc) {
  const t = doc.uploadedAt;
  if (!t) return 0;
  if (t.seconds) return t.seconds;
  if (t.toDate) return t.toDate().getTime() / 1000;
  return new Date(t).getTime() / 1000 || 0;
}

export default function DocumentManagement() {
  usePageTitle("Manage Documents");
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState(null); // { type, id, name }

  const fetchDocuments = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, "documents"));
      const docs = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setDocuments(docs);
      setLoadError(false);
    } catch (err) {
      if (!silent) {
        handleError(err, { customMessage: "Failed to load documents" });
        setLoadError(true);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // While anything is being processed, keep the list current without a manual refresh
  const anyProcessing = documents.some((d) => d.status === "Processing" || d.reprocessing === true);
  useEffect(() => {
    if (!anyProcessing) return undefined;
    const timer = setInterval(
      () => fetchDocuments({ silent: true }),
      REFRESH_WHILE_PROCESSING_MS
    );
    return () => clearInterval(timer);
  }, [anyProcessing, fetchDocuments]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents
      .filter((d) => {
        if (q) {
          const hay = `${d.name || ""} ${d.department || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (statusFilter === "All") return true;
        if (statusFilter === "Not in use") {
          return d.status === "Processed" && documentState(d) !== "live";
        }
        return (d.status || "Processed") === statusFilter;
      })
      .sort((a, b) => sortKey(b) - sortKey(a));
  }, [documents, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  );

  const runDelete = async (id) => {
    try {
      const response = await apiFetch(`${VITE_API_BASE_URL}/documents/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        // The server hides the document from answers first, so a failed
        // delete is safe to retry.
        fetchDocuments({ silent: true });
        throw new Error("Delete failed");
      }
      const result = await response.json();
      setDocuments((docs) => docs.filter((d) => d.id !== id));
      toast.success("Document deleted successfully");
      if (result.file && result.file.deleted === false) {
        toast(
          `The file is still in storage (${result.file.reason}). Remove it manually if needed.`,
          { duration: 8000 }
        );
      }
    } catch (err) {
      handleError(err, { customMessage: "Failed to delete document" });
    }
  };

  const runReprocess = async (id) => {
    try {
      setDocuments((docs) =>
        docs.map((d) =>
          d.id === id
            ? d.status === "Processed"
              ? { ...d, reprocessing: true } // still live, still answering
              : { ...d, status: "Processing" }
            : d
        )
      );
      const response = await apiFetch(
        `${VITE_API_BASE_URL}/documents/reprocess`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: id }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        toast.success("Reprocessing started. This page updates as it runs.");
      } else {
        toast.error(result.message || "Could not start reprocessing");
      }
    } catch (err) {
      handleError(err, { customMessage: "Failed to reprocess document" });
    } finally {
      fetchDocuments({ silent: true });
    }
  };

  const runCancel = async (id) => {
    try {
      const response = await apiFetch(
        `${VITE_API_BASE_URL}/documents/cancel-processing/${id}`,
        { method: "DELETE" }
      );
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        toast.success("Processing cancelled");
      } else {
        toast.error(result.error || "Could not cancel");
      }
    } catch (err) {
      handleError(err, { customMessage: "Failed to cancel processing" });
    } finally {
      fetchDocuments({ silent: true });
    }
  };

  const confirmAction = () => {
    const { type, id } = confirming;
    setConfirming(null);
    if (type === "delete") runDelete(id);
    else if (type === "reprocess") runReprocess(id);
    else if (type === "cancel") runCancel(id);
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "N/A";
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return `${mb} MB`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const emptyState = (title, text, action) => (
    <tr>
      <td colSpan="6" style={{ padding: "60px 20px", textAlign: "center" }}>
        <h3 style={{ fontSize: "1.25rem", color: "#202124", margin: "0 0 8px 0" }}>
          {title}
        </h3>
        <p style={{ color: "#5f6368", margin: "0 0 24px 0" }}>{text}</p>
        {action}
      </td>
    </tr>
  );

  return (
    <>
      <Header role="admin" />
      <div className="document-management">
        <div className="management-header">
          <h1 className="management-title">Document Management</h1>
          <p className="management-subtitle">
            Manage the knowledge base sources
          </p>
        </div>

        <div className="management-toolbar">
          <input
            type="search"
            className="management-search"
            placeholder="Search by name or department"
            aria-label="Search documents"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <select
            className="management-filter"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "All" ? "All statuses" : s}
              </option>
            ))}
          </select>
          <button
            className="action-btn refresh-btn"
            onClick={() => fetchDocuments()}
            title="Refresh"
            disabled={loading}
          >
            ↻ Refresh
          </button>
        </div>

        <div className="documents-table-container">
          <table className="documents-table">
            <thead>
              <tr>
                <th>DOCUMENT NAME</th>
                <th>CATEGORY</th>
                <th>SIZE</th>
                <th>UPLOAD DATE</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                emptyState("Loading documents...", "Just a moment.", null)}
              {!loading &&
                loadError &&
                emptyState(
                  "Could not load documents",
                  "Check your connection and try again.",
                  <button className="primary-btn" onClick={() => fetchDocuments()}>
                    Try again
                  </button>
                )}
              {!loading &&
                !loadError &&
                documents.length === 0 &&
                emptyState(
                  "No documents uploaded yet",
                  "Upload your first document to start building the knowledge base",
                  <button
                    className="primary-btn"
                    onClick={() => navigate("/admin/add-document")}
                  >
                    Upload Document
                  </button>
                )}
              {!loading &&
                !loadError &&
                documents.length > 0 &&
                visible.length === 0 &&
                emptyState(
                  "No matching documents",
                  "Try a different search or status filter.",
                  null
                )}
              {!loading &&
                !loadError &&
                pageRows.map((doc) => {
                  const status = doc.status || "Processed";
                  const note = STATE_LABEL[documentState(doc)];
                  const busy = status === "Processing" || status === "Deleting" || doc.reprocessing === true;
                  return (
                    <tr key={doc.id}>
                      <td>
                        <div className="document-name-cell">
                          <span className="document-icon">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              fill="currentColor"
                              viewBox="0 0 16 16"
                            >
                              <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" />
                            </svg>
                          </span>
                          <span className="document-name">
                            {doc.name || "Untitled"}
                            {doc.version ? ` (${doc.version})` : ""}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="category-badge">
                          {doc.department || "General"}
                        </span>
                      </td>
                      <td className="file-size">{formatFileSize(doc.fileSize)}</td>
                      <td className="upload-date">{formatDate(doc.uploadedAt)}</td>
                      <td>
                        <span className={`status-badge ${statusClass(status)}`}>
                          {status}
                          {status === "Processing" &&
                            doc.processing &&
                            typeof doc.processing.percent === "number" &&
                            ` ${doc.processing.percent}%`}
                        </span>
                        {status === "Processing" && doc.processing?.message && (
                          <div className="status-note">{doc.processing.message}</div>
                        )}
                        {note && (
                          <div
                            className="status-note"
                            title="This document is kept but is not used to answer questions"
                          >
                            {note}
                          </div>
                        )}
                        {status === "Processed" && doc.reprocessing === true && (
                          <div className="status-note" title="Students still get answers from the current version until the new one is ready">
                            Updating… {doc.processing?.message || ""} (still answering from the current version)
                          </div>
                        )}
                        {status === "Processed" && doc.reprocessError && !doc.reprocessing && (
                          <div className="status-note error-note" title={doc.reprocessError}>
                            Update failed, current version kept: {doc.reprocessError}
                          </div>
                        )}
                        {status === "Processed" && doc.warning && (
                          <div className="status-note warning-note" title={doc.warning}>
                            ⚠ {doc.warning}
                          </div>
                        )}
                        {status === "Error" && doc.errorMessage && (
                          <div className="status-note error-note" title={doc.errorMessage}>
                            {doc.errorMessage}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="actions-cell">
                          {(status === "Processing" || doc.reprocessing === true) && (
                            <button
                              className="action-btn"
                              onClick={() =>
                                setConfirming({ type: "cancel", id: doc.id, name: doc.name })
                              }
                              title="Cancel processing"
                              aria-label={`Cancel processing of ${doc.name}`}
                            >
                              ✕
                            </button>
                          )}
                          <button
                            className="action-btn"
                            onClick={() =>
                              setConfirming({ type: "reprocess", id: doc.id, name: doc.name })
                            }
                            title={busy ? "Not available while processing" : "Reprocess"}
                            aria-label={`Reprocess ${doc.name}`}
                            disabled={busy}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              fill="currentColor"
                              viewBox="0 0 16 16"
                            >
                              <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9" />
                              <path
                                fillRule="evenodd"
                                d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
                              />
                            </svg>
                          </button>
                          <button
                            className="action-btn delete"
                            onClick={() =>
                              setConfirming({ type: "delete", id: doc.id, name: doc.name })
                            }
                            title="Delete"
                            aria-label={`Delete ${doc.name}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              fill="currentColor"
                              viewBox="0 0 16 16"
                            >
                              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {visible.length > PAGE_SIZE && (
          <div className="management-pagination">
            <button
              className="action-btn"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {pageCount} ({visible.length} documents)
            </span>
            <button
              className="action-btn"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={confirmAction}
        title={confirming ? `${CONFIRMATIONS[confirming.type].title}` : ""}
        message={
          confirming
            ? `${confirming.name || "This document"}: ${CONFIRMATIONS[confirming.type].message}`
            : ""
        }
      />
    </>
  );
}
