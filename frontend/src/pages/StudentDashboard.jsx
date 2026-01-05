import { useState, useCallback } from "react";
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
          onMessagesChange={setHasMessages}
          onStreamingUpdate={handleStreamingUpdate}
        />
      </div>
    </>
  );
}
