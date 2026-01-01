import Chat from "../components/Chat";
import Header from "./../components/Header";
import Footer from "./../components/Footer";
import "./StudentDashboard.css";
import { useState } from "react";
import { usePageTitle } from "../components/usePageTitle";

export default function StudentDashboard() {
  usePageTitle("Ask Questions");
  const [hasMessages, setHasMessages] = useState(false);

  return (
    <>
      <Header />
      <div
        className={`default student-main ${
          hasMessages ? "student-main-has-messages" : ""
        }`}
      >
        <div
          className={`default student-main-title ${
            hasMessages ? "has-messages" : ""
          }`}
        >
          How can we help you today?
        </div>
        <div
          className={`default student-main-subtitle ${
            hasMessages ? "has-messages" : ""
          }`}
        >
          Search across all campus documents, policies, and schedules.
        </div>
        <div className="default student-main-chat"></div>
        <Chat onMessagesChange={setHasMessages} />
      </div>
      <Footer />
    </>
  );
}
