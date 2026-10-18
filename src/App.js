import { useEffect } from "react";
import { favicon } from "./constants";
import YearTides from "./YearTides";
import ThemeToggle from "./ThemeToggle";

export default function App() {
  // Swap the default favicon for the tide icon.
  useEffect(() => {
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = favicon;
  }, []);

  return (
    <>
      <nav className="top-nav">
        <ThemeToggle />
      </nav>
      <YearTides />
    </>
  );
}
