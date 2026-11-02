import type { Brand } from "@lph/tokens";
import { api } from "../api.ts";
import { MarkdownView } from "./MarkdownView.tsx";

export function DesignMdTab({ brand }: { brand: Brand }) {
  return (
    <MarkdownView
      load={() => api.designMd(brand.id)}
      version={brand.updatedAt}
      rawHref={`/api/brands/${brand.id}/design.md`}
      notice="Your brand written up as one file (Design.md) that AI tools can read. To change it, edit the Theme tab."
    />
  );
}
