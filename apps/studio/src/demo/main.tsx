import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { api } from "../api.ts";
import { Shell } from "../components/Shell.tsx";
import { routes } from "../routes.tsx";
import "../styles/global.scss";
import { demoApi, resetDemo, wakeService } from "./api.ts";
import { DemoBanner } from "./DemoBanner.tsx";

// Every API call is answered in the browser, apart from the imports the service makes.
Object.assign(api, demoApi);
wakeService();

// A memory router: the demo can be hosted anywhere, including inside a frame, with no server routes.
const router = createMemoryRouter([
  {
    element: (
      <>
        <DemoBanner
          onReset={() => {
            resetDemo();
            location.reload();
          }}
        />
        <Shell />
      </>
    ),
    children: routes,
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
