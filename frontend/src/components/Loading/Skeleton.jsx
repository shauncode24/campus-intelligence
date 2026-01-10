export default function Skeleton({
  variant = "text",
  width,
  height,
  count = 1,
}) {
  const heights = {
    text: "16px",
    title: "24px",
    circle: width || "40px",
    rectangle: height || "100px",
  };

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            width: width || "100%",
            height: heights[variant],
            borderRadius:
              variant === "circle" ? "50%" : variant === "text" ? "4px" : "8px",
            marginBottom: "8px",
          }}
        />
      ))}
    </>
  );
}
