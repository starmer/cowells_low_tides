import { useState, useEffect } from "react";

const STORAGE_KEY = "theme";
const OPTIONS = [
  ["auto", "Auto"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "auto";
  } catch {
    return "auto";
  }
}

// "auto" leaves data-theme unset so prefers-color-scheme decides.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  return (
    <div className="seg seg-sm" role="group" aria-label="Theme">
      {OPTIONS.map(([value, label]) => (
        <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
