import { useState, useCallback, useEffect, useRef } from "react";
import Chat from "../components/Chat";
import Header from "../components/Header";
import Footer from "../components/Footer";
import Sidebar from "../components/Sidebar";
import WelcomeScreen from "../components/WelcomeScreen";
import MessageList from "../components/MessageList";
import { usePageTitle } from "../components/usePageTitle";
import "./StudentDashboard.css";

export default function StudentDashboard() {
  usePageTitle("Ask Questions");
  const [hasMessages, setHasMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatState, setChatState] = useState({
    messages: [],
    streamingMessage: "",
    streamingMetadata: null,
    loading: false,
    userId: "",
  });
  const chatRef = useRef(null);

  // Check for re-ask question on mount
  useEffect(() => {
    const reaskQuestion = localStorage.getItem("reask_question");
    if (reaskQuestion) {
      console.log("🔄 Re-asking question:", reaskQuestion);
      // Clear the stored question
      localStorage.removeItem("reask_question");
      // Trigger the question after a brief delay to ensure Chat component is ready
      setTimeout(() => {
        if (chatRef.current && chatRef.current.sendMessage) {
          chatRef.current.sendMessage(reaskQuestion);
        }
      }, 100);
    }
  }, []);

  const handleStreamingUpdate = useCallback((state) => {
    setChatState(state);
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <>
      <Sidebar isOpen={sidebarOpen} onToggle={toggleSidebar} />

      <div className={`main-content ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Header />

        <div className="default dashboard-content">
          <WelcomeScreen isVisible={!hasMessages} />

          {hasMessages && (
            <MessageList
              messages={chatState.messages}
              streamingMessage={chatState.streamingMessage}
              streamingMetadata={chatState.streamingMetadata}
              loading={chatState.loading}
              userId={chatState.userId}
            />
          )}
        </div>

        <Footer />

        <Chat
          ref={chatRef}
          onMessagesChange={setHasMessages}
          onStreamingUpdate={handleStreamingUpdate}
        />
      </div>
    </>
  );
}
