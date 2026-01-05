import { motion } from "framer-motion";
import "./Homepage.css";
import Header from "./../components/Header";
import Footer from "../components/Footer";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../components/usePageTitle";
import CampusIntelComparison from "./../components/CampusIntelComparison";
import Steps from "../components/Steps";
import CampusAssistant from "../components/CampusAssistant";
import CampusAssistantShowcase from "../components/CampusAssistantShowcase";

export default function Homepage() {
  usePageTitle("Home");
  const navigate = useNavigate();

  const handleNavigation = (path) => {
    navigate(path);
  };

  // Animation variants
  const fadeInUp = {
    hidden: { opacity: 0, y: 60 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  };

  const fadeInLeft = {
    hidden: { opacity: 0, x: -60 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  };

  const fadeInRight = {
    hidden: { opacity: 0, x: 60 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
      },
    },
  };

  return (
    <>
      <Header />
      <div className="default homepage-wrapper">
        {/* Hero Section */}
        <motion.div
          className="default homepage-hero-main"
          initial="hidden"
          animate="visible"
          variants={fadeInUp}
        >
          <motion.div
            className="default homepage-hero-title"
            variants={fadeInUp}
          >
            Stop searching PDFs. <span>Start getting answers.</span>
          </motion.div>
          <motion.div
            className="default homepage-hero-sub-title"
            variants={fadeInUp}
          >
            The AI-powered campus assistant that instantly finds what you need
            from thousands of university documents.
          </motion.div>
          <motion.div
            className="default homepage-hero-button-div"
            variants={fadeInUp}
          >
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
                strokeWidth="1.1"
                className="bi bi-arrow-right"
              >
                <path
                  fillRule="evenodd"
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
          </motion.div>
        </motion.div>

        {/* Campus Assistant and Steps */}
        <div className="default homepage-lvl-1">
          {/* <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeInLeft}
            style={{ width: "200%" }}
          > */}
          <CampusAssistant />
          {/* </motion.div> */}

          <motion.div
            className="default steps"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            variants={staggerContainer}
          >
            <motion.div variants={fadeInRight}>
              <Steps
                title="Ask Your Question"
                subtitle="Type naturally, just like talking to a friend"
              />
            </motion.div>
            <motion.div variants={fadeInRight}>
              <Steps
                title="Get Instant Answer"
                subtitle="Verified info from official documents"
              />
            </motion.div>
            <motion.div variants={fadeInRight}>
              <Steps
                title="Save to Calendar"
                subtitle="Important dates added automatically"
              />
            </motion.div>
          </motion.div>
        </div>

        {/* Comparison Section */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeInUp}
        >
          <CampusIntelComparison />
        </motion.div>

        {/* Showcase Section */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeInUp}
        >
          <CampusAssistantShowcase />
        </motion.div>

        {/* Sub Footer */}
        <motion.div
          className="default sub-footer"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={staggerContainer}
        >
          <motion.span className="default" variants={fadeInUp}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="#73A6F8"
              className="bi bi-shield-check"
              viewBox="0 0 16 16"
              stroke="#73A6F8"
              strokeWidth="0.3"
            >
              <path d="M5.338 1.59a61 61 0 0 0-2.837.856.48.48 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.7 10.7 0 0 0 2.287 2.233c.346.244.652.42.893.533q.18.085.293.118a1 1 0 0 0 .101.025 1 1 0 0 0 .1-.025q.114-.034.294-.118c.24-.113.547-.29.893-.533a10.7 10.7 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524zM5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.8 11.8 0 0 1-2.517 2.453 7 7 0 0 1-1.048.625c-.28.132-.581.24-.829.24s-.548-.108-.829-.24a7 7 0 0 1-1.048-.625 11.8 11.8 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 63 63 0 0 1 5.072.56" />
              <path d="M10.854 5.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 7.793l2.646-2.647a.5.5 0 0 1 .708 0" />
            </svg>
            Official campus documents only
          </motion.span>
          <motion.span className="default" variants={fadeInUp}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="#73A6F8"
              className="bi bi-check-circle"
              viewBox="0 0 16 16"
              stroke="#73A6F8"
              strokeWidth="0.3"
            >
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
              <path d="m10.97 4.97-.02.022-3.473 4.425-2.093-2.094a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05" />
            </svg>
            Admin verified content
          </motion.span>
          <motion.span className="default" variants={fadeInUp}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="#73A6F8"
              className="bi bi-lock"
              viewBox="0 0 16 16"
              stroke="#73A6F8"
              strokeWidth="0.3"
            >
              <path
                fillRule="evenodd"
                d="M8 0a4 4 0 0 1 4 4v2.05a2.5 2.5 0 0 1 2 2.45v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4M4.5 7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7zM8 1a3 3 0 0 0-3 3v2h6V4a3 3 0 0 0-3-3"
              />
            </svg>
            Privacy protected search
          </motion.span>
        </motion.div>
      </div>
      <Footer />
    </>
  );
}
