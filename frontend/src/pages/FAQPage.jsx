import { useState, useEffect } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import "./FAQPage.css";
import "../styles/Skeleton.css";
import { usePageTitle } from "../components/usePageTitle";
const { VITE_API_BASE_URL } = import.meta.env;
const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function FAQPage() {
  usePageTitle("Frequently Asked Questions");
  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    fetchFAQs();
  }, []);

  const fetchFAQs = async () => {
    try {
      const response = await fetch(`${VITE_PYTHON_RAG_URL}/faq?limit=5`);
      const data = await response.json();
      setFaqs(data.faqs);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching FAQs:", error);
      setLoading(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getIntentBadgeColor = (intent) => {
    const colors = {
      definition: "#4285f4",
      procedure: "#34a853",
      deadline: "#fbbc04",
      requirement: "#ea4335",
      general: "#8e8e8e",
    };
    return colors[intent] || colors.general;
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="faq-loading">
          {loading && (
            <div className="faq-list">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="faq-item">
                  <div style={{ padding: "20px" }}>
                    <div className="skeleton skeleton-title"></div>
                    <div
                      className="skeleton skeleton-text"
                      style={{ width: "80%" }}
                    ></div>
                    <div
                      className="skeleton skeleton-text"
                      style={{ width: "40%" }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p>Loading frequently asked questions...</p>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="faq-container">
        <div className="faq-header">
          <h1 className="faq-title">Frequently Asked Questions</h1>
          <p className="faq-subtitle">
            These are the most commonly asked questions by students. Questions
            are ranked by popularity.
          </p>
        </div>

        <div className="faq-list">
          {faqs.length === 0 ? (
            <div className="faq-empty">
              <p>No FAQs available yet. Be the first to ask a question!</p>
            </div>
          ) : (
            faqs.map((faq, index) => (
              <div key={faq.id} className="faq-item">
                <div
                  className="faq-question-header"
                  onClick={() => toggleExpand(faq.id)}
                >
                  <div className="faq-question-content">
                    <span className="faq-rank">#{index + 1}</span>
                    <div className="faq-question-text-container">
                      <h3 className="faq-question-text">{faq.question}</h3>
                      <div className="faq-meta">
                        <span
                          className="faq-intent-badge"
                          style={{
                            backgroundColor: getIntentBadgeColor(faq.intent),
                          }}
                        >
                          {faq.intent}
                        </span>
                        <span className="faq-count">
                          Asked {faq.count} {faq.count === 1 ? "time" : "times"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <svg
                    className={`faq-expand-icon ${
                      expandedId === faq.id ? "expanded" : ""
                    }`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fillRule="evenodd"
                      d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"
                    />
                  </svg>
                </div>

                {expandedId === faq.id && (
                  <div className="faq-answer">
                    <div className="faq-answer-content">{faq.answer}</div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="faq-footer-note">
          <p>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
              <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
            </svg>
            All answers are generated from official campus documents and
            verified sources.
          </p>
        </div>
      </div>
      <Footer />
    </>
  );
}
