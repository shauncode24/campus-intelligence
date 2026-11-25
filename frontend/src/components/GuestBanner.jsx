import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import "../styles/GuestBanner.css";

const DISMISS_KEY = "guestBannerDismissed";

function wasDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // storage blocked: just show it
  }
}

/**
 * Shown to guests (visitors who have not created an account). A guest's chats belong to this
 * browser only: clearing site data or switching device loses them for good. Creating a free
 * account here upgrades the guest in place, so nothing already asked is lost.
 */
export default function GuestBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(wasDismissed);

  if (!user || !user.isAnonymous || hidden) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* not remembered: it will show again next visit */
    }
    setHidden(true);
  };

  return (
    <div className="guest-banner" role="note">
      <span>
        You are using Campus Intelligence as a <strong>guest</strong>. Your chats are kept only in this
        browser and are lost if you clear its data or switch device.
      </span>
      <span className="guest-banner-actions">
        <button type="button" className="guest-banner-primary" onClick={() => navigate("/user-login?mode=signup")}>
          Create a free account to keep them
        </button>
        <button type="button" className="guest-banner-dismiss" onClick={dismiss} aria-label="Dismiss this notice">
          ✕
        </button>
      </span>
    </div>
  );
}
