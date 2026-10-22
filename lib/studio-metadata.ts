import type { Metadata } from "next";
import { metadataForRoute } from "./metadata";

/** Every /studio page: noindex (private route) and a same-origin referrer policy (studio spec 5.3). */
export const studioMetadata: Metadata = { ...metadataForRoute("/studio"), referrer: "same-origin" };
