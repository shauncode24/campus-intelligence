import Skeleton from "./Skeleton";

export default function ChatListSkeleton({ count = 5 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: "12px",
            padding: "12px",
            marginBottom: "8px",
          }}
        >
          <Skeleton variant="rectangle" width="40px" height="40px" />
          <div style={{ flex: 1 }}>
            <Skeleton variant="title" width="60%" />
            <Skeleton width="40%" />
          </div>
        </div>
      ))}
    </>
  );
}
