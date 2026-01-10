import { useState, useEffect } from "react";
import Header from "../components/Header";
import Footer from "../components/Footer";
import FAQHeader from "../components/FAQHeader";
import FAQItem from "../components/FAQItem";
import FAQEmpty from "../components/FAQEmpty";
import FAQFooterNote from "../components/FAQFooterNote";
import FAQSkeleton from "../components/FAQSkelton";
import { usePageTitle } from "../components/usePageTitle";
import "./FAQPage.css";
import { handleError } from "../utils/errors";

const { VITE_PYTHON_RAG_URL } = import.meta.env;

export default function FAQPage() {
  usePageTitle("Frequently Asked Questions");

  const [faqs, setFaqs] = useState([]);
  const [filteredFaqs, setFilteredFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [sortBy, setSortBy] = useState("popular");
  const [viewMode, setViewMode] = useState("normal"); // normal | compact

  useEffect(() => {
    fetchFAQs();
  }, []);

  useEffect(() => {
    applyFiltersAndSort();
  }, [faqs, activeFilter, sortBy]);

  const fetchFAQs = async () => {
    try {
      const response = await fetch(`${VITE_PYTHON_RAG_URL}/faq?limit=50`);
      const data = await response.json();
      setFaqs(data.faqs);
      setLoading(false);
    } catch (error) {
      handleError(error, { customMessage: "Failed to load FAQs" });
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...faqs];

    // Apply category filter
    if (activeFilter !== "all") {
      filtered = filtered.filter((faq) => faq.intent === activeFilter);
    }

    // Apply sorting
    switch (sortBy) {
      case "popular":
        filtered.sort((a, b) => b.count - a.count);
        break;
      case "recent":
        filtered.sort((a, b) => {
          const dateA = a.lastAskedAt?._seconds || a.createdAt?._seconds || 0;
          const dateB = b.lastAskedAt?._seconds || b.createdAt?._seconds || 0;
          return dateB - dateA;
        });
        break;
      case "category":
        filtered.sort((a, b) => a.intent.localeCompare(b.intent));
        break;
      default:
        break;
    }

    setFilteredFaqs(filtered);
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    setExpandedId(null); // Collapse all when switching filters
  };

  const handleSortChange = (sort) => {
    setSortBy(sort);
  };

  const toggleViewMode = () => {
    setViewMode(viewMode === "normal" ? "compact" : "normal");
  };

  if (loading) {
    return (
      <>
        <Header />
        <div className="faq-container">
          <FAQSkeleton />
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="faq-container">
        <FAQHeader
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
          sortBy={sortBy}
          onSortChange={handleSortChange}
          viewMode={viewMode}
          onViewModeToggle={toggleViewMode}
          totalCount={faqs.length}
          filteredCount={filteredFaqs.length}
        />

        <div
          className={`faq-list ${viewMode === "compact" ? "compact-mode" : ""}`}
        >
          {filteredFaqs.length === 0 ? (
            <FAQEmpty activeFilter={activeFilter} />
          ) : (
            filteredFaqs.map((faq, index) => (
              <FAQItem
                key={faq.id}
                faq={faq}
                rank={index + 1}
                isExpanded={expandedId === faq.id}
                onToggle={() => toggleExpand(faq.id)}
                viewMode={viewMode}
                globalRank={faqs.findIndex((f) => f.id === faq.id) + 1}
              />
            ))
          )}
        </div>

        <FAQFooterNote />
      </div>
      <Footer />
    </>
  );
}
