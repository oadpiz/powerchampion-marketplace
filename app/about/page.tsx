import { permanentRedirect } from "next/navigation";

/**
 * /about is a legacy path: the gateway used to link to it, and it is still
 * quoted in older material. The page lives at /company now, so this is a 308 —
 * permanent, method-preserving, and safe for crawlers to fold into /company.
 *
 * There is no metadata export on purpose: nothing here ever renders, and a
 * title would only invite the route into the sitemap.
 */
export default function AboutPage(): never {
  permanentRedirect("/company");
}
