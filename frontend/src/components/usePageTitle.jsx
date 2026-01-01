import { useEffect } from "react";

export const usePageTitle = (title) => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} | Campus Intel` : "Campus Intel";

    return () => {
      document.title = prevTitle;
    };
  }, [title]);
};
