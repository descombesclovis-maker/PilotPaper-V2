"use client";

import dynamic from "next/dynamic";

const ClientOnlyDpPieceWorkbench = dynamic(
  () => import("@/components/dp-piece-workbench").then((module) => module.DpPieceWorkbench),
  {
    ssr: false,
    loading: () => null,
  },
);

export function DpPieceWorkbenchClient() {
  return <ClientOnlyDpPieceWorkbench />;
}
