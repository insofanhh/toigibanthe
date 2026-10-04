import { App } from "@/components/app";
import { Suspense } from "react";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<div className="loading">Đang tải…</div>}>
      <App pathname={slug?.length ? "/" + slug.join("/") : "/"} />
    </Suspense>
  );
}
