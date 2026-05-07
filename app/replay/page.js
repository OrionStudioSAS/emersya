import { Suspense } from "react";
import ReplayClient from "./ReplayClient";

export default function ReplayPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui" }}>Chargement…</div>}>
      <ReplayClient />
    </Suspense>
  );
}
