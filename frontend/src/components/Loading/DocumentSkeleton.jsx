import Skeleton from "./Skeleton";

export default function DocumentSkeleton({ count = 3 }) {
  return (
    <div className="doc-library-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="doc-card">
          <Skeleton variant="rectangle" width="100%" height="200px" />
          <Skeleton variant="title" width="70%" />
          <Skeleton width="50%" />
        </div>
      ))}
    </div>
  );
}
