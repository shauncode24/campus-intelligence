import UploadDocument from "../components/UploadDocument";
import Header from "../components/Header";
import "./AddDocument.css";
import { usePageTitle } from "../components/usePageTitle";

export default function AddDocument() {
  usePageTitle("Upload Document");
  return (
    <>
      <Header role="admin" />
      <div className="admin-dashboard">
        <UploadDocument />
      </div>
    </>
  );
}
