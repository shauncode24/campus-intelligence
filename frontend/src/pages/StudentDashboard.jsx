import Chat from "../components/Chat";
import Header from "./../components/Header";
import Footer from "./../components/Footer";
import "./StudentDashboard.css";

export default function StudentDashboard() {
  return (
    <>
      <Header />
      <div className="default student-main">
        <div className="default student-main-title">
          How can we help you today?
        </div>
        <div className="default student-main-subtitle">
          Search across all campus documents, policies, and schedules.
        </div>
        <div className="default student-main-chat"></div>
        <Chat />
      </div>
      <Footer />
    </>
  );
}
