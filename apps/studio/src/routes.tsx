import type { RouteObject } from "react-router";
import { BriefPage } from "./routes/BriefPage.tsx";
import { ImportPage } from "./routes/ImportPage.tsx";
import { NewBriefPage } from "./routes/NewBriefPage.tsx";
import { PagePage } from "./routes/PagePage.tsx";
import { ReviewPage } from "./routes/ReviewPage.tsx";

/** The studio's pages, shared by the app and the in-browser demo. */
export const routes: RouteObject[] = [
  { path: "/", element: <ImportPage /> },
  { path: "/brands/:id", element: <ReviewPage /> },
  { path: "/brands/:id/briefs/new", element: <NewBriefPage /> },
  { path: "/briefs/:id", element: <BriefPage /> },
  { path: "/pages/:id", element: <PagePage /> },
];
