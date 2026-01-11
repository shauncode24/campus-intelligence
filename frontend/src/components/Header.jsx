import "../styles/Header.css";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Header(props) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleNavigation = (path) => {
    navigate(path);
    setMenuOpen(false); // Close menu after navigation
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuOpen && !event.target.closest(".header-main")) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpen]);

  return (
    <>
      <div
        className={`default header-main ${
          props.sidebarOpen ? "sidebar-open" : ""
        }`}
      >
        <div
          className="default header-left"
          onClick={() => handleNavigation("/")}
        >
          <div className="default header-left-icon-div">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              fill="white"
              className="bi bi-mortarboard"
              viewBox="0 0 16 16"
            >
              <path d="M8.211 2.047a.5.5 0 0 0-.422 0l-7.5 3.5a.5.5 0 0 0 .025.917l7.5 3a.5.5 0 0 0 .372 0L14 7.14V13a1 1 0 0 0-1 1v2h3v-2a1 1 0 0 0-1-1V6.739l.686-.275a.5.5 0 0 0 .025-.917zM8 8.46 1.758 5.965 8 3.052l6.242 2.913z" />
              <path d="M4.176 9.032a.5.5 0 0 0-.656.327l-.5 1.7a.5.5 0 0 0 .294.605l4.5 1.8a.5.5 0 0 0 .372 0l4.5-1.8a.5.5 0 0 0 .294-.605l-.5-1.7a.5.5 0 0 0-.656-.327L8 10.466zm-.068 1.873.22-.748 3.496 1.311a.5.5 0 0 0 .352 0l3.496-1.311.22.748L8 12.46z" />
            </svg>
          </div>
          <div className="default header-left-header">Campus Intelligence</div>
        </div>

        {/* Hamburger Menu Button */}
        <button
          className="hamburger-menu"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          aria-label="Toggle menu"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            {menuOpen ? (
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
            ) : (
              <path
                fillRule="evenodd"
                d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"
              />
            )}
          </svg>
        </button>

        {props.role === "admin" ? (
          <div
            className={`default header-right ${menuOpen ? "menu-open" : ""}`}
          >
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/admin/documents")}
            >
              Documents
            </span>
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/admin/add-document")}
            >
              Add Documents
            </span>
            <span
              className="default admin-option"
              onClick={() => handleNavigation("/login")}
            >
              Exit Admin
            </span>
          </div>
        ) : (
          <div
            className={`default header-right ${menuOpen ? "menu-open" : ""}`}
          >
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/student")}
            >
              Dashboard
            </span>
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/history")}
            >
              History
            </span>
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/faq")}
            >
              FAQs
            </span>
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/documents")}
            >
              Documents
            </span>
            <span
              className="default header-right-options"
              onClick={() => handleNavigation("/saved-answers")}
            >
              Saved
            </span>
            <span
              className="default admin-option"
              onClick={() => handleNavigation("/login")}
            >
              Admin Login
            </span>
          </div>
        )}
      </div>

      {/* Overlay for mobile menu */}
      {menuOpen && (
        <div
          className="header-overlay"
          onClick={() => setMenuOpen(false)}
        ></div>
      )}
    </>
  );
}
