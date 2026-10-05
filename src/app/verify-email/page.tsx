import { Suspense } from "react";
import type { Metadata } from "next";
import { EmailVerification } from "@/components/email-verification";

export const metadata: Metadata = {
  title: "Xác minh email",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="loading">Đang kiểm tra liên kết…</div>}>
      <EmailVerification />
    </Suspense>
  );
}
