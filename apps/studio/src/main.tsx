import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Shell } from "./components/Shell.tsx";
import { routes } from "./routes.tsx";
import "./styles/global.scss";

const router = createBrowserRouter([{ element: <Shell />, children: routes }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
