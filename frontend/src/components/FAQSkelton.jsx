import "../styles/FAQSkeleton.css";

export default function FAQSkeleton() {
  return (
    <div className="faq-skeleton">
      <div className="faq-skeleton-header">
        <div
          className="skeleton skeleton-title"
          style={{ width: "60%", margin: "0 auto" }}
        ></div>
        <div
          className="skeleton skeleton-text"
          style={{ width: "50%", margin: "8px auto" }}
        ></div>
        <div
          className="skeleton skeleton-text"
          style={{ width: "30%", margin: "16px auto" }}
        ></div>
      </div>

      <div className="faq-skeleton-controls">
        <div className="faq-skeleton-filters">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton skeleton-filter"></div>
          ))}
        </div>
        <div className="faq-skeleton-sort">
          <div className="skeleton skeleton-select"></div>
          <div className="skeleton skeleton-button"></div>
        </div>
      </div>

      <div className="faq-skeleton-list">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="faq-skeleton-item">
            <div className="faq-skeleton-item-content">
              <div className="skeleton skeleton-rank"></div>
              <div className="faq-skeleton-item-text">
                <div
                  className="skeleton skeleton-title"
                  style={{ width: "80%" }}
                ></div>
                <div
                  className="skeleton skeleton-text"
                  style={{ width: "60%", marginTop: "8px" }}
                ></div>
                <div className="faq-skeleton-meta">
                  <div className="skeleton skeleton-badge"></div>
                  <div
                    className="skeleton skeleton-text"
                    style={{ width: "100px" }}
                  ></div>
                  <div
                    className="skeleton skeleton-text"
                    style={{ width: "120px" }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
