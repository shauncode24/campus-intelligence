import React, { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import "../styles/CampusAssistant.css";

const CampusAssistant = () => {
  const fullText =
    "The add/drop deadline for the Fall 2024 semester is September 15th. You can manage your course registration through the Student Portal under the 'Academics' tab. Late drops after this date may result in a 'W' on your transcript.";
  const [displayedText, setDisplayedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < fullText.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev) => prev + fullText[currentIndex]);
        setCurrentIndex((prev) => prev + 1);
      }, 20); // Adjust speed here (lower = faster)

      return () => clearTimeout(timeout);
    }
  }, [currentIndex, fullText]);

  return (
    <div className="assistant-card">
      {/* Header with gradient */}
      <div className="gradient-header"></div>

      {/* Content */}
      <div className="assistant-content">
        {/* Title Section */}
        <div className="title-section">
          {/* Avatar */}
          <div className="avatar">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="white"
              class="bi bi-stars"
              viewBox="0 0 16 16"
            >
              <path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z" />
            </svg>
          </div>

          {/* Title and Badge */}
          <div className="title-badge-wrapper">
            <h2 className="assistant-title">Campus Assistant</h2>
            <div className="ai-badge">
              <Sparkles className="sparkle-icon" />
              <span className="badge-text">AI Generated</span>
            </div>
          </div>
        </div>

        {/* Message Text */}
        <div className="message-text">
          {displayedText}
          <span className="typing-cursor"></span>
        </div>

        {/* Action Buttons Placeholder */}
        <div className="action-buttons">
          <div className="button-placeholder button-1"></div>
          <div className="button-placeholder button-2"></div>
        </div>
      </div>
    </div>
  );
};

export default CampusAssistant;
