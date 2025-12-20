import { useState } from "react";
import { supabase } from "../app/supabase";
import { db } from "../app/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export default function UploadDocument() {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");

  const upload = async () => {
    if (!file) {
      alert("Please select a PDF");
      return;
    }

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

      // 3️⃣ Store metadata in Firestore
      await addDoc(collection(db, "documents"), {
        name,
        department,
        fileUrl,
        uploadedAt: serverTimestamp(),
        uploadedBy: "admin@test.com",
      });

      alert("Document uploaded successfully");
      setFile(null);
      setName("");
      setDepartment("");
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <h2>Upload Official Document</h2>

      <input
        placeholder="Document Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <br />

      <input
        placeholder="Department"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
      />
      <br />

      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <br />

      <button onClick={upload}>Upload</button>
    </div>
  );
}
