import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import Header from "../components/Header";
import { usePageTitle } from "../components/usePageTitle";
import { apiFetch } from "../utils/api";
import { handleError } from "../utils/errors";
import "./DocumentManagement.css";
import "./FAQManagement.css";

const { VITE_API_BASE_URL } = import.meta.env;
const API = `${VITE_API_BASE_URL}/admin/faq`;

const CATEGORIES = [
  { id: "general", label: "General" },
  { id: "deadline", label: "Deadlines" },
  { id: "procedure", label: "Procedures" },
  { id: "requirement", label: "Requirements" },
  { id: "definition", label: "Definitions" },
];

const EMPTY_FORM = {
  question: "",
  answer: "",
  category: "general",
  order: 100,
  published: true,
  sourceName: "",
  sourcePage: "",
};

export default function FAQManagement() {
  usePageTitle("Manage FAQs");

  const [faqs, setFaqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // null = closed, "new" = creating
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState([]);

  useEffect(() => {
    loadFaqs();
  }, []);

  const loadFaqs = async () => {
    try {
      const response = await apiFetch(API);
      if (!response.ok) throw new Error("Failed to load");
      const data = await response.json();
      setFaqs(data.faqs);
    } catch (err) {
      handleError(err, { customMessage: "Failed to load FAQs" });
    } finally {
      setLoading(false);
    }
  };

  const openNew = () => {
    setForm(EMPTY_FORM);
    setFormErrors([]);
    setEditingId("new");
  };

  const openEdit = (faq) => {
    setForm({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      order: faq.order,
      published: faq.published,
      sourceName: faq.sourceName || "",
      sourcePage: faq.sourcePage || "",
    });
    setFormErrors([]);
    setEditingId(faq.id);
  };

  const closeForm = () => {
    setEditingId(null);
    setFormErrors([]);
  };

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormErrors([]);

    const creating = editingId === "new";
    try {
      const response = await apiFetch(creating ? API : `${API}/${editingId}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        setFormErrors(body.errors || [body.error || "Invalid FAQ"]);
        return;
      }
      if (!response.ok) throw new Error("Save failed");

      toast.success(creating ? "FAQ added" : "FAQ updated");
      closeForm();
      await loadFaqs();
    } catch (err) {
      handleError(err, { customMessage: "Failed to save FAQ" });
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (faq) => {
    try {
      const response = await apiFetch(`${API}/${faq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          order: faq.order,
          sourceName: faq.sourceName,
          sourcePage: faq.sourcePage,
          published: !faq.published,
        }),
      });
      if (!response.ok) throw new Error("Update failed");
      toast.success(faq.published ? "Unpublished" : "Published");
      await loadFaqs();
    } catch (err) {
      handleError(err, { customMessage: "Failed to update FAQ" });
    }
  };

  const remove = async (faq) => {
    if (!window.confirm(`Delete this FAQ?\n\n${faq.question}`)) return;
    try {
      const response = await apiFetch(`${API}/${faq.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      setFaqs((prev) => prev.filter((f) => f.id !== faq.id));
      toast.success("FAQ deleted");
    } catch (err) {
      handleError(err, { customMessage: "Failed to delete FAQ" });
    }
  };

  const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;

  return (
    <>
      <Header role="admin" />
      <div className="document-management">
        <div className="management-header">
          <h1 className="management-title">FAQ Management</h1>
          <p className="management-subtitle">
            The public FAQ page shows only the entries you publish here. It is
            never built from what students ask.
          </p>
          <button className="faq-admin-primary" onClick={openNew}>
            + Add FAQ
          </button>
        </div>

        {editingId && (
          <form className="faq-admin-form" onSubmit={save}>
            <h2>{editingId === "new" ? "New FAQ" : "Edit FAQ"}</h2>

            {formErrors.length > 0 && (
              <ul className="faq-admin-errors" role="alert">
                {formErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <label>
              Question
              <input
                value={form.question}
                onChange={(e) => setField("question", e.target.value)}
                maxLength={300}
                required
              />
            </label>

            <label>
              Answer
              <textarea
                value={form.answer}
                onChange={(e) => setField("answer", e.target.value)}
                rows={6}
                maxLength={5000}
                required
              />
            </label>

            <div className="faq-admin-row">
              <label>
                Category
                <select
                  value={form.category}
                  onChange={(e) => setField("category", e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Order (lower shows first)
                <input
                  type="number"
                  min="0"
                  max="9999"
                  value={form.order}
                  onChange={(e) => setField("order", e.target.value)}
                />
              </label>
            </div>

            <div className="faq-admin-row">
              <label>
                Source document (optional)
                <input
                  value={form.sourceName}
                  onChange={(e) => setField("sourceName", e.target.value)}
                  maxLength={150}
                  placeholder="e.g. Academic Calendar 2026-27"
                />
              </label>

              <label>
                Page (optional)
                <input
                  type="number"
                  min="1"
                  value={form.sourcePage}
                  onChange={(e) => setField("sourcePage", e.target.value)}
                />
              </label>
            </div>

            <label className="faq-admin-check">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => setField("published", e.target.checked)}
              />
              Published (visible to students)
            </label>

            <div className="faq-admin-buttons">
              <button type="submit" className="faq-admin-primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="faq-admin-secondary" onClick={closeForm}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="documents-table-container">
          <table className="documents-table">
            <thead>
              <tr>
                <th>QUESTION</th>
                <th>CATEGORY</th>
                <th>ORDER</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" className="faq-admin-empty">
                    Loading…
                  </td>
                </tr>
              ) : faqs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="faq-admin-empty">
                    No FAQs yet. Add the first one with “+ Add FAQ”.
                  </td>
                </tr>
              ) : (
                faqs.map((faq) => (
                  <tr key={faq.id}>
                    <td>{faq.question}</td>
                    <td>
                      <span className="category-badge">{categoryLabel(faq.category)}</span>
                    </td>
                    <td>{faq.order}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          faq.published ? "status-processed" : "status-pending"
                        }`}
                      >
                        {faq.published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td>
                      <div className="faq-admin-actions">
                        <button onClick={() => openEdit(faq)}>Edit</button>
                        <button onClick={() => togglePublished(faq)}>
                          {faq.published ? "Unpublish" : "Publish"}
                        </button>
                        <button className="danger" onClick={() => remove(faq)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
