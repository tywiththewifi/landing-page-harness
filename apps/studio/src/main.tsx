import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Shell } from "./components/Shell.tsx";
import { ImportPage } from "./routes/ImportPage.tsx";
import { ReviewPage } from "./routes/ReviewPage.tsx";
import "./styles/global.scss";

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <ImportPage /> },
      { path: "/brands/:id", element: <ReviewPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
