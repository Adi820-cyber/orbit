import { createBrowserRouter } from "react-router";
import { appRoutes } from "./app-routes";
import { APP_SURFACE } from "./lib/surface";

export const router = createBrowserRouter(appRoutes(APP_SURFACE));
