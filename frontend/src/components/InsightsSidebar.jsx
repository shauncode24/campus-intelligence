import React from "react";
import { TrendingUp, BookOpen, Flame, Clock } from "lucide-react";
import "../styles/InsightsSidebar.css";

export default function InsightsSidebar({ insights }) {
  if (!insights) return null;

  return (
    <div className="history-sidebar">
      <div className="history-sidebar-sticky">
        <div className="insights-title">Your Insights</div>

        {/* Total Questions */}
        <div className="default insight-card">
          <div className="default insight-header">
            <div className="default insight-header-icon">
              <TrendingUp size={20} color="#4285f4" />
            </div>
            {insights.weekGrowth !== 0 && (
              <span
                className={` ${
                  insights.weekGrowth > 0 ? "positive" : "negative"
                }`}
                style={{
                  fontSize: "15px",
                  fontWeight: "500",
                  color: "#202124",
                }}
              >
                {insights.weekGrowth > 0 ? "+" : ""}
                {insights.weekGrowth}% this week
              </span>
            )}
          </div>
          <div>
            <div className="insight-label">Total Questions</div>
            <div className="insight-value">{insights.totalQuestions}</div>
          </div>
        </div>

        {/* Top Topic */}
        <div className="default insight-card">
          <div className="default insight-header">
            <div className="default insight-header-icon">
              <BookOpen size={20} color="#fbbc04" />
            </div>
            <div
              style={{
                fontSize: "15px",
                fontWeight: "500",
                color: "#202124",
              }}
            >
              Top Topic
            </div>
          </div>
          <div>
            <div
              className="insight-label"
              style={{
                flexDirection: "row",
                gap: "5px",
                fontSize: "1.2rem",
                color: "black",
                textTransform: "capitalize",
              }}
            >
              {insights.topTopic}
            </div>
            <div
              className="insight-value"
              style={{ fontSize: "0.8rem", color: "#3985e2ff" }}
            >
              {insights.topTopicCount} questions asked
            </div>
          </div>
        </div>

        {/* Streak */}
        <div className="default insight-card">
          <div className="default insight-header">
            <div className="default insight-header-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="currentColor"
                class="bi bi-lightning-charge"
                viewBox="0 0 16 16"
              >
                <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09zM4.157 8.5H7a.5.5 0 0 1 .478.647L6.11 13.59l5.732-6.09H9a.5.5 0 0 1-.478-.647L9.89 2.41z" />
              </svg>
            </div>
            <span
              style={{
                fontSize: "15px",
                fontWeight: "500",
                color: "#202124",
              }}
            >
              Current Streak
            </span>
          </div>
          <div>
            <div
              className="default insight-label"
              style={{
                flexDirection: "row",
                gap: "5px",
                fontSize: "1.5rem",
                color: "black",
              }}
            >
              {insights.streak} Days
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="#FA7E39"
                class="bi bi-fire"
                viewBox="0 0 16 16"
              >
                <path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16m0-1c-1.657 0-3-1-3-2.75 0-.75.25-2 1.25-3C6.125 10 7 10.5 7 10.5c-.375-1.25.5-3.25 2-3.5-.179 1-.25 2 1 3 .625.5 1 1.364 1 2.25C11 14 9.657 15 8 15" />
              </svg>
            </div>
            <div
              className="insight-value"
              style={{ fontSize: "0.8rem", color: "#3985e2ff" }}
            >
              Keep it up!
            </div>
          </div>
        </div>

        {/* Activity Habits */}
        <div className="insight-card">
          <div
            style={{
              fontSize: "14px",
              fontWeight: "500",
              marginBottom: "18px",
              color: "#202124",
            }}
          >
            Activity Habits
          </div>

          <div className="habit-item">
            <Clock size={16} color="#5f6368" />
            <div>
              <div className="habit-label">Most active time</div>
              <div className="habit-value">{insights.mostActiveTime}</div>
            </div>
          </div>

          <div className="habit-item">
            <TrendingUp size={16} color="#5f6368" />
            <div>
              <div className="habit-label">Avg. Confidence</div>
              <div className="habit-value">
                {insights.avgConfidence}%{" "}
                {insights.avgConfidence >= 70
                  ? "(High)"
                  : insights.avgConfidence >= 50
                  ? "(Medium)"
                  : "(Low)"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
