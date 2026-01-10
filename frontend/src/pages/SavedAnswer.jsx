import { useState, useEffect } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import "./SavedAnswers.css";
const { VITE_PYTHON_RAG_URL } = import.meta.env;
import { useApp } from "../contexts/AppContext";
import { parseTimestamp } from "../utils/validation";
import { handleError } from "../utils/errors";

export default function SavedAnswers() {
  const { state, actions } = useApp();
  const userId = state.user.id;
  const savedAnswers = state.history.data.filter((h) => h.favorite);
  const loading = state.history.loading;

  const [filteredAnswers, setFilteredAnswers] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    if (userId) {
      actions.fetchHistory(userId, true); // Fetch favorites only
    }
  }, [userId]);

  useEffect(() => {
    if (selectedCategory === "All") {
      setFilteredAnswers(savedAnswers);
    } else {
      setFilteredAnswers(
        savedAnswers.filter((answer) => answer.intent === selectedCategory)
      );
    }
  }, [selectedCategory, savedAnswers]);

  const categories = [
    { id: "All", label: "All" },
    { id: "procedure", label: "Procedures" },
    { id: "definition", label: "Definitions" },
    { id: "requirement", label: "Requirements" },
    { id: "deadline", label: "Deadlines" },
    { id: "general", label: "General" },
  ];

  const getCategoryCount = (categoryId) => {
    if (categoryId === "All") return savedAnswers.length;
    return savedAnswers.filter((a) => a.intent === categoryId).length;
  };

  const handleRemove = async (historyId) => {
    if (!window.confirm("Are you sure you want to remove this saved answer?")) {
      return;
    }

    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/history/user/${userId}/question/${historyId}/favorite`,
        { method: "PUT" }
      );

      if (response.ok) {
        actions.removeHistoryItem(historyId);
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to remove saved answer" });
    }
  };

  const handleEditNote = (id) => {
    setEditingNoteId(id);
    const answer = savedAnswers.find((a) => a.id === id);
    setNoteText(answer?.personalNote || "");
  };

  const handleSaveNote = async (id) => {
    try {
      const response = await fetch(
        `${VITE_PYTHON_RAG_URL}/history/${id}/note`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userId, note: noteText }),
        }
      );

      if (response.ok) {
        actions.updateHistoryItem(id, { personalNote: noteText });
        setEditingNoteId(null);
        setNoteText("");
      }
    } catch (error) {
      handleError(error, { customMessage: "Failed to save note" });
    }
  };

  const handleShare = (answer) => {
    const shareText = `Q: ${answer.questionText}\n\nA: ${answer.answer}`;

    if (navigator.share) {
      navigator
        .share({
          title: answer.questionText,
          text: shareText,
        })
        .catch((error) => {
          console.log("Share failed:", error);
        });
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success("Copied to clipboard!");
    }
  };

  const getConfidenceColor = (level) => {
    if (level === "High") return "#34a853";
    if (level === "Medium") return "#fbbc04";
    return "#d93025";
  };

  const getConfidenceIcon = (level) => {
    if (level === "High")
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z" />
        </svg>
      );
    if (level === "Medium")
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          fill="currentColor"
          viewBox="0 0 16 16"
        >
          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
          <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z" />
        </svg>
      );
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
      </svg>
    );
  };

  const formatDate = (timestamp) => {
    const date = parseTimestamp(timestamp);
    if (!date || isNaN(date.getTime())) return "Unknown date";

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="saved-page-loading">
          <div className="loading-spinner"></div>
          <p>Loading saved answers...</p>
        </div>
        <Footer />
      </>
    );
  }

  if (savedAnswers.length === 0) {
    return (
      <>
        <Header />
        <div className="saved-page-empty">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            fill="#dadce0"
            viewBox="0 0 16 16"
          >
            <path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143q.09.083.176.171a3 3 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15" />
          </svg>
          <h2>No saved answers yet</h2>
          <p>
            Save important answers from your conversations to access them later.
            Click the heart icon on any answer to save it.
          </p>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="saved-page-layout">
        <div className="saved-page-sidebar">
          <h3 className="saved-sidebar-title">CATEGORIES</h3>
          <div className="saved-category-list">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`saved-category-btn ${
                  selectedCategory === cat.id ? "active" : ""
                }`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <span>{cat.label}</span>
                {cat.id === "All" && (
                  <span className="saved-category-badge">
                    {getCategoryCount(cat.id)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <main className="saved-page-main">
          <div className="saved-page-header">
            <h2 className="saved-count-text">
              {filteredAnswers.length} saved{" "}
              {filteredAnswers.length === 1 ? "answer" : "answers"}
            </h2>
          </div>

          <div className="saved-answers-grid">
            {filteredAnswers.map((answer) => (
              <div key={answer.id} className="saved-answer-item">
                <div className="saved-answer-header">
                  <div className="saved-answer-question-row">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      fill="#4285f4"
                      viewBox="0 0 16 16"
                    >
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94" />
                    </svg>
                    <h3 className="saved-answer-question">
                      {answer.questionText}
                    </h3>
                    <button
                      className="saved-answer-remove"
                      onClick={() => handleRemove(answer.id)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="saved-answer-body">
                  <p className="saved-answer-text">{answer.answer}</p>

                  <div className="saved-answer-meta">
                    {answer.confidence && (
                      <div
                        className="saved-confidence-badge"
                        style={{
                          color: getConfidenceColor(answer.confidence.level),
                        }}
                      >
                        {getConfidenceIcon(answer.confidence.level)}
                        <span>
                          {answer.confidence.level} Confidence (
                          {answer.confidence.score}%)
                        </span>
                      </div>
                    )}
                    {answer.sources && answer.sources.length > 0 && (
                      <div className="saved-sources-badge">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783" />
                        </svg>
                        <span>
                          {answer.sources.length} source
                          {answer.sources.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {editingNoteId === answer.id ? (
                  <div className="saved-note-edit">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add your personal notes..."
                      className="saved-note-textarea"
                      rows="3"
                      autoFocus
                    />
                    <div className="saved-note-actions">
                      <button
                        onClick={() => setEditingNoteId(null)}
                        className="saved-note-cancel"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveNote(answer.id)}
                        className="saved-note-save"
                      >
                        Save Note
                      </button>
                    </div>
                  </div>
                ) : answer.personalNote ? (
                  <div className="saved-note-display">
                    <div className="saved-note-header">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="#f59e0b"
                        viewBox="0 0 16 16"
                      >
                        <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h6.086a1.5 1.5 0 0 0 1.06-.44l4.915-4.914A1.5 1.5 0 0 0 15 8.586V2.5A1.5 1.5 0 0 0 13.5 1zM2 2.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V8H9.5A1.5 1.5 0 0 0 8 9.5V14H2.5a.5.5 0 0 1-.5-.5zm7 11.293V9.5a.5.5 0 0 1 .5-.5h4.293z" />
                      </svg>
                      <span>Your Note</span>
                      <button
                        onClick={() => handleEditNote(answer.id)}
                        className="saved-note-edit-btn"
                      >
                        Edit
                      </button>
                    </div>
                    <p className="saved-note-text">{answer.personalNote}</p>
                  </div>
                ) : null}

                <div className="saved-answer-footer">
                  <span className="saved-category-tag">{answer.intent}</span>
                  <div className="saved-answer-actions">
                    {!answer.personalNote && (
                      <button
                        onClick={() => handleEditNote(answer.id)}
                        className="saved-action-btn"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z" />
                          <path
                            fillRule="evenodd"
                            d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"
                          />
                        </svg>
                        Add Note
                      </button>
                    )}
                    <button
                      onClick={() => handleShare(answer)}
                      className="saved-action-btn"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                      >
                        <path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.5 2.5 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5m-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3" />
                      </svg>
                      Share
                    </button>
                    <span className="saved-date-text">
                      Saved on {formatDate(answer.askedAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
      <Footer />
    </>
  );
}
