import type { Brand } from "@lph/tokens";
import { api } from "../api.ts";
import { MarkdownView } from "./MarkdownView.tsx";

export function DesignMdTab({ brand }: { brand: Brand }) {
  return (
    <MarkdownView
      load={() => api.designMd(brand.id)}
      version={brand.updatedAt}
      rawHref={`/api/brands/${brand.id}/design.md`}
      notice="Changes to your brand must be made in the Theme tab. This file is what agents read."
    />
  );
}
