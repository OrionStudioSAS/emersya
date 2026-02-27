import { Suspense } from "react";
import ViewerClient from "./ViewerClient";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui" }}>Chargement…</div>}>
      <ViewerClient />
    </Suspense>
  );
}