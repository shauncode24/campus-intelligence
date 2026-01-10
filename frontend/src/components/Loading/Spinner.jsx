export default function Spinner({ size = "md", color = "primary" }) {
  const sizes = {
    sm: "16px",
    md: "32px",
    lg: "48px",
    xl: "64px",
  };

  const colors = {
    primary: "#4285f4",
    white: "#ffffff",
    gray: "#9ca3af",
  };

  return (
    <div
      className="spinner"
      style={{
        width: sizes[size],
        height: sizes[size],
        border: "3px solid transparent",
        borderTopColor: colors[color],
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
