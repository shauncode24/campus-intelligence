import { useState, useEffect } from "react";
import { db } from "../app/firebase";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import "./DocumentManagement.css";
import Header from "../components/Header";

export default function DocumentManagement() {
  const [documents, setDocuments] = useState([]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "documents"));
      const docs = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setDocuments(docs);
    } catch (err) {
      console.error("Error fetching documents:", err);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to delete this document?")) {
      try {
        await deleteDoc(doc(db, "documents", id));
        setDocuments(documents.filter((d) => d.id !== id));
        alert("Document deleted successfully");
      } catch (err) {
        alert("Error deleting document: " + err.message);
      }
    }
  };

  const handleReprocess = async (id) => {
    alert("Reprocess functionality coming soon");
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
              {documents.length === 0 ? (
                <tr>
                  <td
                    colSpan="6"
                    style={{
                      textAlign: "center",
                      padding: "2rem",
                      color: "#6c757d",
                    }}
                  >
                    No documents uploaded yet
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div className="document-name-cell">
                        <span className="document-icon">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            class="bi bi-file-earmark"
                            viewBox="0 0 16 16"
                          >
                            <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" />
                          </svg>
                        </span>
                        <span className="document-name">
                          {doc.name || "Untitled"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="category-badge">
                        {doc.department || "General"}
                      </span>
                    </td>
                    <td className="file-size">
                      {formatFileSize(doc.fileSize)}
                    </td>
                    <td className="upload-date">
                      {formatDate(doc.uploadedAt)}
                    </td>
                    <td>
                      <span
                        className={`status-badge ${
                          doc.status === "Pending"
                            ? "status-pending"
                            : "status-processed"
                        }`}
                      >
                        {doc.status || "Processed"}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button
                          className="action-btn"
                          onClick={() => handleReprocess(doc.id)}
                          title="Reprocess"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            class="bi bi-arrow-repeat"
                            viewBox="0 0 16 16"
                          >
                            <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9" />
                            <path
                              fill-rule="evenodd"
                              d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
                            />
                          </svg>
                        </button>
                        <button
                          className="action-btn delete"
                          onClick={() => handleDelete(doc.id)}
                          title="Delete"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            class="bi bi-trash"
                            viewBox="0 0 16 16"
                          >
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z" />
                            <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
