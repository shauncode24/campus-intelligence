import Chat from "../components/Chat";
import Header from "./../components/Header";
import Footer from "./../components/Footer";
import "./StudentDashboard.css";
import { useState } from "react";
import { usePageTitle } from "../components/usePageTitle";
import ChatCard from "../components/ChatCard";

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
        <div className="default student-main-icon-div">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            fill="#ffbe42"
            class="bi bi-emoji-laughing"
            viewBox="0 0 16 16"
          >
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
            <path d="M12.331 9.5a1 1 0 0 1 0 1A5 5 0 0 1 8 13a5 5 0 0 1-4.33-2.5A1 1 0 0 1 4.535 9h6.93a1 1 0 0 1 .866.5M7 6.5c0 .828-.448 0-1 0s-1 .828-1 0S5.448 5 6 5s1 .672 1 1.5m4 0c0 .828-.448 0-1 0s-1 .828-1 0S9.448 5 10 5s1 .672 1 1.5" />
          </svg>
        </div>
        <div className="default student-main-title">
          Welcome back,&nbsp; <span style={{ color: "#4285f4" }}>Alex!</span>
        </div>
        <div className="default student-main-subtitle">
          I'm your campus AI assistant. I can help you find deadlines, course
          details, and administrative procedures.{" "}
        </div>
        <div className="default student-chat-cards">
          <ChatCard
            category="deadlines"
            questions="When is the final project submission for CS101?"
          />
          <ChatCard
            category="academics"
            questions="What are the prerequisites for Advanced Machine Learning?"
          />

          <ChatCard
            category="procedures"
            questions="How do I request an official transcript?"
          />

          <ChatCard
            category="financial"
            questions="Are there any scholarships for engineering students?"
          />
        </div>

        <div className="tip-banner">
          <div className="default tip-icon">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2" />
            </svg>
          </div>
          <div className="tip-content">
            <span className="tip-label">Tip:</span>
            <span className="tip-text">
              Be specific about dates and departments for better results. Try
              asking "When is the CS final project due?"
            </span>
          </div>
        </div>
      </div>{" "}
      <Footer />
      <div className="default chat-container-main">
        <Chat onMessagesChange={setHasMessages} />
      </div>
    </>
  );
}
