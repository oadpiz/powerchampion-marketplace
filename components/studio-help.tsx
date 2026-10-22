"use client";

import Link from "next/link";

/** Where to get more credits until online payment exists: the team adds them by hand. */
export function TopUpLinks({ zh }: { zh: boolean }) {
  return (
    <>
      {" "}
      <Link href="/studio/credits">{zh ? "查看點數" : "See credits"}</Link>
      {zh ? "・" : " · "}
      <Link href="/contact">{zh ? "聯絡我們" : "Contact us"}</Link>
      {zh ? "（點數由團隊人工加值）" : " (credits are added by our team)"}
    </>
  );
}

/** The free-draft cap, with the contact link in the sentence. */
export function DraftLimitText({ limit, zh }: { limit: number; zh: boolean }) {
  return zh ? (
    <>
      今天產生分鏡的次數已達上限（每天 {limit} 次），明天再試，或<Link href="/contact">聯絡我們</Link>。
    </>
  ) : (
    <>
      You have used today&apos;s {limit} free storyboards. Try again tomorrow, or <Link href="/contact">contact us</Link>.
    </>
  );
}

/** 「今天還可以免費產生 N 次分鏡」 under a storyboard button. */
export function DraftsLeft({ remaining, zh }: { remaining: number; zh: boolean }) {
  return (
    <small className="studio-drafts-left">
      {zh ? `今天還可以免費產生 ${remaining} 次分鏡` : `${remaining} free ${remaining === 1 ? "storyboard" : "storyboards"} left today`}
    </small>
  );
}
