"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

const APP_ID = "T1N80OATOE";

export default function ReplayClient() {
  const searchParams = useSearchParams();
  const basketCode = searchParams.get("basketCode");

  const iframeSrc = useMemo(() => {
    if (!basketCode) return null;
    return `https://emersya.com/en/testApp/replay/${APP_ID}?basketCode=${encodeURIComponent(basketCode)}&mode=client`;
  }, [basketCode]);

  if (!iframeSrc) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 24 }}>
        <p>Paramètre manquant : <code>basketCode</code></p>
        <p>Exemple :</p>
        <pre style={{ background: "#f5f5f5", padding: 12 }}>
{`/replay?basketCode=XXXX`}
        </pre>
      </main>
    );
  }

  return (
    <iframe
      src={iframeSrc}
      style={{ width: "100%", height: "100vh", border: "0" }}
      allowFullScreen
    />
  );
}
