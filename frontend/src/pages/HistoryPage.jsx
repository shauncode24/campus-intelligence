import React, { useState, useEffect } from "react";
import { BookOpen } from "lucide-react";
import FilterSection from "../components/FilterSection";
import QuestionCard from "../components/QuestionCard";
import InsightsSidebar from "../components/InsightsSidebar";
import "./HistoryPage.css";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useApp } from "../contexts/AppContext";
import { handleError } from "../utils/errors";
import { parseTimestamp, validateConfidence } from "../utils/validation";
import Spinner from "../components/Loading/Spinner";

const VITE_PYTHON_RAG_URL =
  import.meta.env.VITE_PYTHON_RAG_URL || "http://localhost:8000";
import Header from "./../components/Header";

export default function HistoryPage() {
  const navigate = useNavigate();
  const { state, actions } = useApp();
  const userId = state.user.id;
  const history = state.history.data;
  const loading = state.history.loading;

  const [searchTerm, setSearchTerm] = useState("");
  const [timeFilter, setTimeFilter] = useState("any");
  const [typeFilter, setTypeFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [viewMode, setViewMode] = useState("timeline");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [insights, setInsights] = useState(null);
  const [documents, setDocuments] = useState(new Map());

  useEffect(() => {
    if (userId) {
      actions.fetchHistory(userId, showFavoritesOnly);
    }
  }, [userId, showFavoritesOnly]);

  const checkDocumentExistence = async (historyData) => {
    const docMap = new Map();
    const uniqueDocIds = new Set();

    historyData.forEach((item) => {
      if (item.sources) {
        item.sources.forEach((source) => {
          if (source.documentId) {
            uniqueDocIds.add(source.documentId);
          }
        });
      }
    });

    console.log(`📄 Checking existence for ${uniqueDocIds.size} documents`);

    for (const docId of uniqueDocIds) {
      try {
        const response = await fetch(
          `${VITE_PYTHON_RAG_URL}/documents/${docId}/exists`
        );
        const data = await response.json();
        docMap.set(docId, data.exists);
      } catch (error) {
        handleError(error, { silent: true }); // Silent for document checks
        docMap.set(docId, false);
      }
    }

    setDocuments(docMap);
  };

  const calculateInsights = (historyData) => {
    if (!historyData.length) {
      console.log("⚠️ No history data for insights");
      return;
    }

    const intentCounts = {};
    const confidenceScores = [];
    const hourCounts = new Array(24).fill(0);

    historyData.forEach((item) => {
      const intent = item.intent || "general";
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;

      if (item.confidence && typeof item.confidence.score === "number") {
        confidenceScores.push(item.confidence.score);
      }

      if (item.askedAt) {
        const date = parseTimestamp(item.askedAt);
        if (date) {
          hourCounts[date.getHours()]++;
        }
      }
    });

    const topIntent = Object.entries(intentCounts).sort(
      (a, b) => b[1] - a[1]
    )[0];

    const avgConfidence = confidenceScores.length
      ? Math.round(
          confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
        )
      : 0;

    const mostActiveHour = hourCounts.indexOf(Math.max(...hourCounts));
    const mostActiveTime = `${mostActiveHour % 12 || 12}:00 ${
      mostActiveHour >= 12 ? "PM" : "AM"
    }`;

    const streak = calculateStreak(historyData);
    const weekGrowth = calculateWeekGrowth(historyData);

    const calculatedInsights = {
      totalQuestions: historyData.length,
      topTopic: topIntent ? topIntent[0] : "general",
      topTopicCount: topIntent ? topIntent[1] : 0,
      avgConfidence,
      mostActiveTime,
      streak,
      weekGrowth,
    };

    setInsights(calculatedInsights);
  };

  const calculateStreak = (historyData) => {
    const dates = historyData
      .map((item) => {
        const date = parseTimestamp(item.askedAt);
        return date ? date.toDateString() : null;
      })
      .filter(Boolean);

    const uniqueDates = [...new Set(dates)].sort(
      (a, b) => new Date(b) - new Date(a)
    );

    let streak = 0;
    for (let i = 0; i < uniqueDates.length; i++) {
      const checkDate = new Date();
      checkDate.setDate(checkDate.getDate() - i);

      if (uniqueDates.includes(checkDate.toDateString())) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  };

  const calculateWeekGrowth = (historyData) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const thisWeek = historyData.filter((item) => {
      const date = parseTimestamp(item.askedAt);
      return date && date >= weekAgo;
    }).length;

    const lastWeek = historyData.filter((item) => {
      const date = parseTimestamp(item.askedAt);
      return date && date >= twoWeeksAgo && date < weekAgo;
    }).length;

    if (lastWeek === 0) return thisWeek > 0 ? 100 : 0;
    return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  };

  const formatDate = (timestamp) => {
    const date = parseTimestamp(timestamp);
    if (!date || isNaN(date.getTime())) return "Unknown date";

    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      const diffHours = Math.floor(diffTime / (1000 / 60 / 60));
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffTime / (1000 * 60));
        return diffMinutes === 0 ? "Just now" : `${diffMinutes}m`;
      }
      return `${diffHours}h`;
    }
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getDateGroup = (timestamp) => {
    const date = parseTimestamp(timestamp);
    if (!date || isNaN(date.getTime())) return "OLDER";

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const itemDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    if (itemDate.getTime() === today.getTime()) return "TODAY";
    if (itemDate.getTime() === yesterday.getTime()) return "YESTERDAY";
    return "OLDER";
  };

  const filterHistory = () => {
    let filtered = [...history];

    if (searchTerm) {
      filtered = filtered.filter(
        (item) =>
          item.questionText?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.answer?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (timeFilter !== "any") {
      const now = new Date();
      filtered = filtered.filter((item) => {
        const date = parseTimestamp(item.askedAt);
        if (!date) return false;

        switch (timeFilter) {
          case "today":
            return date.toDateString() === now.toDateString();
          case "week":
            return date >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          case "month":
            return date >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          default:
            return true;
        }
      });
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((item) => {
        const itemIntent = (item.intent || "general").toLowerCase();
        return itemIntent === typeFilter.toLowerCase();
      });
    }

    if (confidenceFilter !== "all") {
      filtered = filtered.filter((item) => {
        const level = item.confidence?.level?.toLowerCase();
        return level === confidenceFilter.toLowerCase();
      });
    }

    return filtered;
  };

  const groupByDate = (items) => {
    const groups = { TODAY: [], YESTERDAY: [], OLDER: [] };
    items.forEach((item) => {
      const group = getDateGroup(item.askedAt);
      groups[group].push(item);
    });
    return groups;
  };

  const toggleExpand = (id) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const toggleFavorite = async (id) => {
    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/history/user/${userId}/question/${id}/favorite`,
        { method: "PUT" }
      );

      if (response.ok) {
        const data = await response.json();
        actions.updateHistoryItem(id, { favorite: data.favorite });
        toast.success(
          data.favorite ? "Added to favorites" : "Removed from favorites"
        );
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to update favorite status" });
    }
  };

  const deleteQuestion = async (historyId) => {
    if (!confirm("Are you sure you want to remove this from your history?"))
      return;

    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/history/user/${userId}/question/${historyId}`,
        { method: "DELETE" }
      );

      if (response.ok) {
        actions.removeHistoryItem(historyId);
        toast.success("Question removed from history");
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to delete question" });
    }
  };

  const handleReask = (questionText) => {
    actions.setPendingQuestion(questionText);
    navigate("/student");
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success("Copied to clipboard!");
    });
  };

  const getIntentColor = (intent) => {
    const colors = {
      deadline: "#ea4335",
      procedure: "#4285f4",
      definition: "#34a853",
      requirement: "#fbbc04",
      general: "#5f6368",
    };
    return colors[intent?.toLowerCase()] || colors.general;
  };

  const getConfidenceBadge = (confidence) => {
    const validated = validateConfidence(confidence);
    if (!validated) return null;

    const colors = {
      high: "#34a853",
      medium: "#fbbc04",
      low: "#ea4335",
    };
    return {
      color: colors[validated.level.toLowerCase()] || "#5f6368",
      level: validated.level,
    };
  };

  const hasDocumentMissing = (item) => {
    if (!item.sources) return false;
    return item.sources.some(
      (source) => source.documentId && !documents.get(source.documentId)
    );
  };

  const filteredHistory = filterHistory();
  const groupedHistory = groupByDate(filteredHistory);

  if (loading) {
    return (
      <div className="history-page">
        <Header />
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "400px",
          }}
        >
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <>
      <Header />
      <div className="history-page">
        <FilterSection
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          timeFilter={timeFilter}
          setTimeFilter={setTimeFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          confidenceFilter={confidenceFilter}
          setConfidenceFilter={setConfidenceFilter}
          viewMode={viewMode}
          setViewMode={setViewMode}
          totalQuestions={history.length}
          showFavoritesOnly={showFavoritesOnly}
          setShowFavoritesOnly={setShowFavoritesOnly}
        />

        <div className="history-main">
          <div className="history-content">
            {filteredHistory.length === 0 ? (
              <div className="empty-state">
                <BookOpen size={48} color="#dadce0" />
                <h2>No questions found</h2>
                <p>
                  {showFavoritesOnly
                    ? "You haven't favorited any questions yet!"
                    : "Try adjusting your filters or start asking questions!"}
                </p>
              </div>
            ) : (
              <div className={`history-${viewMode}-view`}>
                {viewMode === "grid" ? (
                  <div className="history-grid">
                    {filteredHistory.map((item) => (
                      <QuestionCard
                        key={item.id}
                        item={item}
                        isExpanded={expandedItems.has(item.id)}
                        isSelected={selectedItems.has(item.id)}
                        isFavorite={item.favorite}
                        docMissing={hasDocumentMissing(item)}
                        formatDate={formatDate}
                        getIntentColor={getIntentColor}
                        getConfidenceBadge={getConfidenceBadge}
                        toggleExpand={toggleExpand}
                        toggleSelect={toggleSelect}
                        toggleFavorite={toggleFavorite}
                        handleReask={handleReask}
                        handleCopy={handleCopy}
                        deleteQuestion={deleteQuestion}
                        userId={userId}
                        viewMode={viewMode}
                      />
                    ))}
                  </div>
                ) : viewMode === "list" ? (
                  <div className="history-list">
                    {filteredHistory.map((item) => (
                      <QuestionCard
                        key={item.id}
                        item={item}
                        isExpanded={expandedItems.has(item.id)}
                        isSelected={selectedItems.has(item.id)}
                        isFavorite={item.favorite}
                        docMissing={hasDocumentMissing(item)}
                        formatDate={formatDate}
                        getIntentColor={getIntentColor}
                        getConfidenceBadge={getConfidenceBadge}
                        toggleExpand={toggleExpand}
                        toggleSelect={toggleSelect}
                        toggleFavorite={toggleFavorite}
                        handleReask={handleReask}
                        handleCopy={handleCopy}
                        deleteQuestion={deleteQuestion}
                        userId={userId}
                        viewMode={viewMode}
                      />
                    ))}
                  </div>
                ) : (
                  Object.entries(groupedHistory).map(([group, items]) => {
                    if (items.length === 0) return null;

                    return (
                      <div key={group} className="date-group">
                        <div className="date-group-label">{group}</div>

                        {items.map((item) => (
                          <QuestionCard
                            key={item.id}
                            item={item}
                            isExpanded={expandedItems.has(item.id)}
                            isSelected={selectedItems.has(item.id)}
                            isFavorite={item.favorite}
                            docMissing={hasDocumentMissing(item)}
                            formatDate={formatDate}
                            getIntentColor={getIntentColor}
                            getConfidenceBadge={getConfidenceBadge}
                            toggleExpand={toggleExpand}
                            toggleSelect={toggleSelect}
                            toggleFavorite={toggleFavorite}
                            handleReask={handleReask}
                            handleCopy={handleCopy}
                            deleteQuestion={deleteQuestion}
                            userId={userId}
                            viewMode={viewMode}
                          />
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <InsightsSidebar insights={insights} />
        </div>
      </div>
    </>
  );
}
