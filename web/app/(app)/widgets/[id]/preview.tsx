"use client";

import { useState } from "react";

/** Loads the real widget on this page, so it can be tried before going live. */
export function PreviewButton({ src, publicKey }: { src: string; publicKey: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={loaded}
      onClick={() => {
        const s = document.createElement("script");
        // Same origin as the dashboard, so the preview works before the website is listed.
        s.src = new URL(new URL(src).pathname, window.location.origin).toString();
        s.async = true;
        s.dataset.widget = publicKey;
        document.body.appendChild(s);
        setLoaded(true);
      }}
    >
      {loaded ? "Preview open (bottom corner)" : "Preview on this page"}
    </button>
  );
}
