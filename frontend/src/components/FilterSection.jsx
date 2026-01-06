import React from "react";
import { Search, List, Grid } from "lucide-react";
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
}) {
  return (
    <div className="filter-section">
      <div className="search-container">
        <Search size={20} className="search-icon" />
        <input
          type="text"
          placeholder="Search questions, answers, or tags..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="filters-row">
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="any">Any time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="filter-select"
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
          className="filter-select"
        >
          <option value="all">All Confidence</option>
          <option value="high">High Confidence</option>
          <option value="medium">Medium Confidence</option>
          <option value="low">Low Confidence</option>
        </select>

        <div className="view-mode-toggle">
          <button
            onClick={() => setViewMode("timeline")}
            className={`view-mode-btn ${
              viewMode === "timeline" ? "active" : ""
            }`}
          >
            <List size={16} /> Timeline
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
          >
            <List size={16} /> List
          </button>
          <button
            onClick={() => setViewMode("grid")}
            className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
          >
            <Grid size={16} /> Grid
          </button>
        </div>
      </div>
    </div>
  );
}
