import "./Homepage.css";
import Header from "./../components/Header";
import Footer from "../components/Footer";

export default function Homepage() {
  return (
    <>
      <Header />
      <div className="default homepage-hero-main">
        <div className="default homepage-hero-title">
          Official answers from <span>official documents</span>
        </div>
        <div className="default homepage-hero-sub-title">
          Stop guessing. Get accurate, instant answers about campus policies,
          deadlines, and procedures directly from the source.
        </div>
        <div className="default homepage-hero-button-div">
          <button className="default homepage-hero-button-question">
            Ask a Question
          </button>
          <button className="default homepage-hero-button-login">
            Admin Login
          </button>
        </div>
      </div>
      <Footer />
    </>
  );
}
