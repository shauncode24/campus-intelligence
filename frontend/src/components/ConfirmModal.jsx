export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
}) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          padding: "32px",
          borderRadius: "12px",
          maxWidth: "400px",
          width: "90%",
        }}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: "1.25rem" }}>{title}</h3>
        <p style={{ margin: "0 0 24px 0", color: "#5f6368" }}>{message}</p>
        <div
          style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}
        >
          <button onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={onConfirm} className="btn btn-primary">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
