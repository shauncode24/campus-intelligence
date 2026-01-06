import React from "react";
import { TrendingUp, BookOpen, Flame, Clock } from "lucide-react";
import "../styles/InsightsSidebar.css";

export default function InsightsSidebar({ insights }) {
  if (!insights) return null;

  return (
    <div className="history-sidebar">
      <div className="history-sidebar-sticky">
        <h2 className="insights-title">Your Insights</h2>

        {/* Total Questions */}
        <div className="insight-card">
          <div className="insight-header">
            <TrendingUp size={20} color="#4285f4" />
            {insights.weekGrowth !== 0 && (
              <span
                className={`insight-growth ${
                  insights.weekGrowth > 0 ? "positive" : "negative"
                }`}
              >
                {insights.weekGrowth > 0 ? "+" : ""}
                {insights.weekGrowth}% this week
              </span>
            )}
          </div>
          <div className="insight-label">Total Questions</div>
          <div className="insight-value">{insights.totalQuestions}</div>
        </div>

        {/* Top Topic */}
        <div className="insight-card">
          <div className="insight-header">
            <BookOpen size={20} color="#fbbc04" />
            <span
              style={{
                fontSize: "13px",
                fontWeight: "500",
                color: "#202124",
              }}
            >
              Top Topic
            </span>
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: "400",
              color: "#202124",
              textTransform: "capitalize",
              marginBottom: "4px",
            }}
          >
            {insights.topTopic}
          </div>
          <div className="insight-subtitle">
            {insights.topTopicCount} questions asked
          </div>
        </div>

        {/* Streak */}
        <div className="insight-card">
          <div className="insight-header">
            <Flame size={20} color="#ea4335" />
            <span
              style={{
                fontSize: "13px",
                fontWeight: "500",
                color: "#202124",
              }}
            >
              Current Streak
            </span>
          </div>
          <div
            style={{
              fontSize: "32px",
              fontWeight: "500",
              color: "#202124",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {insights.streak} Days <Flame size={24} color="#ea4335" />
          </div>
          <div className="insight-subtitle">Keep it up!</div>
        </div>

        {/* Activity Habits */}
        <div className="insight-card">
          <h3
            style={{
              fontSize: "14px",
              fontWeight: "500",
              marginBottom: "12px",
              color: "#202124",
            }}
          >
            Activity Habits
          </h3>

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

        {/* Suggested */}
        <div className="insight-card">
          <h3
            style={{
              fontSize: "14px",
              fontWeight: "500",
              marginBottom: "12px",
              color: "#202124",
            }}
          >
            Suggested for you
          </h3>
          <div className="suggested-item">When do finals start?</div>
          <div className="suggested-item">Library hours this weekend</div>
        </div>
      </div>
    </div>
  );
}
