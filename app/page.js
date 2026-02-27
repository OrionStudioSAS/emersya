"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";

const APP_ID = "T1N80OATOE"; // ton app Emersya

export default function Home() {
  const iframeRef = useRef(null);
  const searchParams = useSearchParams();

  const preconfiguration = searchParams.get("preconfiguration"); // dynamique par user

  const iframeSrc = useMemo(() => {
    if (!preconfiguration) return null;
    return `https://emersya.com/app/${APP_ID}?preconfiguration=${encodeURIComponent(
      preconfiguration
    )}`;
  }, [preconfiguration]);

  useEffect(() => {
    const iframe = iframeRef.current;

    const handleMessage = async (ev) => {
      if (!ev.data) return;

      if (ev.data?.action === "onProcessOrder") {
        const basketCode = ev.data?.basket?.code;
        if (!basketCode) return;

        await fetch(`/api/ingest?basketCode=${encodeURIComponent(basketCode)}`, {
          method: "GET",
        });
      }
    };

    window.addEventListener("message", handleMessage);

    const handleLoad = () => {
      iframe?.contentWindow?.postMessage({ action: "initializeAPI" }, "*");
    };

    iframe?.addEventListener("load", handleLoad);

    return () => {
      window.removeEventListener("message", handleMessage);
      iframe?.removeEventListener("load", handleLoad);
    };
  }, []);

  if (!iframeSrc) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24 }}>
        <p>Paramètre manquant : <code>preconfiguration</code></p>
        <p>Exemple :</p>
        <pre style={{ background: "#f5f5f5", padding: 12 }}>
{`/?preconfiguration=XXXX`}
        </pre>
      </main>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={iframeSrc}
      style={{ width: "100%", height: "100vh", border: "0" }}
      allowFullScreen
    />
  );
}