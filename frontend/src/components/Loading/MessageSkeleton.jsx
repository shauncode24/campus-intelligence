import Skeleton from "./Skeleton";

export default function MessageSkeleton() {
  return (
    <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
      <Skeleton variant="circle" width="40px" />
      <div style={{ flex: 1 }}>
        <Skeleton variant="title" width="30%" />
        <Skeleton count={3} />
        <Skeleton width="80%" />
      </div>
    </div>
  );
}
