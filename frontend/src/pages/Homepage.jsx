import "./Homepage.css";
import Header from "./../components/Header";
import Footer from "../components/Footer";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../components/usePageTitle";
import CampusIntelComparison from "./../components/CampusIntelComparison";
import Steps from "../components/Steps";
import CampusAssistant from "../components/CampusAssistant";

export default function Homepage() {
  usePageTitle("Home");
  const navigate = useNavigate();

  const handleNavigation = (path) => {
    navigate(path);
  };

  return (
    <>
      <Header />
      <div className="default homepage-wrapper">
        <div className="default homepage-hero-main">
          <div className="default homepage-hero-title">
            Stop searching PDFs. <span>Start getting answers.</span>
          </div>
          <div className="default homepage-hero-sub-title">
            The AI-powered campus assistant that instantly finds what you need
            from thousands of university documents.
          </div>
          <div className="default homepage-hero-button-div">
            <button
              className="default homepage-hero-button-question"
              onClick={() => handleNavigation("/student")}
            >
              Ask a Question
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="1.1"
                class="bi bi-arrow-right"
              >
                <path
                  fill-rule="evenodd"
                  d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8"
                />
              </svg>
            </button>
            <button
              className="default homepage-hero-button-login"
              onClick={() => handleNavigation("/login")}
            >
              Admin Login
            </button>
          </div>
        </div>
        <div className="default homepage-lvl-1">
          <CampusAssistant />
          <div className="default steps">
            <Steps
              title="Ask Your Question"
              subtitle="Type naturally, just like talking to a friend"
            />
            <Steps
              title="Get Instant Answer"
              subtitle="Verified info from official documents"
            />
            <Steps
              title="Save to Calendar"
              subtitle="Important dates added automatically"
            />
          </div>
        </div>

        <CampusIntelComparison />
      </div>
      <Footer />
    </>
  );
}
