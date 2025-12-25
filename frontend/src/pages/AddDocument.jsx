import UploadDocument from "../components/UploadDocument";
import Header from "../components/Header";
import "./AddDocument.css";

export default function AddDocument() {
  return (
    <>
      <Header role="admin" />
      <div className="admin-dashboard">
        <UploadDocument />
      </div>
    </>
  );
}
