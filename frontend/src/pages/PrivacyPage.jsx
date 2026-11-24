import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import Header from "../components/Header";
import Footer from "../components/Footer";
import ConfirmModal from "../components/ConfirmModal";
import { usePageTitle } from "../components/usePageTitle";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch } from "../utils/api";
import { handleError } from "../utils/errors";
import "./PrivacyPage.css";

const { VITE_API_BASE_URL } = import.meta.env;

export default function PrivacyPage() {
  usePageTitle("Privacy");
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const deleteMyData = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const response = await apiFetch(`${VITE_API_BASE_URL}/me`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || "Could not delete your data");
      }
      try {
        await logout();
      } catch {
        /* the account is gone already; signing out can only fail harmlessly */
      }
      toast.success("Your data and account have been deleted.");
      navigate("/");
    } catch (err) {
      handleError(err, { customMessage: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <main className="privacy-container">
        <h1>Privacy</h1>
        <p className="privacy-lead">
          Campus Intelligence answers questions from your campus's official documents. This page
          says what it keeps about you, who else sees it, and how to remove it.
        </p>

        <h2>What is stored about you</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your email address and name if you signed up. If you
            use it without signing up, a guest account is created in your browser (it has no
            email).
          </li>
          <li>
            <strong>Your chats:</strong> every question you ask and every answer you receive.
          </li>
          <li>
            <strong>Your history:</strong> the same questions and answers as a list, with your
            favourites and personal notes.
          </li>
          <li>
            <strong>Your feedback:</strong> if you press 👍 or 👎, the rating, the reason, your
            comment and the question and answer it was about.
          </li>
          <li>
            <strong>Your calendar link:</strong> only if you connect Google Calendar: a
            permission token from Google and a list of the events you added.
          </li>
        </ul>

        <h2>Who can see it</h2>
        <ul>
          <li>
            Your chats, history and notes are private to your account. The service's
            administrators can reach the database that holds them.
          </li>
          <li>
            To write an answer, your question and the matching passages from the documents are
            sent to Google's Gemini AI service. Your name and email are not sent.
          </li>
          <li>
            Your data is stored with Google Firebase. The documents themselves are public.
          </li>
          <li>
            To answer faster, the text of a question and its answer is also kept in a shared
            store that does not record who asked. It stops being used after about 30 days, and
            an administrator clears old entries with a clean-up script.
          </li>
        </ul>

        <h2>Please do not type personal details</h2>
        <p>
          Do not put things like ID numbers, health information, or other people's names into a
          question. The assistant does not need them.
        </p>

        <h2>How long it is kept</h2>
        <p>
          Until you delete it. You can delete a single chat or history item at any time. Nothing
          is deleted automatically yet; use the button below to remove everything.
        </p>

        <h2>Delete my data</h2>
        {user ? (
          isAdmin ? (
            <p>
              This is an administrator account, so it cannot be deleted from here. Ask another
              administrator to remove the admin role first.
            </p>
          ) : (
            <>
              <p>
                This permanently deletes {user.isAnonymous ? "this guest account and " : "your account and "}
                all chats, history, notes, feedback and your calendar link. It cannot be undone.
              </p>
              <button
                type="button"
                className="privacy-delete-btn"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                {busy ? "Deleting…" : "Delete my data and account"}
              </button>
            </>
          )
        ) : (
          <p>You are not signed in, so nothing is stored about you yet.</p>
        )}
      </main>
      <ConfirmModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={deleteMyData}
        title="Delete everything?"
        message="Your account, chats, history, notes and feedback will be permanently deleted. This cannot be undone."
      />
      <Footer />
    </>
  );
}
