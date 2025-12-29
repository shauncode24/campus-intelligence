import { useState } from "react";
import { supabase } from "../app/supabase";
import { db } from "../app/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import "../styles/UploadDocument.css";
import toast from "react-hot-toast";
const { VITE_API_BASE_URL } = import.meta.env;

export default function UploadDocument() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const upload = async () => {
    if (!file) {
      toast.error("Please select a PDF");
      return;
    }

    setUploading(true);

    try {
      const filePath = `${Date.now()}_${file.name}`;

      // 1️⃣ Upload to Supabase
      const { error } = await supabase.storage
        .from("documents")
        .upload(filePath, file);

      if (error) throw error;

      // 2️⃣ Get public URL
      const { data } = supabase.storage
        .from("documents")
        .getPublicUrl(filePath);

      const fileUrl = data.publicUrl;

      // 3️⃣ Store metadata in Firestore with "Processing" status
      const docRef = await addDoc(collection(db, "documents"), {
        name,
        department,
        fileUrl,
        uploadedAt: serverTimestamp(),
        uploadedBy: "admin@test.com",
        status: "Processing",
        fileSize: file.size,
      });

      console.log("📄 Document uploaded with ID:", docRef.id);
      setUploading(false);
      setProcessing(true);

      // 4️⃣ Trigger processing (chunking and embedding)
      const processResponse = await fetch(
        `${VITE_API_BASE_URL}/documents/process`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: docRef.id,
            fileUrl: fileUrl,
          }),
        }
      );

      const processResult = await processResponse.json();

      if (processResponse.ok) {
        toast.success(
          `Document uploaded and processed successfully!\n\n` +
            `Chunks created: ${processResult.chunksCount}\n` +
            `Embeddings generated: ${processResult.embeddedCount}`
        );
      } else {
        toast.error(
          `Document uploaded but processing failed:\n${processResult.message}\n\n` +
            `Please try reprocessing from the Documents page.`
        );
      }

      // Reset form
      setFile(null);
      setName("");
      setDepartment("");
    } catch (err) {
      console.error("Upload error:", err);
      toast.error(err.message);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const isDisabled = uploading || processing || !file || !name || !department;

  return (
    <div className="upload-document-container">
      <div className="upload-header">
        <div style={{ display: "flex", alignItems: "center" }}>
          <div>
            <h2 className="upload-title">Upload New Document</h2>
            <p className="upload-subtitle">
              Add a new official source to the knowledge base
            </p>
          </div>
        </div>
      </div>

      <div className="upload-card">
        <div className="form-section">
          <div className="form-inputs">
            <input
              className="form-input"
              placeholder="Document Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={uploading || processing}
            />
            <input
              className="form-input"
              placeholder="Department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              disabled={uploading || processing}
            />
          </div>
        </div>

        <div className="form-section">
          <h3 className="form-section-title">Source File</h3>
          <div className="dropzone">
            <div className="dropzone-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                fill="currentColor"
                className="bi bi-cloud-upload"
                viewBox="0 0 16 16"
              >
                <path
                  fillRule="evenodd"
                  d="M4.406 1.342A5.53 5.53 0 0 1 8 0c2.69 0 4.923 2 5.166 4.579C14.758 4.804 16 6.137 16 7.773 16 9.569 14.502 11 12.687 11H10a.5.5 0 0 1 0-1h2.688C13.979 10 15 8.988 15 7.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 2.825 10.328 1 8 1a4.53 4.53 0 0 0-2.941 1.1c-.757.652-1.153 1.438-1.153 2.055v.448l-.445.049C2.064 4.805 1 5.952 1 7.318 1 8.785 2.23 10 3.781 10H6a.5.5 0 0 1 0 1H3.781C1.708 11 0 9.366 0 7.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383"
                />
                <path
                  fillRule="evenodd"
                  d="M7.646 4.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 5.707V14.5a.5.5 0 0 1-1 0V5.707L5.354 7.854a.5.5 0 1 1-.708-.708z"
                />
              </svg>
            </div>
            <div className="dropzone-text">Drag and drop your PDF here</div>
            <div className="dropzone-subtext">
              or click to browse from your computer
            </div>
            <input
              type="file"
              accept="application/pdf"
              className="file-input"
              onChange={(e) => setFile(e.target.files[0])}
              disabled={uploading || processing}
            />
          </div>
          {file && <div className="selected-file">Selected: {file.name}</div>}
        </div>

        {(uploading || processing) && (
          <div className="processing-status">
            <div className="spinner"></div>
            <p>
              {uploading
                ? "📤 Uploading document..."
                : "⚙️ Processing document (chunking and embedding)..."}
            </p>
            <p className="processing-note">
              This may take a minute. Please don't close this page.
            </p>
          </div>
        )}

        <div className="form-actions">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setFile(null);
              setName("");
              setDepartment("");
            }}
            disabled={uploading || processing}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={upload}
            disabled={isDisabled}
          >
            {uploading
              ? "Uploading..."
              : processing
              ? "Processing..."
              : "Upload & Process Document"}
          </button>
        </div>
      </div>
    </div>
  );
}
