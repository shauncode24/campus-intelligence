import React, { useState, useEffect } from "react";
import "../styles/CampusAssistantShowcase.css";
import Steps from "./Steps";

const CampusAssistantShowcase = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const queries = [
    {
      badge: "Planning",
      question: "What's the deadline for Q4 reports?",
      context: "Team coordination",
    },
    {
      badge: "Research",
      question: "How to optimize database queries?",
      context: "Performance improvement",
    },
    {
      badge: "Scheduling",
      question: "When is the next sprint review?",
      context: "Project management",
    },
    {
      badge: "Learning",
      question: "What is the best practice for API design?",
      context: "Development standards",
    },
  ];

  useEffect(() => {
    const timeouts = [];

    const interval = setInterval(() => {
      setIsAnimating(true);

      const timeoutId = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % queries.length);
        setIsAnimating(false);
      }, 600);

      timeouts.push(timeoutId);
    }, 4000);

    return () => {
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, [queries.length]);

  return (
    <div className="default showcase-grid">
      {/* Right Side - Stats Section */}
      <div className="default stats-section">
        <Steps title="10000+" subtitle="Questions Answered" />
        <Steps title="500+" subtitle="Documents Indexed" />
        <Steps title="99%" subtitle="Accuracy Rate" />
      </div>
      {/* Left Side - Rotating Query Card */}
      <div className="default rotating-card">
        <div
          className={`query-card ${isAnimating ? "animate-out" : "animate-in"}`}
        >
          <div className="query-badge">
            <svg className="badge-icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            {queries[currentIndex].badge}
          </div>

          <div className="query-content">
            <div className="quote-mark">"</div>
            <h2 className="query-text">{queries[currentIndex].question}</h2>
            <div className="query-context">{queries[currentIndex].context}</div>
          </div>

          <div className="query-footer">
            <div className="pulse-indicator">
              <div className="pulse-dot"></div>
              <span>AI Processing</span>
            </div>
          </div>
        </div>

        <div className="dots-indicator">
          {queries.map((_, index) => (
            <div
              key={index}
              className={`dot ${index === currentIndex ? "active" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default CampusAssistantShowcase;
