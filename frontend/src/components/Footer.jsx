import "../styles/Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-left">
          <p className="footer-copyright">
            © 2025 Campus Intelligence Platform. All rights reserved.
          </p>
          <p className="footer-disclaimer">
            Answers are based only on official documents.
          </p>
        </div>
        <div className="footer-right">
          <a href="/privacy" className="footer-link">
            Privacy Policy
          </a>
          <a href="/terms" className="footer-link">
            Terms of Service
          </a>
          <a href="/contact" className="footer-link">
            Contact Support
          </a>
        </div>
      </div>
    </footer>
  );
}
