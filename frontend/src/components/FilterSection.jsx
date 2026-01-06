import React from "react";
import { Search, List, Grid, Calendar, LayoutList } from "lucide-react";
import "../styles/FilterSection.css";

export default function FilterSection({
  searchTerm,
  setSearchTerm,
  timeFilter,
  setTimeFilter,
  typeFilter,
  setTypeFilter,
  confidenceFilter,
  setConfidenceFilter,
  viewMode,
  setViewMode,
  totalQuestions,
  showFavoritesOnly,
  setShowFavoritesOnly,
}) {
  return (
    <div className="filter-section">
      <div className="default filter-header">
        <div className="default filter-title-section">
          <h1 className="default filter-title">History</h1>
          <span className="default filter-count">
            {totalQuestions} Questions
          </span>
        </div>

        <div className="default filter-search-container">
          <Search size={18} className="default filter-search-icon" />
          <input
            type="text"
            placeholder="Search questions, answers, or tags..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="default filter-search-input"
          />
        </div>
      </div>

      <div className="filter-controls">
        <div className="filter-dropdowns">
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="filter-dropdown"
          >
            <option value="any">Any time</option>
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="filter-dropdown"
          >
            <option value="all">All Types</option>
            <option value="deadline">Deadlines</option>
            <option value="procedure">Procedures</option>
            <option value="definition">Definitions</option>
            <option value="requirement">Requirements</option>
            <option value="general">General</option>
          </select>

          <select
            value={confidenceFilter}
            onChange={(e) => setConfidenceFilter(e.target.value)}
            className="filter-dropdown"
          >
            <option value="all">Any Confidence</option>
            <option value="high">High Confidence</option>
            <option value="medium">Medium Confidence</option>
            <option value="low">Low Confidence</option>
          </select>
        </div>

        <div className="filter-view-modes">
          <button
            onClick={() => setViewMode("timeline")}
            className={`view-mode-button ${
              viewMode === "timeline" ? "active" : ""
            }`}
            title="Timeline View"
          >
            <LayoutList size={18} />
            <span>Timeline</span>
          </button>

          <button
            onClick={() => setViewMode("list")}
            className={`view-mode-button ${
              viewMode === "list" ? "active" : ""
            }`}
            title="List View"
          >
            <List size={18} />
            <span>List</span>
          </button>

          <button
            onClick={() => setViewMode("grid")}
            className={`view-mode-button ${
              viewMode === "grid" ? "active" : ""
            }`}
            title="Grid View"
          >
            <Grid size={18} />
            <span>Grid</span>
          </button>
        </div>
      </div>
    </div>
  );
}
