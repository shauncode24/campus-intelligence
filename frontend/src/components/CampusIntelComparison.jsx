import React, { useState } from "react";
import { Calendar, FileText, CheckCircle, Zap } from "lucide-react";
import "../styles/CampusIntelComparison.css";
import OldTabs from "./OldTabs";
import OldPage from "./OldPage";

const CampusIntelComparison = () => {
  const [activeTab, setActiveTab] = useState("intel");

  return (
    <div className="default campus-intel-container">
      <div className="default tab-navigation">
        <button
          onClick={() => setActiveTab("old")}
          className={`default tab-button ${
            activeTab === "old"
              ? "tab-button-active-old"
              : "tab-button-inactive-old"
          }`}
        >
          The Old Way
        </button>
        <button
          onClick={() => setActiveTab("intel")}
          className={`default tab-button ${
            activeTab === "intel"
              ? "tab-button-active-intel"
              : "tab-button-inactive-intel"
          }`}
        >
          With Campus Intel
        </button>
      </div>
      <div className="default content-grid">
        <div className="default old-way-container">
          <div
            className={`default curtain ${
              activeTab === "old" ? "active-old" : "inactive-old"
            }`}
          ></div>
          <div className="default old-way-container-wrapper">
            <div className="default old-tabs-container">
              <OldTabs /> <OldTabs /> <OldTabs /> <OldTabs />
            </div>
            <div className="default old-pages-container">
              <OldPage />
              <OldPage layer="secondary" class="layer-1" />
              <OldPage layer="secondary" class="layer-2" />
            </div>
            <div className="default old-page-search-bar">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                fill="#B0BBCB"
                class="bi bi-search"
                viewBox="0 0 16 16"
              >
                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
              </svg>
              <div className="old-page-search-line"></div>
            </div>
          </div>
        </div>

        <div className="default intel-container">
          <div
            className={`default curtain ${
              activeTab === "intel" ? "active-intel" : "inactive-intel"
            }`}
          ></div>

          <div className="default intel-container-wrapper">
            <div className="default window-card">
              {/* Window controls */}
              <div className="default window-header">
                <div className="default window-controls">
                  <div className="default control-red"></div>
                  <div className="default control-yellow"></div>
                  <div className="default control-green"></div>
                </div>
                <span className="default window-title">campus-intel.app</span>
              </div>

              {/* Content */}
              {/* <div className="default window-content"> */}
              {/* Question */}
              <div className="default question-section">
                <div className="default question-icon-box">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="#0669d9"
                    stroke="#0669d9"
                    stroke-width="0.7"
                    class="bi bi-chat-left-text"
                  >
                    <path d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z" />
                    <path d="M3 3.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 6m0 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5" />
                  </svg>
                </div>
                <div className="default question-text">
                  When are finals due?
                </div>
              </div>

              {/* Answer Card */}
              <div className="default answer-card">
                {/* <div > */}
                <div className="default answer-icon-box">
                  <Zap
                    className="default answer-icon"
                    size={15}
                    color="#0669d9"
                  />
                </div>
                <div className="default answer-content">
                  <div className="default answer-title">Finals Schedule</div>
                  <div className="answer-text">
                    Final exams run from{" "}
                    <span className="date-highlight">
                      May 12th to May 16th. <br />
                    </span>
                    Your specific schedule is based on class meeting times.
                  </div>
                  {/* </div> */}
                </div>
              </div>

              {/* Action buttons */}
              <div className="default action-buttons">
                <div className="default intel-calendar-button">
                  <div className="default calendar-content">
                    <Calendar
                      className="default calendar-icon"
                      size={15}
                      color="#3B82F6"
                    />
                    <span className="default calendar-text">
                      Added to calendar
                    </span>
                  </div>
                  <CheckCircle
                    className="default check-icon"
                    size={15}
                    color="#3B82F6"
                  />
                </div>

                <div className="default intel-calendar-button">
                  <div className="default calendar-content">
                    <FileText
                      className="default source-icon"
                      size={15}
                      color="#16A34A"
                    />
                    <span className="default calendar-text">
                      Source: Academic_Calendar_2024.pdf
                    </span>
                  </div>
                  <svg
                    className="default chevron-icon"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="#16A34A"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
              {/* </div> */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CampusIntelComparison;
