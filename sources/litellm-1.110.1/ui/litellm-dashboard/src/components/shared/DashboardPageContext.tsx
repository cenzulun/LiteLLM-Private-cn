"use client";

import { createContext, useContext } from "react";

export const DashboardPageContext = createContext(false);
export const useDashboardPage = () => useContext(DashboardPageContext);
