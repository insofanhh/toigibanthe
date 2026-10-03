import { App } from "@/components/app";
import { Suspense } from "react";
import { feed } from "@/lib/catalog";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  let initialFeed = null;
  if (!slug?.length)
    try {
      initialFeed = await feed({ address: "", lat: 10.7817, lng: 106.6809 });
    } catch {}
  return (
    <Suspense fallback={<div className="loading">Đang tải…</div>}>
      <App initialFeed={initialFeed} />
    </Suspense>
  );
}
