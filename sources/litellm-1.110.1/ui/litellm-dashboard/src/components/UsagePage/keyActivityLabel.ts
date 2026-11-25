import type { KeyMetadata } from "./types";
import { displayIdentifier } from "@/utils/displayIdentifier";

export function keyActivityLabel(
  metadata: Pick<KeyMetadata, "key_alias" | "user_email"> | null | undefined,
  fallback = "-",
): string {
  return displayIdentifier(metadata?.key_alias || metadata?.user_email || fallback);
}
